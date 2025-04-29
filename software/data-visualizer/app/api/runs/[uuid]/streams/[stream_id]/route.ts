import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string; stream_id: string }> }
) {
  const { uuid, stream_id } = await params;

  try {
    const run = await prisma.run.findUnique({
      where: { uuid },
      select: { id: true },
    });

    if (!run) {
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
    console.error(err);
    return NextResponse.json(
      { error: "Error retrieving run data" },
      { status: 500 }
    );
  }
}
