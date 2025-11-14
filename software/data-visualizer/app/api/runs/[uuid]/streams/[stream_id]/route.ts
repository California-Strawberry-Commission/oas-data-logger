import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string; stream_id: string }> }
) {
  const { uuid, stream_id } = await params;

  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ADMINs can view everything
    // USERs can only view runs for devices they are associated with
    const runWhere =
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
      where: runWhere,
      select: { id: true },
    });

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
      }))
    );
  } catch (err) {
    console.error("GET /api/runs/[uuid]/streams/[stream_id] error:", err);
    return NextResponse.json(
      { error: "Error retrieving run data" },
      { status: 500 }
    );
  }
}
