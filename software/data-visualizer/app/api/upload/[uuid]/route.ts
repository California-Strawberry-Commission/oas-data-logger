import prisma from "@/lib/prisma";
import { FSAdapter } from "dlflib-js/dist/fsadapter.js";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { resolve } from "path";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = "uploads";

function getRunUploadDir(runUuid: string) {
  return resolve(UPLOAD_DIR, runUuid);
}

// Each run is associated with 3 files (meta.dlf, event.dlf, polled.dlf)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  const uploadDir = getRunUploadDir(uuid);

  try {
    mkdirSync(uploadDir, { recursive: true });

    const formData = await request.formData();
    const files = formData.getAll("files");

    const expected = new Set(["meta.dlf", "event.dlf", "polled.dlf"]);
    const uploaded = new Set<string>();

    for (const file of files) {
      if (!(file instanceof File)) {
        continue;
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const filePath = resolve(uploadDir, file.name);
      writeFileSync(filePath, buffer);
      uploaded.add(file.name);
    }

    // Check that all expected files are present
    for (const name of expected) {
      if (!uploaded.has(name)) {
        return NextResponse.json(
          { error: `Missing file: ${name}` },
          { status: 400 }
        );
      }
    }

    await ingestRun(uuid);
    return NextResponse.json({ message: "Upload successful" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  } finally {
    // Clean up locally uploaded files
    try {
      rmSync(uploadDir, { recursive: true, force: true });
    } catch {}
  }
}

async function ingestRun(runUuid: string) {
  const alreadyIngested = await prisma.run.count({ where: { uuid: runUuid } });
  if (alreadyIngested > 0) {
    console.log("Run " + runUuid + " already ingested. Ignoring");
    return;
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
}
