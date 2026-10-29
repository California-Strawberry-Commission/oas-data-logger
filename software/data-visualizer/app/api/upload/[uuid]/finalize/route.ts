import {
  BufferAdapter,
  DLF_FILES,
  assembleRunFilesToBuffers,
  computeRunDurationS,
  listChunkKeys,
  uploadAssembledRunFiles,
} from "@/lib/dlf-s3";
import prisma from "@/lib/prisma";
import { s3Client } from "@/lib/s3";
import { isValidUuid } from "@/lib/utils";
import { verifyDeviceSignature } from "@/lib/verify-device";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse, after } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/upload/[uuid]/finalize
 *
 * Triggers assembly of previously uploaded chunks and DB record creation.
 *
 * Headers:
 *   x-is-active: "true" if the run is still recording, omit or any other value for false.
 *
 * Returns 202 immediately; assembly + S3 upload + DB write happen in background.
 * All three DLF files (meta.dlf, polled.dlf, event.dlf) are assembled from their
 * chunks. Files with no chunks are silently skipped.
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

  const isActive = request.headers.get("x-is-active") === "true";

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

  console.log(
    `[api/upload/finalize] Accepted finalize for run: ${uuid}, deviceId: ${deviceId}, isActive: ${isActive}`,
  );

  after(async () => {
    try {
      // Assemble all DLF files from chunks into memory, skipping files with no chunks
      const fileBuffers = await assembleRunFilesToBuffers(uuid);
      for (const filename of DLF_FILES) {
        const buf = fileBuffers.get(filename);
        if (!buf) {
          console.warn(
            `[api/upload/finalize] No chunks found for ${uuid}/${filename}, skipping`,
          );
          continue;
        }
        console.log(
          `[api/upload/finalize] Assembled chunks for ${uuid}/${filename} (${buf.byteLength} bytes)`,
        );
      }

      if (fileBuffers.size === 0) {
        console.error(
          `[api/upload/finalize] No files assembled for run ${uuid}`,
        );
        return;
      }

      // If the run doesn't exist yet, then meta.dlf is required for the epoch time and tick base
      if (!runExists && !fileBuffers.has("meta.dlf")) {
        console.error(
          `[api/upload/finalize] meta.dlf required to create run ${uuid}`,
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
        const durationS = computeRunDurationS(
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
          updateData.durationS = computeRunDurationS(
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
      console.log(
        `[api/upload/finalize] Uploading assembled files to S3 for run ${uuid}: [${[...fileBuffers.keys()].join(", ")}]`,
      );
      await uploadAssembledRunFiles(uuid, fileBuffers);
      const bucket = process.env.S3_BUCKET_NAME!;

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
