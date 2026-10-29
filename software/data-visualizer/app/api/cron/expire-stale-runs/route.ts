import {
  assembleRunFilesToBuffers,
  uploadAssembledRunFiles,
} from "@/lib/dlf-s3";
import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Active runs that haven't received an update in this long are marked inactive
const STALE_RUN_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/**
 * GET /api/cron/expire-stale-runs
 *
 * Marks active runs as inactive if they haven't been updated within STALE_RUN_TIMEOUT_MS.
 *
 * Chunks are assembled and uploaded before the run is marked inactive, since
 * inactive runs are read from the assembled files. Chunks are kept so that the
 * device can resume uploading when it reconnects; its eventual finalize
 * re-assembles everything and deletes the chunks.
 *
 * Headers:
 *   authorization: "Bearer <CRON_SECRET>" (sent automatically by Vercel Cron)
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STALE_RUN_TIMEOUT_MS);
  const staleRuns = await prisma.run.findMany({
    where: { isActive: true, updatedAt: { lt: cutoff } },
    select: { id: true, uuid: true },
  });

  const updated: string[] = [];
  const failed: string[] = [];
  for (const run of staleRuns) {
    try {
      // Assemble chunks and upload
      const fileBuffers = await assembleRunFilesToBuffers(run.uuid);
      if (fileBuffers.size > 0) {
        await uploadAssembledRunFiles(run.uuid, fileBuffers);
      }

      const { count } = await prisma.run.updateMany({
        where: { id: run.id, isActive: true, updatedAt: { lt: cutoff } },
        data: { isActive: false },
      });
      if (count > 0) {
        updated.push(run.uuid);
        console.log(
          `[api/cron/expire-stale-runs] Marked run ${run.uuid} as inactive.`,
        );
      } else {
        console.log(
          `[api/cron/expire-stale-runs] Run ${run.uuid} was updated during processing, leaving as active.`,
        );
      }
    } catch (err) {
      failed.push(run.uuid);
      console.error(
        `[api/cron/expire-stale-runs] Failed to expire run ${run.uuid}:`,
        err,
      );
    }
  }

  return NextResponse.json({ updated, failed });
}
