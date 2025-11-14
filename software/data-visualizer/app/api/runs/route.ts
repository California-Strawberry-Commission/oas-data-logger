import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ADMINs can view everything
    // USERs can only view runs for devices they are associated with
    const where =
      user.role === "ADMIN"
        ? {}
        : {
            device: {
              userDevices: {
                some: {
                  userId: user.id,
                },
              },
            },
          };
    const runs = await prisma.run.findMany({
      where,
      select: {
        uuid: true,
        epochTimeS: true,
        tickBaseUs: true,
        updatedAt: true,
        isActive: true,
        // get the latest tick available
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

    // Transform the data to include last data time
    const runsWithStatus = runs.map((run) => {
      // Calculate last data time based on the highest tick
      let lastDataTimeS: bigint = run.epochTimeS; // default to start time
      if (run.runData.length > 0) {
        const lastTick: bigint = run.runData[0].tick;
        const tickUs: bigint = run.tickBaseUs ?? 100_000n; // default 100ms if not set

        // Perform calculation with bigint to avoid precision loss
        const elapsedSeconds = (lastTick * tickUs) / 1_000_000n;
        lastDataTimeS = run.epochTimeS + elapsedSeconds;
      }

      return {
        uuid: run.uuid,
        epochTimeS: run.epochTimeS.toString(), // convert BigInt to string for JSON serialization
        lastDataTimeS: lastDataTimeS.toString(), // convert BigInt to string for JSON serialization
        isActive: run.isActive,
      };
    });

    return NextResponse.json(runsWithStatus);
  } catch (err) {
    console.error("GET /api/runs error:", err);
    return NextResponse.json(
      { error: "Failed to fetch runs" },
      { status: 500 }
    );
  }
}
