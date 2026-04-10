import { getCurrentUser } from "@/lib/auth";
import prisma, { runsWhereForUser } from "@/lib/prisma";
import { isValidUuid } from "@/lib/utils";
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
  // Parse and validate UUID list
  const { searchParams } = new URL(request.url);
  const uuids = searchParams.get("uuids")?.split(",").filter(Boolean) ?? [];
  if (uuids.length === 0) {
    return NextResponse.json({ error: "No UUIDs provided" }, { status: 400 });
  }
  // Limit the number of UUIDs to prevent abuse
  if (uuids.length > 10) {
    return NextResponse.json({ error: "Too many UUIDs" }, { status: 400 });
  }
  if (!uuids.every(isValidUuid)) {
    return NextResponse.json(
      { error: "One or more UUIDs are invalid" },
      { status: 400 },
    );
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
    console.error("GET /api/runs error:", err);
    return NextResponse.json(
      { error: "Failed to fetch runs" },
      { status: 500 },
    );
  }
}
