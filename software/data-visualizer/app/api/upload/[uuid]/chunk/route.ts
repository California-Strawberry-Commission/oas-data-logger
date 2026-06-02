import { BufferAdapter, dlfChunkS3Key } from "@/lib/dlf-s3";
import prisma from "@/lib/prisma";
import { s3Client } from "@/lib/s3";
import { isValidUuid } from "@/lib/utils";
import { verifyDeviceSignature } from "@/lib/verify-device";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ACCEPTED_FILES = new Set<string>(["meta.dlf", "event.dlf", "polled.dlf"]);

/**
 * POST /api/upload/[uuid]/chunk
 *
 * Receives a single binary chunk for a DLF file.
 *
 * Required headers:
 *   x-filename: file name, such as "polled.dlf"
 *   x-chunk-number: one-based chunk number (integer)
 *
 * Optional headers:
 *   x-is-active: if "true", triggers a DB upsert to keep the run record current
 *   x-duration-s: elapsed seconds as a decimal string
 *
 * Body: raw binary (Content-Type: application/octet-stream)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  // Parse and validate UUID
  const { uuid } = await params;
  if (!isValidUuid(uuid)) {
    return NextResponse.json({ error: "Invalid run UUID" }, { status: 400 });
  }

  // Ensure device ID header is present
  const deviceId = request.headers.get("x-device-id");
  if (!deviceId) {
    return NextResponse.json(
      { error: "Unauthorized", details: "Missing device ID header" },
      { status: 401 },
    );
  }

  // Verify the request signature
  const authResult = await verifyDeviceSignature(
    deviceId,
    request.headers,
    uuid,
  );
  if (!authResult.success) {
    console.error(`[api/upload/chunk] Auth failed: ${authResult.message}`);
    return NextResponse.json(
      { error: "Unauthorized", details: "Invalid request signature" },
      { status: 401 },
    );
  }

  // Validate headers
  const filename = request.headers.get("x-filename");
  const chunkNumberStr = request.headers.get("x-chunk-number");
  if (!filename || chunkNumberStr === null) {
    return NextResponse.json(
      {
        error: "Missing required headers: x-filename, x-chunk-number",
      },
      { status: 400 },
    );
  }
  if (!ACCEPTED_FILES.has(filename)) {
    return NextResponse.json(
      { error: `Unacceptable filename: ${filename}` },
      { status: 400 },
    );
  }
  const chunkNumber = parseInt(chunkNumberStr, 10);
  if (isNaN(chunkNumber) || chunkNumber < 1) {
    return NextResponse.json(
      { error: "Invalid x-chunk-number" },
      { status: 400 },
    );
  }

  // Validate body
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    return NextResponse.json({ error: "Empty chunk body" }, { status: 400 });
  }

  // Upload chunk to S3
  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: dlfChunkS3Key(uuid, filename, chunkNumber),
      Body: Buffer.from(body),
      ContentType: "application/octet-stream",
    }),
  );

  console.log(
    `[api/upload/chunk] Stored chunk ${chunkNumber} for ${uuid}/${filename} (${body.byteLength} bytes)`,
  );

  // Keep the DB run record current.
  // On meta.dlf chunk #1 the run record is created if it doesn't exist yet.
  // All other chunks update isActive (and optionally durationS) if the run exists.
  const isActive = request.headers.get("x-is-active") === "true";
  const durationSHeader = request.headers.get("x-duration-s");
  const durationS =
    durationSHeader !== null ? parseFloat(durationSHeader) : undefined;

  await prisma.device.upsert({
    where: { id: deviceId },
    update: {},
    create: { id: deviceId },
  });

  if (filename === "meta.dlf" && chunkNumber === 1) {
    try {
      const metaAdapter = new BufferAdapter(Buffer.from(body), null, null);
      const meta = await metaAdapter.getMetaDlf();
      await prisma.run.upsert({
        where: { uuid },
        update: {
          isActive,
          ...(durationS !== undefined && { durationS }),
        },
        create: {
          uuid,
          deviceId,
          epochTimeS: BigInt(meta.epochTimeS),
          tickBaseUs: BigInt(meta.tickBaseUs),
          durationS: durationS ?? 0,
          metadata: {},
          isActive,
        },
      });
      console.log(`[api/upload/chunk] Upserted run record for ${uuid}`);
    } catch (err) {
      console.error(`[api/upload/chunk] Failed to upsert run ${uuid}:`, err);
    }
  } else {
    // Note: we use updateMany here because it won't do anything if the run doesn't exist yet
    await prisma.run.updateMany({
      where: { uuid, deviceId },
      data: {
        isActive,
        ...(durationS !== undefined && { durationS }),
      },
    });
  }

  return NextResponse.json({ message: "Chunk received" }, { status: 202 });
}
