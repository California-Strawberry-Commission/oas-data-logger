import { User, withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * PATCH /api/poi-groups/[id]
 *
 * Renames a POI group.
 * Body: { name: string }
 */
export const PATCH = withAuth(
  async (request: NextRequest, user: User, context) => {
    const { id } = (await context.params) as { id: string };

    const existing = await prisma.poiGroup.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "POI group not found" },
        { status: 404 },
      );
    }

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
      const updated = await prisma.poiGroup.update({
        where: { id },
        data: { name: name.trim() },
        select: { id: true, name: true },
      });

      return NextResponse.json(updated);
    } catch (err) {
      console.error("PATCH /api/poi-groups/[id] error:", err);
      return NextResponse.json(
        { error: "Failed to rename POI group" },
        { status: 500 },
      );
    }
  },
);

/**
 * DELETE /api/poi-groups/[id]
 */
export const DELETE = withAuth(
  async (_request: NextRequest, user: User, context) => {
    const { id } = (await context.params) as { id: string };

    const existing = await prisma.poiGroup.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "POI group not found" },
        { status: 404 },
      );
    }

    try {
      await prisma.poiGroup.delete({ where: { id } });
    } catch (err) {
      console.error("DELETE /api/poi-groups/[id] error:", err);
      return NextResponse.json(
        { error: "Failed to delete POI group" },
        { status: 500 },
      );
    }

    return new NextResponse(null, { status: 204 });
  },
);
