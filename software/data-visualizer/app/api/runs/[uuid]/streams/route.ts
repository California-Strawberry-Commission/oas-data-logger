import { getCurrentUser } from "@/lib/auth";
import prisma, { getRunForUser } from "@/lib/prisma";
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
  const { uuid } = await params;
  const { searchParams } = new URL(request.url);
  const stream_ids = searchParams.get("stream_ids");

  if (!stream_ids) {
    return NextResponse.json(
      { error: "stream_ids query parameter is required" },
      { status: 400 },
    );
  }

  const streamIdsArray = stream_ids.split(",");

  try {
    const user = await getCurrentUser(request.headers);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const run = await getRunForUser(user, uuid, { select: { id: true } });
    if (!run) {
      // Either run doesn't exist, or user has no access to it
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const runData = await prisma.runData.findMany({
      where: {
        runId: run.id,
        streamId: { in: streamIdsArray },
      },
      select: {
        streamId: true,
        streamType: true,
        tick: true,
        data: true,
      },
      orderBy: {
        tick: "asc",
      },
    });

    return NextResponse.json(
      runData.map((d) => ({
        ...d,
        tick: Number(d.tick),
      })),
    );
  } catch (err) {
    console.error("GET /api/runs/[uuid]/streams error:", err);
    return NextResponse.json(
      { error: "Failed to fetch streams" },
      { status: 500 },
    );
  }
}
