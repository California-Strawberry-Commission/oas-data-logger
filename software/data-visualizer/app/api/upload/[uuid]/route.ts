import prisma from "@/lib/prisma";
import { FSAdapter } from "dlflib-js/dist/fsadapter.js";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { resolve } from "path";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = "/tmp/oas/uploads";

function getRunUploadDir(runUuid: string) {
  return resolve(UPLOAD_DIR, runUuid);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  console.log(`\n=== UPLOAD REQUEST RECEIVED ===`);
  console.log(`UUID: ${uuid}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Headers:`, Object.fromEntries(request.headers.entries()));
  
  const uploadDir = getRunUploadDir(uuid);

  try {
    mkdirSync(uploadDir, { recursive: true });

    const formData = await request.formData();
    console.log(`FormData entries:`, Array.from(formData.keys()));
    
    const files = formData.getAll("files");
    console.log(`Number of files received: ${files.length}`);

    const uploaded = new Set<string>();
    const fileMap = new Map<string, File>();

    for (const file of files) {
      if (!(file instanceof File)) {
        console.log(`Non-file entry found:`, file);
        continue;
      }

      console.log(`Processing file: ${file.name}, size: ${file.size} bytes`);
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const filePath = resolve(uploadDir, file.name);
      writeFileSync(filePath, buffer);
      uploaded.add(file.name);
      fileMap.set(file.name, file);
    }

    // For partial uploads, we need different logic
    const hasMetaFile = uploaded.has("meta.dlf");
    const hasEventFile = uploaded.has("event.dlf");
    const hasPolledFile = uploaded.has("polled.dlf");

    console.log(`Files present - Meta: ${hasMetaFile}, Event: ${hasEventFile}, Polled: ${hasPolledFile}`);

    // Check if this is a new run or an update
    const existingRun = await prisma.run.findUnique({
      where: { uuid },
      select: { id: true }
    });

    if (!existingRun && !hasMetaFile) {
      console.error(`ERROR: New run requires meta.dlf file`);
      return NextResponse.json(
        { error: "New run requires meta.dlf file" },
        { status: 400 }
      );
    }

    let runId: number;

    if (!existingRun) {
      // New run - create it
      console.log(`Creating new run ${uuid}`);
      const run = new FSAdapter(uploadDir);
      const metaHeader = await run.meta_header();

      const runInstance = await prisma.run.create({
        data: {
          uuid: uuid,
          epochTimeS: metaHeader.epoch_time_s,
          tickBaseUs: metaHeader.tick_base_us,
          metadata: {},
        },
      });
      runId = runInstance.id;
    } else {
      // Existing run - use its ID
      console.log(`Updating existing run ${uuid}`);
      runId = existingRun.id;
    }

    // Process event data if present
    if (hasEventFile) {
      const run = new FSAdapter(uploadDir);
      const eventsData = await run.events_data();
      
      // Get the last tick we have for this run to only insert new data
      const lastEventTick = await prisma.runData.findFirst({
        where: {
          runId: runId,
          streamType: "EVENT"
        },
        orderBy: {
          tick: 'desc'
        },
        select: {
          tick: true
        }
      });

      const lastTick = lastEventTick ? BigInt(lastEventTick.tick) : BigInt(-1);
      
      // Filter to only new events
      const newEvents = eventsData.filter(d => BigInt(d.tick) > lastTick);
      
      if (newEvents.length > 0) {
        console.log(`Inserting ${newEvents.length} new event records`);
        await prisma.runData.createMany({
          data: newEvents.map((d) => {
            const data = d.data as any;
            const dataStr =
              typeof data === "object" ? JSON.stringify(data) : data.toString();
            return {
              streamType: "EVENT",
              streamId: d.stream.id,
              tick: BigInt(d.tick),
              data: dataStr,
              runId: runId,
            };
          }),
        });
      }
    }

    // Process polled data if present
    if (hasPolledFile) {
      const run = new FSAdapter(uploadDir);
      const polledData = await run.polled_data();
      
      // Get the last tick for each stream
      const lastPolledTicks = await prisma.runData.groupBy({
        by: ['streamId'],
        where: {
          runId: runId,
          streamType: "POLLED"
        },
        _max: {
          tick: true
        }
      });

      const lastTickMap = new Map(
        lastPolledTicks.map(item => [item.streamId, item._max.tick ? BigInt(item._max.tick) : BigInt(-1)])
      );
      
      // Filter to only new polled data
      const newPolled = polledData.filter(d => {
        const lastTick = lastTickMap.get(d.stream.id) || BigInt(-1);
        return BigInt(d.tick) > lastTick;
      });
      
      if (newPolled.length > 0) {
        console.log(`Inserting ${newPolled.length} new polled records`);
        await prisma.runData.createMany({
          data: newPolled.map((d) => {
            const data = d.data as any;
            const dataStr =
              typeof data === "object" ? JSON.stringify(data) : data.toString();
            return {
              streamType: "POLLED",
              streamId: d.stream.id,
              tick: BigInt(d.tick),
              data: dataStr,
              runId: runId,
            };
          }),
        });
      }
    }

    const message = existingRun 
      ? "Partial upload successful - data appended" 
      : "Initial upload successful - run created";
    
    console.log(message);
    return NextResponse.json({ message });
    
  } catch (err) {
    console.error(`ERROR in upload handler:`, err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  } finally {
    try {
      rmSync(uploadDir, { recursive: true, force: true });
    } catch {}
  }
}