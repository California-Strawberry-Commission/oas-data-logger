import { User, withAuth } from "@/lib/auth";
import prisma, { runsWhereForUser } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/devices/[id]/runs
 *
 * Returns the list of runs associated with the device.
 */
export const GET = withAuth(
  async (_request: NextRequest, user: User, context) => {
    const { id: deviceId } = (await context.params) as { id: string };

    try {
      const authWhere = runsWhereForUser(user);
      const runs = await prisma.run.findMany({
        where: {
          AND: [authWhere, { deviceId }],
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

      const result = runs.map((run) => ({
        uuid: run.uuid,
        deviceId: run.deviceId,
        epochTimeS: Number(run.epochTimeS),
        tickBaseUs: Number(run.tickBaseUs),
        durationS: run.durationS,
        metadata: run.metadata,
        isActive: run.isActive,
      }));

      return NextResponse.json(result);
    } catch (err) {
      console.error("GET /api/devices/[id]/runs error:", err);
      return NextResponse.json(
        { error: "Failed to fetch runs" },
        { status: 500 },
      );
    }
  },
);
