import { User, withAuth } from "@/lib/auth";
import prisma, { devicesWhereForUser } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/devices
 *
 * Returns the list of devices that belong to the authenticated user.
 */
export const GET = withAuth(async (_request: NextRequest, user: User) => {
  try {
    const where = devicesWhereForUser(user);
    const devices = await prisma.device.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
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
});
