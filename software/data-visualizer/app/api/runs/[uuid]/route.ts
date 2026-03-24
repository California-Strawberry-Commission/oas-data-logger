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
        durationS: true,
        metadata: true,
        isActive: true,
      },
    });

    if (!run) {
      // Either run doesn't exist, or user has no access to it
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json({
      uuid: run.uuid,
      deviceId: run.deviceId,
      epochTimeS: Number(run.epochTimeS),
      tickBaseUs: Number(run.tickBaseUs),
      durationS: run.durationS,
      metadata: run.metadata,
      isActive: run.isActive,
    });
  } catch (err) {
    console.error("GET /api/runs/[uuid] error:", err);
    return NextResponse.json({ error: "Failed to fetch run" }, { status: 500 });
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
