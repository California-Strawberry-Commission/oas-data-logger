import { getCurrentUser } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { devicesWhereForUser } from "@/lib/query-helpers";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const where = devicesWhereForUser(user);
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
      { status: 500 },
    );
  }
}
