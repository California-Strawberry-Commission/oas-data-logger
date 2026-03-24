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
        deviceId: true,
        epochTimeS: true,
        tickBaseUs: true,
        durationS: true,
        metadata: true,
        isActive: true,
      },
    });

    const result = runs.map((run) => {
      return {
        uuid: run.uuid,
        deviceId: run.deviceId,
        epochTimeS: Number(run.epochTimeS),
        tickBaseUs: Number(run.tickBaseUs),
        durationS: run.durationS,
        metadata: run.metadata,
        isActive: run.isActive,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/devices/[id]/runs error:", err);
    return NextResponse.json(
      { error: "Failed to fetch runs" },
      { status: 500 },
    );
  }
}
