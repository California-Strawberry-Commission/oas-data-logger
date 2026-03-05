import { getCurrentUser } from "@/lib/auth";
import prisma, { runsWhereForUser } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/devices/[id]/runs
 *
 * Returns the list of runs associated with the device.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: deviceId } = await params;

  try {
    const user = await getCurrentUser(request.headers);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authWhere = runsWhereForUser(user);
    const deviceWhere = {
      deviceId,
    };

    const runs = await prisma.run.findMany({
      where: {
        AND: [authWhere, deviceWhere],
      },
      select: {
        uuid: true,
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

    // Transform the data to include run duration
    const runsWithStatus = runs.map((run) => {
      // Calculate last data time based on the highest tick
      let durationS: number = 0;
      if (run.runData.length > 0) {
        const lastTick: bigint = run.runData[0].tick;
        const tickUs: bigint = run.tickBaseUs ?? 100_000n; // default 100ms if not set

        // Perform calculation with bigint to avoid precision loss
        durationS = Number((lastTick * tickUs) / 1_000_000n);
      }

      return {
        uuid: run.uuid,
        deviceId,
        epochTimeS: Number(run.epochTimeS),
        durationS,
        tickBaseUs: Number(run.tickBaseUs),
        metadata: run.metadata,
        isActive: run.isActive,
      };
    });

    return NextResponse.json(runsWithStatus);
  } catch (err) {
    console.error("GET /api/devices/[id]/runs error:", err);
    return NextResponse.json(
      { error: "Failed to fetch runs" },
      { status: 500 },
    );
  }
}
