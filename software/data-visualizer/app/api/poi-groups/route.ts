import { User, withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/poi-groups
 *
 * Returns all POI groups accessible to the authenticated user.
 */
export const GET = withAuth(async (_request: NextRequest, user: User) => {
  try {
    const groups = await prisma.poiGroup.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });

    return NextResponse.json(groups);
  } catch (err) {
    console.error("GET /api/poi-groups error:", err);
    return NextResponse.json(
      { error: "Failed to fetch POI groups" },
      { status: 500 },
    );
  }
});

/**
 * POST /api/poi-groups
 *
 * Creates a new POI group associated to the calling user.
 * Body: { name: string }
 */
export const POST = withAuth(async (request: NextRequest, user: User) => {
  // Read and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name } = body as { name?: unknown };
  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const group = await prisma.poiGroup.create({
      data: {
        name: name.trim(),
        userId: user.id,
      },
      select: { id: true, name: true },
    });

    return NextResponse.json(group, { status: 201 });
  } catch (err) {
    console.error("POST /api/poi-groups error:", err);
    return NextResponse.json(
      { error: "Failed to create POI group" },
      { status: 500 },
    );
  }
});
