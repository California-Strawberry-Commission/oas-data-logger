import { getCurrentUser } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getRunForUser } from "@/lib/query-helpers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string; stream_id: string }> },
) {
  const { uuid, stream_id } = await params;

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
        streamId: stream_id,
      },
      select: {
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
        tick: d.tick.toString(),
      })),
    );
  } catch (err) {
    console.error("GET /api/runs/[uuid]/streams/[stream_id] error:", err);
    return NextResponse.json(
      { error: "Error retrieving run data" },
      { status: 500 },
    );
  }
}
