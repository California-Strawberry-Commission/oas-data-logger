import { User, withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/pois
 *
 * Returns all POIs owned by the authenticated user.
 */
export const GET = withAuth(async (_request: NextRequest, user: User) => {
  try {
    const pois = await prisma.poi.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        lat: true,
        lng: true,
        name: true,
        icon: true,
        color: true,
        description: true,
        groupId: true,
      },
    });

    return NextResponse.json(pois);
  } catch (err) {
    console.error("GET /api/pois error:", err);
    return NextResponse.json(
      { error: "Failed to fetch POIs" },
      { status: 500 },
    );
  }
});

/**
 * POST /api/pois
 *
 * Creates a new POI owned by the calling user.
 *
 * Body: {
 *   lat: number,
 *   lng: number,
 *   name: string,
 *   icon?: string,
 *   color?: string,
 *   description?: string,
 *   groupId?: string
 * }
 */
export const POST = withAuth(async (request: NextRequest, user: User) => {
  // Read and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { lat, lng, name, icon, color, description, groupId } = body as {
    lat: unknown;
    lng: unknown;
    name: unknown;
    icon?: unknown;
    color?: unknown;
    description?: unknown;
    groupId?: unknown;
  };

  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json(
      { error: "lat and lng must be numbers" },
      { status: 400 },
    );
  }
  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (icon !== undefined && typeof icon !== "string") {
    return NextResponse.json(
      { error: "icon must be a string" },
      { status: 400 },
    );
  }
  if (color !== undefined && typeof color !== "string") {
    return NextResponse.json(
      { error: "color must be a string" },
      { status: 400 },
    );
  }
  if (description !== undefined && typeof description !== "string") {
    return NextResponse.json(
      { error: "description must be a string" },
      { status: 400 },
    );
  }
  if (groupId !== undefined && groupId !== null) {
    if (typeof groupId !== "string") {
      return NextResponse.json(
        { error: "groupId must be a string" },
        { status: 400 },
      );
    }
    const group = await prisma.poiGroup.findFirst({
      where: { id: groupId, userId: user.id },
    });
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
  }

  // Create POI
  try {
    const poi = await prisma.poi.create({
      data: {
        lat,
        lng,
        name: name.trim(),
        icon: icon ?? "pin",
        color: color ?? "#000000",
        description: description ?? "",
        userId: user.id,
        groupId: groupId ?? null,
      },
      select: {
        id: true,
        lat: true,
        lng: true,
        name: true,
        icon: true,
        color: true,
        description: true,
        groupId: true,
      },
    });

    return NextResponse.json(poi, { status: 201 });
  } catch (err) {
    console.error("POST /api/pois error:", err);
    return NextResponse.json(
      { error: "Failed to create POI" },
      { status: 500 },
    );
  }
});
