import { dlfS3Key } from "@/lib/dlf-s3";
import prisma from "@/lib/prisma";
import { s3Client } from "@/lib/s3";
import { verifyDeviceSignature } from "@/lib/verifydevice";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { Adapter, FSAdapter } from "dlflib-js";
import { createReadStream, mkdirSync, rmSync, writeFileSync } from "fs";
import { NextRequest, NextResponse, after } from "next/server";
import { resolve } from "path";

export const dynamic = "force-dynamic";

// Vercel Serverless Functions only allow writes to /tmp
const UPLOAD_DIR = "/tmp/oas/uploads";

const ACCEPTED_FILES = new Set<string>(["meta.dlf", "event.dlf", "polled.dlf"]);

function getRunUploadDir(runUuid: string) {
  return resolve(UPLOAD_DIR, runUuid);
}

/**
 * Compute run duration in seconds by finding the max tick across all polled and
 * event samples. Returns 0 if no data is present or files are unreadable.
 */
async function computeRunDurationS(
  adapter: Adapter,
  tickBaseUs: bigint,
): Promise<number> {
  const [polledSamples, eventSamples] = await Promise.all([
    adapter.polled_data().catch(() => []),
    adapter.events_data().catch(() => []),
  ]);

  let maxTick: bigint = 0n; // sample.tick is bigint, so use bigint for maxTick to avoid precision loss
  for (const sample of polledSamples) {
    if (sample.tick > maxTick) {
      maxTick = sample.tick;
    }
  }
  for (const sample of eventSamples) {
    if (sample.tick > maxTick) {
      maxTick = sample.tick;
    }
  }

  // Perform calculation with bigint to avoid precision loss
  return Number((maxTick * tickBaseUs) / 1_000_000n);
}

/**
 * POST /api/upload/[uuid]
 *
 * Receives DLF files. Returns 202 immediately after receiving and validating the files.
 * S3 upload and DB writes happen in the background.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;

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
    console.error(`[api/upload] Auth failed: ${authResult.message}`);
    return NextResponse.json(
      { error: "Unauthorized", details: "Invalid request signature" },
      { status: 401 },
    );
  }

  // Check if this run already exists and upload is from the same device
  const existingRun = await prisma.run.findUnique({
    where: { uuid },
    select: { id: true, deviceId: true, tickBaseUs: true },
  });
  const runExists = !!existingRun;
  if (runExists && existingRun.deviceId !== deviceId) {
    return NextResponse.json(
      {
        error: `Run with uuid ${uuid} already associated with a different device`,
      },
      { status: 409 },
    );
  }

  const formData = await request.formData();

  // Process isActive field (OPTIONAL)
  const isActiveField = formData.get("isActive");
  let isActive = false;
  if (isActiveField !== null) {
    const s = String(isActiveField).trim().toLowerCase();
    if (["true", "1", "on", "yes"].includes(s)) {
      isActive = true;
    } else if (["false", "0", "off", "no"].includes(s)) {
      isActive = false;
    } else {
      return NextResponse.json(
        {
          error:
            "Invalid isActive value. Use true/false (or 1/0, on/off, yes/no).",
        },
        { status: 400 },
      );
    }
  }

  // Write accepted files to local dir
  const uploadDir = getRunUploadDir(uuid);
  let uploadedFiles: Set<string>;
  try {
    mkdirSync(uploadDir, { recursive: true });
    uploadedFiles = new Set<string>();
    for (const file of formData.getAll("files")) {
      if (!(file instanceof File) || !ACCEPTED_FILES.has(file.name)) {
        continue;
      }
      writeFileSync(
        resolve(uploadDir, file.name),
        Buffer.from(await file.arrayBuffer()),
      );
      uploadedFiles.add(file.name);
    }
  } catch (err) {
    rmSync(uploadDir, { recursive: true, force: true });
    throw err;
  }

  // New runs require meta.dlf to read epoch time and tick base
  if (!runExists && !uploadedFiles.has("meta.dlf")) {
    rmSync(uploadDir, { recursive: true, force: true });
    return NextResponse.json(
      { error: "Cannot create a new run without meta.dlf" },
      { status: 400 },
    );
  }

  console.log(
    `[api/upload] Accepted upload for run: ${uuid}, deviceId: ${deviceId}, isActive: ${isActive}, files: [${[...uploadedFiles].join(", ")}]`,
  );

  // S3 uploads and DB writes happen after the response is sent
  after(async () => {
    try {
      // Ensure device exists (create if missing)
      await prisma.device.upsert({
        where: { id: deviceId },
        update: {},
        create: { id: deviceId },
      });

      // Create or update run
      const adapter = new FSAdapter(uploadDir);
      if (!runExists) {
        const metaHeader = await adapter.meta_header();
        const durationS = await computeRunDurationS(
          adapter,
          BigInt(metaHeader.tick_base_us),
        );
        await prisma.run.create({
          data: {
            uuid,
            deviceId,
            epochTimeS: BigInt(metaHeader.epoch_time_s),
            tickBaseUs: BigInt(metaHeader.tick_base_us),
            durationS,
            metadata: {},
            isActive,
          },
        });
        console.log(
          `[api/upload] Created new run ${uuid}, isActive: ${isActive}, durationS: ${durationS}s`,
        );
      } else {
        const updateData: Parameters<typeof prisma.run.update>[0]["data"] = {
          isActive,
        };
        if (uploadedFiles.has("polled.dlf") || uploadedFiles.has("event.dlf")) {
          updateData.durationS = await computeRunDurationS(
            adapter,
            existingRun.tickBaseUs,
          );
        }
        await prisma.run.update({
          where: { id: existingRun.id },
          data: updateData,
        });
        console.log(
          `[api/upload] Updated run ${uuid}, isActive: ${isActive}, durationS: ${updateData.durationS}s`,
        );
      }

      // Upload DLF files to S3
      // TODO: Add retries with exponential backoff in case of transient S3 errors
      // TODO: Use Vercel Workflow instead of after()
      const bucket = process.env.S3_BUCKET_NAME!;
      await Promise.all(
        [...uploadedFiles].map((filename) => {
          const key = dlfS3Key(uuid, filename);
          console.log(`[api/upload] Uploading to S3: ${key}`);
          return s3Client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: createReadStream(resolve(uploadDir, filename)),
              ContentType: "application/octet-stream",
            }),
          );
        }),
      );

      console.log(
        `[api/upload] Background processing complete for run ${uuid}`,
      );
    } catch (err) {
      console.error(
        `[api/upload] Background processing failed for run ${uuid}:`,
        err,
      );
    } finally {
      try {
        rmSync(uploadDir, { recursive: true, force: true });
      } catch {}
    }
  });

  return NextResponse.json({ message: "Upload received" }, { status: 202 });
}
