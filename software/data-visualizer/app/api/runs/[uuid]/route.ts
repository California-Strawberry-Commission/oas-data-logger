import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;

  try {
    const run = await prisma.run.findUnique({
      where: { uuid },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const streams = await prisma.runData.groupBy({
      by: ["streamId", "streamType"],
      where: { runId: run.id },
      _count: { streamId: true },
    });

    return NextResponse.json({
      uuid: run.uuid,
      epochTimeS: Number(run.epochTimeS),
      tickBaseUs: Number(run.tickBaseUs),
      metadata: run.metadata,
      streams: streams.map((s) => ({
        streamId: s.streamId,
        streamType: s.streamType,
        count: s._count.streamId,
      })),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch run data" },
      { status: 500 }
    );
  }
}
