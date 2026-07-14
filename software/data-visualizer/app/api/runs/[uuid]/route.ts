import { User, withAuth } from "@/lib/auth";
import prisma, { getRunForUser, runWhereForUser } from "@/lib/prisma";
import { isValidUuid } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/runs/[uuid]
 *
 * Returns the run's metadata. Does not include any stream information.
 */
export const GET = withAuth(
  async (_request: NextRequest, user: User, context) => {
    const { uuid } = (await context.params) as { uuid: string };

    if (!isValidUuid(uuid)) {
      return NextResponse.json({ error: "Invalid run UUID" }, { status: 400 });
    }

    try {
      const where = runWhereForUser(user, uuid);
      const run = await prisma.run.findFirst({
        where,
        select: {
          uuid: true,
          deviceId: true,
          epochTimeS: true,
          tickBaseUs: true,
          durationS: true,
          metadata: true,
          isActive: true,
          icon: true,
        },
      });

      if (!run) {
        // Either run doesn't exist, or user has no access to it
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }

      return NextResponse.json({
        uuid: run.uuid,
        deviceId: run.deviceId,
        epochTimeS: Number(run.epochTimeS),
        tickBaseUs: Number(run.tickBaseUs),
        durationS: run.durationS,
        metadata: run.metadata,
        isActive: run.isActive,
        icon: run.icon,
      });
    } catch (err) {
      console.error("GET /api/runs/[uuid] error:", err);
      return NextResponse.json(
        { error: "Failed to fetch run" },
        { status: 500 },
      );
    }
  },
);

/**
 * PATCH /api/runs/[uuid]
 *
 * Updates the run's icon.
 *
 * Body: { icon?: string | null }
 */
export const PATCH = withAuth(
  async (request: NextRequest, user: User, context) => {
    const { uuid } = (await context.params) as { uuid: string };

    if (!isValidUuid(uuid)) {
      return NextResponse.json({ error: "Invalid run UUID" }, { status: 400 });
    }

    const where = runWhereForUser(user, uuid);
    const existing = await prisma.run.findFirst({ where });
    if (!existing) {
      // Either run doesn't exist, or user has no access to it
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Read and validate body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { icon } = body as { icon?: unknown };

    if (icon !== undefined && icon !== null && typeof icon !== "string") {
      return NextResponse.json(
        { error: "icon must be a string or null" },
        { status: 400 },
      );
    }

    try {
      const run = await prisma.run.update({
        where: { uuid },
        data: {
          ...(icon !== undefined && { icon }),
        },
        select: {
          uuid: true,
          deviceId: true,
          epochTimeS: true,
          tickBaseUs: true,
          durationS: true,
          metadata: true,
          isActive: true,
          icon: true,
        },
      });

      return NextResponse.json({
        uuid: run.uuid,
        deviceId: run.deviceId,
        epochTimeS: Number(run.epochTimeS),
        tickBaseUs: Number(run.tickBaseUs),
        durationS: run.durationS,
        metadata: run.metadata,
        isActive: run.isActive,
        icon: run.icon,
      });
    } catch (err) {
      console.error("PATCH /api/runs/[uuid] error:", err);
      return NextResponse.json(
        { error: "Failed to update run" },
        { status: 500 },
      );
    }
  },
);

/**
 * DELETE /api/runs/[uuid]
 *
 * Deletes the run.
 */
export const DELETE = withAuth(
  async (_request: NextRequest, user: User, context) => {
    const { uuid } = (await context.params) as { uuid: string };

    if (!isValidUuid(uuid)) {
      return NextResponse.json({ error: "Invalid run UUID" }, { status: 400 });
    }

    try {
      const run = await getRunForUser(user, uuid, {
        select: { id: true, uuid: true },
      });
      if (!run) {
        // Either run doesn't exist, or user has no access to it
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }

      await prisma.run.delete({ where: { id: run.id } });
    } catch (err) {
      console.error("DELETE /api/runs/[uuid] error:", err);
      return NextResponse.json(
        { error: "Failed to delete run" },
        { status: 500 },
      );
    }

    return new NextResponse(null, { status: 204 });
  },
);
