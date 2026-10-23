import prisma from "@/lib/prisma";
import { verifyDeviceSignature } from "@/lib/verify-device";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const heartbeatSchema = z.object({
  firmwareBuild: z.int(),
  deviceType: z.string(),
  otaChannel: z.string(),
  bootCount: z.int(),
  uptimeMs: z.int(),
  state: z.int().optional(),
  reset: z.object({
    reason: z.int(),
    appReason: z.int(),
    crash: z
      .object({
        bootCount: z.int(),
        task: z.string(),
        pc: z.int(),
        cause: z.int(),
        vaddr: z.int(),
        backtrace: z.array(z.int()),
        btCorrupted: z.boolean(),
        elfSha256: z.string(),
      })
      .optional(),
  }),
  heap: z.object({
    free: z.int(),
    minFree: z.int(),
    largestBlock: z.int(),
  }),
  wifi: z.object({
    rssi: z.int(),
    disconnectEvents: z
      .array(
        z.object({
          bootCount: z.int(),
          uptimeMs: z.int(),
          lastUptimeMs: z.int(),
          count: z.int(),
          reason: z.int(),
          rssi: z.int(),
          wasConnected: z.boolean(),
        }),
      )
      .optional(),
  }),
  file: z
    .object({
      writeIssues: z.array(
        z.object({
          bootCount: z.int(),
          uptimeMs: z.int(),
          lastUptimeMs: z.int(),
          count: z.int(),
          type: z.int(), // dlf::FileWriteIssue::Type
          streamType: z.int(), // dlf::dlf_stream_type_e
          maxAttempts: z.int(),
          maxDurationMs: z.int(),
        }),
      ),
    })
    .optional(),
});

/**
 * POST /api/heartbeat
 *
 * Receives a device heartbeat and stores it. Writes happen before responding
 * because the device expects an ack on success.
 */
export async function POST(request: NextRequest) {
  // Ensure device ID header is present
  const deviceId = request.headers.get("x-device-id");
  if (!deviceId) {
    console.error("[api/heartbeat] Missing device ID header");
    return NextResponse.json(
      { error: "Unauthorized", details: "Missing device ID header" },
      { status: 401 },
    );
  }

  // Verify the request signature against the raw body, before parsing it
  const body = await request.text();
  const authResult = await verifyDeviceSignature(
    deviceId,
    request.headers,
    body,
  );
  if (!authResult.success) {
    console.error(
      `[api/heartbeat] Auth failed for device ${deviceId}: ${authResult.message}`,
    );
    return NextResponse.json(
      { error: "Unauthorized", details: "Invalid request signature" },
      { status: 401 },
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (err) {
    console.error(
      `[api/heartbeat] Invalid JSON body from device ${deviceId}:`,
      err,
    );
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = heartbeatSchema.safeParse(json);
  if (!parsed.success) {
    const details = z.prettifyError(parsed.error);
    console.error(
      `[api/heartbeat] Invalid heartbeat payload from device ${deviceId}:\n${details}`,
    );
    return NextResponse.json(
      { error: "Invalid heartbeat payload", details },
      { status: 400 },
    );
  }
  const heartbeatData = parsed.data;
  const crash = heartbeatData.reset.crash;

  try {
    await prisma.$transaction([
      // Ensure the device exists
      prisma.device.upsert({
        where: { id: deviceId },
        update: {},
        create: { id: deviceId },
      }),
      prisma.deviceHeartbeat.create({
        data: {
          deviceId,
          firmwareBuild: heartbeatData.firmwareBuild,
          deviceType: heartbeatData.deviceType,
          otaChannel: heartbeatData.otaChannel,
          bootCount: heartbeatData.bootCount,
          uptimeMs: BigInt(heartbeatData.uptimeMs),
          resetReason: heartbeatData.reset.reason,
          appResetReason: heartbeatData.reset.appReason,
          state: heartbeatData.state,
          heapFree: heartbeatData.heap.free,
          heapMinFree: heartbeatData.heap.minFree,
          heapLargestBlock: heartbeatData.heap.largestBlock,
          rssi: heartbeatData.wifi.rssi,
          wifiDisconnectEvents: {
            create: (heartbeatData.wifi?.disconnectEvents ?? []).map((e) => ({
              deviceId,
              bootCount: e.bootCount,
              uptimeMs: BigInt(e.uptimeMs),
              lastUptimeMs: BigInt(e.lastUptimeMs),
              count: e.count,
              reason: e.reason,
              rssi: e.rssi,
              wasConnected: e.wasConnected,
            })),
          },
          fileWriteIssues: {
            create: (heartbeatData.file?.writeIssues ?? []).map((e) => ({
              deviceId,
              bootCount: e.bootCount,
              uptimeMs: BigInt(e.uptimeMs),
              lastUptimeMs: BigInt(e.lastUptimeMs),
              count: e.count,
              type: e.type,
              streamType: e.streamType,
              maxAttempts: e.maxAttempts,
              maxDurationMs: e.maxDurationMs,
            })),
          },
        },
      }),
      ...(crash
        ? [
            // Skip duplicates, since the device re-sends a crash if it didn't
            // get the acknowledgement
            prisma.deviceCrash.createMany({
              data: [
                {
                  deviceId,
                  bootCount: crash.bootCount,
                  task: crash.task,
                  pc: BigInt(crash.pc),
                  cause: crash.cause,
                  vaddr: BigInt(crash.vaddr),
                  backtrace: crash.backtrace.map((pc) => BigInt(pc)),
                  backtraceCorrupted: crash.btCorrupted,
                  elfSha256: crash.elfSha256,
                },
              ],
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
  } catch (err) {
    console.error("[api/heartbeat] Failed to save heartbeat", err);
    return NextResponse.json(
      { error: "Failed to save heartbeat" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
