import { getCurrentUser } from "@/lib/auth";
import { getRunDlfAdapter } from "@/lib/dlf-s3";
import { getRunForUser } from "@/lib/prisma";
import { isValidUuid } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/runs/[uuid]/streams
 *
 * Fetches stream data records for a specific run.
 *
 * Query Parameters:
 * - stream_ids (required): Comma-separated list of stream IDs to retrieve.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  // Parse and validate UUID
  const { uuid } = await params;
  if (!isValidUuid(uuid)) {
    return NextResponse.json({ error: "Invalid run UUID" }, { status: 400 });
  }

  // Parse and validate stream ID list
  const { searchParams } = new URL(request.url);
  const streamIds =
    searchParams.get("stream_ids")?.split(",").filter(Boolean) ?? [];
  if (streamIds.length === 0) {
    return NextResponse.json(
      { error: "No stream IDs provided" },
      { status: 400 },
    );
  }
  // Limit the number of stream IDs to prevent abuse
  if (streamIds.length > 20) {
    return NextResponse.json({ error: "Too many stream IDs" }, { status: 400 });
  }

  try {
    const user = await getCurrentUser(request.headers);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
    const streamIdSet = new Set(streamIds);

    // Process polled data
    for (const sample of polledSamples) {
      if (!streamIdSet.has(sample.stream.id)) {
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
      if (!streamIdSet.has(sample.stream.id)) {
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
    console.error("GET /api/runs/[uuid]/streams error:", err);
    return NextResponse.json(
      { error: "Failed to fetch streams" },
      { status: 500 },
    );
  }
}
