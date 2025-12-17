import prisma from "@/lib/prisma";
import { FSAdapter } from "dlflib-js";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { resolve } from "path";

export const dynamic = "force-dynamic";

// Vercel Serverless Functions only allow writes to /tmp
const UPLOAD_DIR = "/tmp/oas/uploads";

const ACCEPTED_FILES = new Set<string>(["meta.dlf", "event.dlf", "polled.dlf"]);

function getRunUploadDir(runUuid: string) {
  return resolve(UPLOAD_DIR, runUuid);
}

// Each run is associated with 3 files (meta.dlf, event.dlf, polled.dlf).
// Handles incremental uploads - if uploading a new run, meta.dlf is required.
// If updating an existing run, we ignore any data logged earlier than what is
// already in the DB.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  const uploadDir = getRunUploadDir(uuid);

  try {
    mkdirSync(uploadDir, { recursive: true });

    // Parse form data
    const formData = await request.formData();

    // Process deviceUid field (REQUIRED)
    const deviceUid = formData.get("deviceUid");
    if (typeof deviceUid !== "string" || deviceUid.trim() === "") {
      return NextResponse.json(
        { error: "Missing or invalid deviceUid" },
        { status: 400 }
      );
    }

    // Ensure device exists (create if missing)
    const device = await prisma.device.upsert({
      where: { deviceUid },
      update: {},
      create: { deviceUid },
      select: { id: true },
    });

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
          { status: 400 }
        );
      }
    }

    console.log(
      `[api/upload] Handling upload request for run: ${uuid}, deviceUid: ${deviceUid}, isActive: ${isActive}`
    );

    // Save uploaded files
    const files = formData.getAll("files");
    const uploadedFiles = new Set<string>();
    for (const file of files) {
      if (!(file instanceof File) || !ACCEPTED_FILES.has(file.name)) {
        continue;
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const filePath = resolve(uploadDir, file.name);
      console.log(`[api/upload] Writing ${filePath}`);
      writeFileSync(filePath, buffer);
      uploadedFiles.add(file.name);
    }

    // Check if this run already exists and upload is from the same device
    const existingRun = await prisma.run.findUnique({
      where: { uuid },
      select: { id: true, deviceId: true },
    });
    const runExists = !!existingRun;
    if (runExists) {
      console.log(`[api/upload] Existing run found for uuid ${uuid}`);
      if (existingRun!.deviceId !== device.id) {
        return NextResponse.json(
          {
            error: `Run with uuid ${uuid} already associated with a different device`,
          },
          { status: 409 }
        );
      }
    }

    const runData = new FSAdapter(uploadDir);

    // Create new run if it does not exist yet
    let runId: number;
    if (!runExists) {
      if (!uploadedFiles.has("meta.dlf")) {
        console.log(
          `[api/upload] Attempting to create a new run with uuid ${uuid} but request is missing meta.dlf`
        );
        return NextResponse.json(
          { error: "Cannot create a new run without meta.dlf" },
          { status: 400 }
        );
      }

      console.log(`[api/upload] Creating new run ${uuid}`);
      const metaHeader = await runData.meta_header();
      const runInstance = await prisma.run.create({
        data: {
          uuid: uuid,
          deviceId: device.id,
          epochTimeS: metaHeader.epoch_time_s,
          tickBaseUs: metaHeader.tick_base_us,
          metadata: {},
          isActive,
        },
        select: { id: true },
      });
      runId = runInstance.id;
    } else {
      console.log(
        `[api/upload] Appending to existing run ${uuid}. Updating isActive to ${isActive}`
      );
      runId = existingRun.id;
      // Update isActive on existing run
      await prisma.run.update({
        where: { id: runId },
        data: { isActive },
      });
    }

    // Event data
    if (uploadedFiles.has("event.dlf")) {
      try {
        const eventsData = await runData.events_data();

        // Find the greatest tick already in RunData for this run
        const latestTickRow = await prisma.runData.findFirst({
          where: {
            runId: runId,
            streamType: "EVENT",
          },
          orderBy: { tick: "desc" },
          select: { tick: true },
        });
        const latestTick = latestTickRow?.tick ?? BigInt(-1);

        // Filter out items in eventsData whose tick <= latestTick
        const newEvents = eventsData.filter(
          (d: any) => BigInt(d.tick) > latestTick
        );

        if (newEvents.length > 0) {
          await prisma.runData.createMany({
            data: newEvents.map((d: any) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const data = d.data as any;
              const dataStr =
                typeof data === "object"
                  ? JSON.stringify(data)
                  : data.toString();
              return {
                streamType: "EVENT",
                streamId: d.stream.id,
                tick: BigInt(d.tick),
                data: dataStr,
                runId,
              };
            }),
          });
          console.log(
            `[api/upload] Created ${newEvents.length} new EVENT records`
          );
        } else {
          console.log("[api/upload] No new EVENT data created");
        }
      } catch (err) {
        console.error(
          "[api/upload] Event data processing skipped due to error:",
          err
        );
      }
    }

    // Polled data
    if (uploadedFiles.has("polled.dlf")) {
      try {
        const polledData = await runData.polled_data();

        // Get the last tick for each stream
        const latestTicksByStream = await prisma.runData.groupBy({
          by: ["streamId"],
          where: {
            runId: runId,
            streamType: "POLLED",
          },
          _max: {
            tick: true,
          },
        });
        const latestTickMap = new Map<string, bigint>(
          latestTicksByStream.map((item) => [
            item.streamId,
            item._max.tick ? item._max.tick : BigInt(-1),
          ])
        );

        // Filter to only new polled data
        const newPolled = polledData.filter((d) => {
          const latestTick = latestTickMap.get(d.stream.id) || BigInt(-1);
          return BigInt(d.tick) > latestTick;
        });

        if (newPolled.length > 0) {
          await prisma.runData.createMany({
            data: newPolled.map((d) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const data = d.data as any;
              const dataStr =
                typeof data === "object"
                  ? JSON.stringify(data)
                  : data.toString();
              return {
                streamType: "POLLED",
                streamId: d.stream.id,
                tick: BigInt(d.tick),
                data: dataStr,
                runId: runId,
              };
            }),
          });
          console.log(
            `[api/upload] Created ${newPolled.length} new POLLED records`
          );
        } else {
          console.log("[api/upload] No new POLLED data created");
        }
      } catch (err) {
        console.error(
          "[api/upload] Polled data processing skipped due to error:",
          err
        );
      }
    }

    const message = runExists
      ? "Upload successful - data appended to existing run"
      : "Upload successful - new run created";
    console.log(message);
    return NextResponse.json({ message });
  } catch (err) {
    console.error(`ERROR in upload handler:`, err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  } finally {
    // Clean up tmp files
    try {
      rmSync(uploadDir, { recursive: true, force: true });
    } catch {}
  }
}
