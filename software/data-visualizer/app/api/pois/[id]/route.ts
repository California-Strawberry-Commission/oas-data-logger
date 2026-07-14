import { User, withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * PATCH /api/pois/[id]
 *
 * Updates a POI's fields. Pass groupId: null to remove from a group.
 *
 * Body: {
 *   lat?: number,
 *   lng?: number,
 *   name?: string,
 *   icon?: string,
 *   color?: string,
 *   description?: string,
 *   groupId?: string | null
 * }
 */
export const PATCH = withAuth(
  async (request: NextRequest, user: User, context) => {
    const { id } = (await context.params) as { id: string };

    const existing = await prisma.poi.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "POI not found" }, { status: 404 });
    }

    // Read and validate body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { lat, lng, name, icon, color, description, groupId } = body as {
      lat?: unknown;
      lng?: unknown;
      name?: unknown;
      icon?: unknown;
      color?: unknown;
      description?: unknown;
      groupId?: unknown;
    };

    if (lat !== undefined && typeof lat !== "number") {
      return NextResponse.json(
        { error: "lat must be a number" },
        { status: 400 },
      );
    }
    if (lng !== undefined && typeof lng !== "number") {
      return NextResponse.json(
        { error: "lng must be a number" },
        { status: 400 },
      );
    }
    if (
      name !== undefined &&
      (typeof name !== "string" || (name as string).trim() === "")
    ) {
      return NextResponse.json(
        { error: "name must be a non-empty string" },
        { status: 400 },
      );
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
          { error: "groupId must be a string or null" },
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

    try {
      const updated = await prisma.poi.update({
        where: { id },
        data: {
          ...(lat !== undefined && { lat }),
          ...(lng !== undefined && { lng }),
          ...(name !== undefined && { name: name.trim() }),
          ...(icon !== undefined && { icon }),
          ...(color !== undefined && { color }),
          ...(description !== undefined && { description }),
          ...(groupId !== undefined && { groupId }),
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

      return NextResponse.json(updated);
    } catch (err) {
      console.error("PATCH /api/pois/[id] error:", err);
      return NextResponse.json(
        { error: "Failed to update POI" },
        { status: 500 },
      );
    }
  },
);

/**
 * DELETE /api/pois/[id]
 */
export const DELETE = withAuth(
  async (_request: NextRequest, user: User, context) => {
    const { id } = (await context.params) as { id: string };

    const existing = await prisma.poi.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "POI not found" }, { status: 404 });
    }

    try {
      await prisma.poi.delete({ where: { id } });
    } catch (err) {
      console.error("DELETE /api/pois/[id] error:", err);
      return NextResponse.json(
        { error: "Failed to delete POI" },
        { status: 500 },
      );
    }

    return new NextResponse(null, { status: 204 });
  },
);
