import { getCurrentUser } from "@/lib/auth";
import prisma, { getRunForUser } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/runs/[uuid]/streams/[streamId]
 *
 * Returns data points for the specific stream for the run.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string; streamId: string }> },
) {
  const { uuid, streamId } = await params;

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
        streamId,
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
        tick: Number(d.tick),
      })),
    );
  } catch (err) {
    console.error("GET /api/runs/[uuid]/streams/[streamId] error:", err);
    return NextResponse.json(
      { error: "Error retrieving run data" },
      { status: 500 },
    );
  }
}
