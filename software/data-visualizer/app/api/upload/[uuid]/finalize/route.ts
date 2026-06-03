import {
  BufferAdapter,
  DLF_FILES,
  assembleChunksToBuffer,
  dlfS3Key,
  listChunkKeys,
} from "@/lib/dlf-s3";
import prisma from "@/lib/prisma";
import { s3Client } from "@/lib/s3";
import { isValidUuid } from "@/lib/utils";
import { verifyDeviceSignature } from "@/lib/verify-device";
import { DeleteObjectsCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse, after } from "next/server";

export const dynamic = "force-dynamic";

const ACCEPTED_FILES = new Set<string>(DLF_FILES);

async function withRetry<T>(
  fn: () => Promise<T>,
  {
    maxAttempts = 4,
    delayMs = 1000,
  }: { maxAttempts?: number; delayMs?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Delay until the next attempt
      if (attempt < maxAttempts) {
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
  }
  throw lastErr;
}

/**
 * Compute run duration in seconds by finding the max tick across all polled and
 * event samples. Returns 0 if no data is present or files are unreadable.
 */
async function computeRunDurationS(
  polledSamples: any[],
  eventSamples: any[],
  tickBaseUs: bigint,
): Promise<number> {
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
 * POST /api/upload/[uuid]/finalize
 *
 * Triggers assembly of previously uploaded chunks and DB record creation.
 *
 * Body (JSON):
 *   {
 *     "isActive": boolean,
 *     "files": ["meta.dlf", "polled.dlf", "event.dlf"]  // files to finalize
 *   }
 *
 * Returns 202 immediately; assembly + S3 upload + DB write happen in background.
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
    console.error(`[api/upload/finalize] Auth failed: ${authResult.message}`);
    return NextResponse.json(
      { error: "Unauthorized", details: "Invalid request signature" },
      { status: 401 },
    );
  }

  // Parse and validate request body
  let body: { isActive?: unknown; files?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const isActiveRaw = body.isActive;
  let isActive = false;
  if (isActiveRaw !== undefined) {
    if (typeof isActiveRaw !== "boolean") {
      return NextResponse.json(
        { error: "isActive must be a boolean" },
        { status: 400 },
      );
    }
    isActive = isActiveRaw;
  }

  if (!Array.isArray(body.files) || body.files.length === 0) {
    return NextResponse.json(
      { error: "files must be a non-empty array of filenames" },
      { status: 400 },
    );
  }

  const files: string[] = [];
  for (const f of body.files) {
    if (typeof f !== "string" || !ACCEPTED_FILES.has(f)) {
      return NextResponse.json(
        { error: `Unacceptable filename: ${f}` },
        { status: 400 },
      );
    }
    files.push(f);
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

  // If the run doesn't exist yet, then meta.dlf is required for the epoch time and tick base
  if (!runExists && !files.includes("meta.dlf")) {
    return NextResponse.json(
      { error: "Cannot create a new run without meta.dlf" },
      { status: 400 },
    );
  }

  console.log(
    `[api/upload/finalize] Accepted finalize for run: ${uuid}, deviceId: ${deviceId}, isActive: ${isActive}, files: [${files.join(", ")}]`,
  );

  after(async () => {
    try {
      // Assemble each DLF file from chunks into memory
      const fileBuffers = new Map<string, Buffer>();
      for (const filename of files) {
        const buf = await assembleChunksToBuffer(uuid, filename);
        if (!buf) {
          console.warn(
            `[api/upload/finalize] No chunks found for ${uuid}/${filename}, skipping`,
          );
          continue;
        }
        console.log(
          `[api/upload/finalize] Assembled chunks for ${uuid}/${filename} (${buf.byteLength} bytes)`,
        );
        fileBuffers.set(filename, buf);
      }

      if (fileBuffers.size === 0) {
        console.error(
          `[api/upload/finalize] No files assembled for run ${uuid}`,
        );
        return;
      }

      // Ensure device exists (create if missing)
      await prisma.device.upsert({
        where: { id: deviceId },
        update: {},
        create: { id: deviceId },
      });

      const adapter = new BufferAdapter(
        fileBuffers.get("meta.dlf") ?? null,
        fileBuffers.get("polled.dlf") ?? null,
        fileBuffers.get("event.dlf") ?? null,
      );

      // Create or update run record
      if (!runExists) {
        const [meta, polledSamples, eventSamples] = await Promise.all([
          adapter.getMetaDlf(),
          adapter.getPolledData().catch(() => []),
          adapter.getEventData().catch(() => []),
        ]);
        const durationS = await computeRunDurationS(
          polledSamples,
          eventSamples,
          BigInt(meta.tickBaseUs),
        );
        await prisma.run.create({
          data: {
            uuid,
            deviceId,
            epochTimeS: BigInt(meta.epochTimeS),
            tickBaseUs: BigInt(meta.tickBaseUs),
            durationS,
            metadata: {},
            isActive,
          },
        });
        console.log(
          `[api/upload/finalize] Created new run ${uuid}, isActive: ${isActive}, durationS: ${durationS}s`,
        );
      } else {
        const updateData: Parameters<typeof prisma.run.update>[0]["data"] = {
          isActive,
        };
        if (fileBuffers.has("polled.dlf") || fileBuffers.has("event.dlf")) {
          const [polledSamples, eventSamples] = await Promise.all([
            adapter.getPolledData().catch(() => []),
            adapter.getEventData().catch(() => []),
          ]);
          updateData.durationS = await computeRunDurationS(
            polledSamples,
            eventSamples,
            existingRun.tickBaseUs,
          );
        }
        await prisma.run.update({
          where: { id: existingRun.id },
          data: updateData,
        });
        console.log(
          `[api/upload/finalize] Updated run ${uuid}, isActive: ${isActive}, durationS: ${updateData.durationS}s`,
        );
      }

      // Upload assembled files to S3
      const bucket = process.env.S3_BUCKET_NAME!;
      await Promise.all(
        [...fileBuffers.entries()].map(([filename, buf]) => {
          const key = dlfS3Key(uuid, filename);
          console.log(
            `[api/upload/finalize] Uploading assembled file to S3: ${key}`,
          );
          return withRetry(() =>
            s3Client.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: buf,
                ContentType: "application/octet-stream",
              }),
            ),
          );
        }),
      );

      // Only delete chunks when the run is complete. Keep chunks for active runs
      // so future partial uploads can continue accumulating.
      if (!isActive) {
        console.log(
          `[api/upload/finalize] Run complete. Deleting all chunks for run ${uuid}`,
        );
        for (const filename of fileBuffers.keys()) {
          const chunkKeys = await listChunkKeys(uuid, filename);
          for (let i = 0; i < chunkKeys.length; i += 1000) {
            await s3Client.send(
              new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: {
                  Objects: chunkKeys.slice(i, i + 1000).map((Key) => ({ Key })),
                  Quiet: true,
                },
              }),
            );
          }
        }
      }

      console.log(
        `[api/upload/finalize] Background processing complete for run ${uuid}`,
      );
    } catch (err) {
      console.error(
        `[api/upload/finalize] Background processing failed for run ${uuid}:`,
        err,
      );
    }
  });

  return NextResponse.json({ message: "Finalize accepted" }, { status: 202 });
}
