import { getCurrentUser } from "@/lib/auth";
import prisma, { getRunForUser, runWhereForUser } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/runs/[uuid]
 *
 * Returns the run's metadata. Does not include any stream information.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;

  try {
    const user = await getCurrentUser(request.headers);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const where = runWhereForUser(user, uuid);
    const run = await prisma.run.findFirst({
      where,
      select: {
        uuid: true,
        deviceId: true,
        epochTimeS: true,
        tickBaseUs: true,
        metadata: true,
        isActive: true,
        // Get the latest tick available, used for calculating the duration
        runData: {
          select: {
            tick: true,
          },
          orderBy: {
            tick: "desc",
          },
          take: 1,
        },
      },
    });

    if (!run) {
      // Either run doesn't exist, or user has no access to it
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Calculate duration
    let durationS: number = 0;
    if (run.runData.length > 0) {
      const lastTick: bigint = run.runData[0].tick;
      const tickUs: bigint = run.tickBaseUs ?? 100_000n; // default 100ms if not set

      // Perform calculation with bigint to avoid precision loss
      durationS = Number((lastTick * tickUs) / 1_000_000n);
    }

    return NextResponse.json({
      uuid: run.uuid,
      deviceId: run.deviceId,
      epochTimeS: Number(run.epochTimeS),
      durationS,
      tickBaseUs: Number(run.tickBaseUs),
      metadata: run.metadata,
      isActive: run.isActive,
    });
  } catch (err) {
    console.error("GET /api/runs/[uuid] error:", err);
    return NextResponse.json(
      { error: "Failed to fetch run data" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/runs/[uuid]
 *
 * Deletes the run.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;

  try {
    const user = await getCurrentUser(request.headers);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const run = await getRunForUser(user, uuid, {
      select: { id: true, uuid: true },
    });
    if (!run) {
      // Either run doesn't exist, or user has no access to it
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    await prisma.run.delete({ where: { id: run.id } });
  } catch (err) {
    console.error("DELETE /api/runs/[uuid] error:", err);
    return NextResponse.json(
      { error: "Failed to delete run" },
      { status: 500 },
    );
  }

  return new NextResponse(null, { status: 204 });
}
