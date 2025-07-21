import prisma from "@/lib/prisma";
import { FSAdapter } from "dlflib-js/dist/fsadapter.js";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { resolve } from "path";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = "/tmp/oas/uploads";

function getRunUploadDir(runUuid: string) {
  return resolve(UPLOAD_DIR, runUuid);
}

// Store file data in the database for persistence across requests
async function persistFileData(runId: number, fileName: string, data: Buffer) {
  await prisma.runFile.upsert({
    where: {
      runId_fileName: {
        runId,
        fileName
      }
    },
    update: {
      data,
      updatedAt: new Date()
    },
    create: {
      runId,
      fileName,
      data
    }
  });
}

// Retrieve persisted file data from database
async function getPersistedFiles(runId: number): Promise<Map<string, Buffer>> {
  const files = await prisma.runFile.findMany({
    where: { runId },
    select: {
      fileName: true,
      data: true
    }
  });
  
  const fileMap = new Map<string, Buffer>();
  files.forEach(file => {
    fileMap.set(file.fileName, file.data);
  });
  
  return fileMap;
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

    // Check if this run exists
    const existingRun = await prisma.run.findUnique({
      where: { uuid },
      select: { id: true }
    });

    let runId: number;
    const uploadedFiles = new Map<string, Buffer>();

    // Process uploaded files
    for (const file of files) {
      if (!(file instanceof File)) {
        console.log(`Non-file entry found:`, file);
        continue;
      }

      // Skip LOCK file - it's just a marker
      if (file.name === "LOCK") {
        console.log(`Skipping LOCK file`);
        continue;
      }

      console.log(`Processing file: ${file.name}, size: ${file.size} bytes`);
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      uploadedFiles.set(file.name, buffer);
    }

    // For incremental uploads, we need to handle state differently
    if (!existingRun) {
      // New run - requires meta.dlf
      if (!uploadedFiles.has("meta.dlf")) {
        console.error(`ERROR: New run requires meta.dlf file`);
        return NextResponse.json(
          { error: "New run requires meta.dlf file" },
          { status: 400 }
        );
      }

      // Write all files to temp directory for initial processing
      for (const [fileName, buffer] of uploadedFiles) {
        const filePath = resolve(uploadDir, fileName);
        writeFileSync(filePath, buffer);
      }

      // Create the run
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

      // Persist all files to database
      for (const [fileName, buffer] of uploadedFiles) {
        await persistFileData(runId, fileName, buffer);
      }
    } else {
      // Existing run - retrieve persisted files and merge with new uploads
      runId = existingRun.id;
      console.log(`Updating existing run ${uuid}`);

      // Get previously uploaded files from database
      const persistedFiles = await getPersistedFiles(runId);
      
      // Merge persisted files with new uploads (new uploads overwrite)
      const allFiles = new Map(persistedFiles);
      for (const [fileName, buffer] of uploadedFiles) {
        allFiles.set(fileName, buffer);
        // Update persisted file data
        await persistFileData(runId, fileName, buffer);
      }

      // Write all files to temp directory for processing
      for (const [fileName, buffer] of allFiles) {
        const filePath = resolve(uploadDir, fileName);
        writeFileSync(filePath, buffer);
      }
    }

    // Now process the data with all files available
    const run = new FSAdapter(uploadDir);
    
    // Process event data if event.dlf exists
    if (existsSync(resolve(uploadDir, "event.dlf"))) {
      try {
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
      } catch (err) {
        console.log(`Event data processing skipped:`, err);
      }
    }

    // Process polled data if polled.dlf exists
    if (existsSync(resolve(uploadDir, "polled.dlf"))) {
      try {
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
      } catch (err) {
        console.log(`Polled data processing skipped:`, err);
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


async function ingestRun(runUuid: string): Promise<boolean> {
  const alreadyIngested = await prisma.run.count({ where: { uuid: runUuid } });
  if (alreadyIngested > 0) {
    console.log("Run " + runUuid + " already ingested. Ignoring");
    return false;
  }

  console.log("Ingesting run " + runUuid);
  const run = new FSAdapter(getRunUploadDir(runUuid));
  const metaHeader = await run.meta_header();

  const runInstance = await prisma.run.create({
    data: {
      uuid: runUuid,
      epochTimeS: metaHeader.epoch_time_s,
      tickBaseUs: metaHeader.tick_base_us,
      metadata: {},
    },
  });

  const eventsData = await run.events_data();
  await prisma.runData.createMany({
    data: eventsData.map((d) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = d.data as any;
      const dataStr =
        typeof data === "object" ? JSON.stringify(data) : data.toString();
      return {
        streamType: "EVENT",
        streamId: d.stream.id,
        tick: BigInt(d.tick),
        data: dataStr,
        runId: runInstance.id,
      };
    }),
  });

  const polledData = await run.polled_data();
  await prisma.runData.createMany({
    data: polledData.map((d) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = d.data as any;
      const dataStr =
        typeof data === "object" ? JSON.stringify(data) : data.toString();
      return {
        streamType: "POLLED",
        streamId: d.stream.id,
        tick: BigInt(d.tick),
        data: dataStr,
        runId: runInstance.id,
      };
    }),
  });

  console.log("Ingested data for run " + runUuid);
  return true;
}
