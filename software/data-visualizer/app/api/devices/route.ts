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
    // USERs can only view devices they are associated with
    const where =
      user.role === "ADMIN"
        ? {}
        : {
            userDevices: {
              some: {
                userId: user.id,
              },
            },
          };
    const devices = await prisma.device.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
      },
    });

    return NextResponse.json(devices);
  } catch (err) {
    console.error("GET /api/devices error:", err);
    return NextResponse.json(
      { error: "Failed to fetch devices" },
      { status: 500 }
    );
  }
}
