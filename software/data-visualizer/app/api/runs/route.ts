import { getCurrentUser } from "@/lib/auth";
import prisma, { runsWhereForUser } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/runs
 *
 * Returns metadata for multiple runs. Does not include any stream information.
 *
 * Query Parameters:
 * - uuids (required): Comma-separated list of run UUIDs to retrieve
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const uuids = searchParams.get("uuids")?.split(",").filter(Boolean) ?? [];

  if (uuids.length === 0) {
    return NextResponse.json({ error: "No UUIDs provided" }, { status: 400 });
  }

  try {
    const user = await getCurrentUser(request.headers);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authWhere = runsWhereForUser(user);
    const runsWhere = {
      uuid: { in: uuids },
    };
    const runs = await prisma.run.findMany({
      where: {
        AND: [authWhere, runsWhere],
      },
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

    // Transform the data to include run duration
    const result = runs.map((run) => {
      // Calculate duration
      let durationS = 0;
      if (run.runData.length > 0) {
        const lastTick: bigint = run.runData[0].tick;
        const tickUs: bigint = run.tickBaseUs ?? 100_000n; // default 100ms if not set
        // Perform calculation with bigint to avoid precision loss
        durationS = Number((lastTick * tickUs) / 1_000_000n);
      }
      return {
        uuid: run.uuid,
        deviceId: run.deviceId,
        epochTimeS: Number(run.epochTimeS),
        durationS,
        tickBaseUs: Number(run.tickBaseUs),
        metadata: run.metadata,
        isActive: run.isActive,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/runs error:", err);
    return NextResponse.json(
      { error: "Failed to fetch runs" },
      { status: 500 },
    );
  }
}
