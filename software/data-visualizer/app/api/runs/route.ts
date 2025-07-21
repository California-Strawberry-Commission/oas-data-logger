import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const runs = await prisma.run.findMany({
      select: {
        id: true,
        uuid: true,
        epochTimeS: true,
        tickBaseUs: true,
        updatedAt: true,
        files: {
          where: {
            fileName: "LOCK"
          },
          select: {
            id: true
          }
        },
        runData: {
          select: {
            tick: true
          },
          orderBy: {
            tick: 'desc'
          },
          take: 1
        }
      },
    });

    // Transform the data to include active status and last data time
    const runsWithStatus = runs.map(run => {
      const isActive = run.files.length > 0; // Has LOCK file
      
      // Calculate last data time based on the highest tick
      let lastDataTime = run.epochTimeS; // Default to start time
      if (run.runData.length > 0) {
        const lastTick = run.runData[0].tick;
        const tickUs = run.tickBaseUs || 100000; // Default 100ms if not set
        const elapsedSeconds = (Number(lastTick) * Number(tickUs)) / 1000000;
        lastDataTime = run.epochTimeS + BigInt(Math.floor(elapsedSeconds));
      }

      return {
        uuid: run.uuid,
        epochTimeS: run.epochTimeS,
        lastDataTime: lastDataTime,
        updatedAt: run.updatedAt,
        isActive
      };
    });

    return NextResponse.json(runsWithStatus);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch runs" },
      { status: 500 }
    );
  }
}