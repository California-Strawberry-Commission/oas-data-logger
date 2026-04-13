import { User, withAuth } from "@/lib/auth";
import { getRunDlfAdapter } from "@/lib/dlf-s3";
import { getRunForUser } from "@/lib/prisma";
import { isValidUuid } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/runs/[uuid]/streams/[streamId]
 *
 * Returns data points for the specific stream for the run.
 */
export const GET = withAuth(async (_request: NextRequest, user: User, context) => {
  const { uuid, streamId } = await context.params as { uuid: string; streamId: string };

  if (!isValidUuid(uuid)) {
    return NextResponse.json({ error: "Invalid run UUID" }, { status: 400 });
  }

  try {
    const run = await getRunForUser(user, uuid, { select: { id: true } });
    if (!run) {
      // Either run doesn't exist, or user does not have access to it
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Fetch DLF files from S3 and read data
    const adapter = await getRunDlfAdapter(uuid);
    if (!adapter) {
      return NextResponse.json([]);
    }

    const [polledSamples, eventSamples] = await Promise.all([
      adapter.polled_data(),
      adapter.events_data(),
    ]);

    const result: { streamId: string; tick: number; data: unknown }[] = [];

    // Process polled data
    for (const sample of polledSamples) {
      if (sample.stream.id !== streamId) {
        continue;
      }
      result.push({
        streamId: sample.stream.id,
        tick: Number(sample.tick),
        data: sample.data,
      });
    }

    // Process event data
    for (const sample of eventSamples) {
      if (sample.stream.id !== streamId) {
        continue;
      }
      result.push({
        streamId: sample.stream.id,
        tick: Number(sample.tick),
        data: sample.data,
      });
    }

    result.sort((a, b) => a.tick - b.tick);
    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/runs/[uuid]/streams/[streamId] error:", err);
    return NextResponse.json(
      { error: "Error retrieving run data" },
      { status: 500 },
    );
  }
});
