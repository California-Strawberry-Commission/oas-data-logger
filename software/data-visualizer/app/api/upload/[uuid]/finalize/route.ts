import { dlfS3Key, listChunkKeys } from "@/lib/dlf-s3";
import prisma from "@/lib/prisma";
import { s3Client } from "@/lib/s3";
import { isValidUuid } from "@/lib/utils";
import { verifyDeviceSignature } from "@/lib/verify-device";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { FSAdapter } from "dlflib-js";
import { appendFileSync, createReadStream, mkdirSync, rmSync } from "fs";
import { NextRequest, NextResponse, after } from "next/server";
import { resolve } from "path";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = "/tmp/oas/uploads";
const ACCEPTED_FILES = new Set<string>(["meta.dlf", "event.dlf", "polled.dlf"]);

function getRunUploadDir(runUuid: string) {
  return resolve(UPLOAD_DIR, runUuid);
}

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
      if (attempt < maxAttempts) {
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
  }
  throw lastErr;
}

async function computeRunDurationS(
  polledSamples: any[],
  eventSamples: any[],
  tickBaseUs: bigint,
): Promise<number> {
  let maxTick: bigint = 0n;
  for (const sample of polledSamples) {
    if (sample.tick > maxTick) maxTick = sample.tick;
  }
  for (const sample of eventSamples) {
    if (sample.tick > maxTick) maxTick = sample.tick;
  }
  return Number((maxTick * tickBaseUs) / 1_000_000n);
}

/**
 * Download all chunks for a file from S3 and write them sequentially to a
 * local file by appending each chunk's bytes.
 */
async function assembleChunks(
  chunkKeys: string[],
  destPath: string,
): Promise<void> {
  for (const key of chunkKeys) {
    const res = await s3Client.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME!, Key: key }),
    );
    const bytes = await res.Body!.transformToByteArray();
    appendFileSync(destPath, Buffer.from(bytes));
  }
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

  // If the run doesn't exist yet, then meta.dlf is required
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
    const uploadDir = getRunUploadDir(uuid);
    try {
      mkdirSync(uploadDir, { recursive: true });

      // Assemble each DLF file from chunks
      const assembledFiles: string[] = [];
      for (const filename of files) {
        const chunkKeys = await listChunkKeys(uuid, filename);
        if (chunkKeys.length === 0) {
          console.warn(
            `[api/upload/finalize] No chunks found for ${uuid}/${filename}, skipping`,
          );
          continue;
        }

        const destPath = resolve(uploadDir, filename);
        console.log(
          `[api/upload/finalize] Assembling ${chunkKeys.length} chunks for ${uuid}/${filename}`,
        );
        await assembleChunks(chunkKeys, destPath);
        assembledFiles.push(filename);
      }

      if (assembledFiles.length === 0) {
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

      // Create or update run record
      const adapter = new FSAdapter(uploadDir);
      if (!runExists) {
        const [metaHeader, polledSamples, eventSamples] = await Promise.all([
          adapter.meta_header(),
          adapter.polled_data().catch(() => []),
          adapter.events_data().catch(() => []),
        ]);
        const durationS = await computeRunDurationS(
          polledSamples,
          eventSamples,
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
          `[api/upload/finalize] Created new run ${uuid}, isActive: ${isActive}, durationS: ${durationS}s`,
        );
      } else {
        const updateData: Parameters<typeof prisma.run.update>[0]["data"] = {
          isActive,
        };
        if (
          assembledFiles.includes("polled.dlf") ||
          assembledFiles.includes("event.dlf")
        ) {
          const [polledSamples, eventSamples] = await Promise.all([
            adapter.polled_data().catch(() => []),
            adapter.events_data().catch(() => []),
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
        assembledFiles.map((filename) => {
          const key = dlfS3Key(uuid, filename);
          const filePath = resolve(uploadDir, filename);
          console.log(
            `[api/upload/finalize] Uploading assembled file to S3: ${key}`,
          );
          return withRetry(() =>
            s3Client.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: createReadStream(filePath),
                ContentType: "application/octet-stream",
              }),
            ),
          );
        }),
      );

      // In order to support visualization of active runs (and thus partial run uploads), only
      // delete chunk objects from S3 when finalized with isActive=false.
      // Intermediate finalizes leave chunks in place so that future partial uploads can continue
      // accumulating and re-assembling.
      if (!isActive) {
        for (const filename of assembledFiles) {
          const chunkKeys = await listChunkKeys(uuid, filename);
          for (let i = 0; i < chunkKeys.length; i += 1000) {
            const batch = chunkKeys.slice(i, i + 1000);
            await s3Client.send(
              new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: { Objects: batch.map((Key) => ({ Key })) },
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
    } finally {
      try {
        rmSync(uploadDir, { recursive: true, force: true });
      } catch {}
    }
  });

  return NextResponse.json({ message: "Finalize accepted" }, { status: 202 });
}
