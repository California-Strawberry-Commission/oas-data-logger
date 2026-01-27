import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;

  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ADMINs can view everything
    // USERs can only view runs for devices they are associated with
    const where =
      user.role === "ADMIN"
        ? { uuid }
        : {
            uuid,
            device: {
              userDevices: {
                some: {
                  userId: user.id,
                },
              },
            },
          };
    const run = await prisma.run.findFirst({
      where,
    });

    if (!run) {
      // Either run doesn't exist, or user has no access to it
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const streams = await prisma.runData.groupBy({
      by: ["streamId", "streamType"],
      where: { runId: run.id },
      _count: { streamId: true },
    });

    return NextResponse.json({
      uuid: run.uuid,
      epochTimeS: run.epochTimeS.toString(), // convert BigInt to string for JSON serialization
      tickBaseUs: run.tickBaseUs.toString(), // convert BigInt to string for JSON serialization
      isActive: run.isActive,
      metadata: run.metadata,
      streams: streams.map((s) => ({
        streamId: s.streamId,
        streamType: s.streamType,
        count: s._count.streamId,
      })),
    });
  } catch (err) {
    console.error("GET /api/runs/[uuid] error:", err);
    return NextResponse.json(
      { error: "Failed to fetch run data" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;

  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ADMINs can view everything
    // USERs can only view runs for devices they are associated with
    const where =
      user.role === "ADMIN"
        ? { uuid }
        : {
            uuid,
            device: {
              userDevices: {
                some: {
                  userId: user.id,
                },
              },
            },
          };
    const run = await prisma.run.findFirst({
      where,
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
