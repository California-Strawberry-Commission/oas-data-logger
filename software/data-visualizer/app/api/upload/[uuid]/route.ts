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

    const expected = new Set(["meta.dlf", "event.dlf", "polled.dlf"]);
    const uploaded = new Set<string>();

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
    }

    // Check that all expected files are present
    console.log(`Expected files:`, Array.from(expected));
    console.log(`Uploaded files:`, Array.from(uploaded));
    
    for (const name of expected) {
      if (!uploaded.has(name)) {
        console.error(`ERROR: Missing file: ${name}`);
        return NextResponse.json(
          { error: `Missing file: ${name}` },
          { status: 400 }
        );
      }
    }

    console.log(`All required files present, ingesting run...`);
    const res = await ingestRun(uuid);
    console.log(`Ingestion result:`, res);
    
    return NextResponse.json({
      message: res ? "Upload successful" : "Run already exists. Ignored",
    });
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
