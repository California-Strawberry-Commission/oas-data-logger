import { verifyDeviceSignature } from "@/lib/verify-device";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/heartbeat
 *
 * Receives a device heartbeat.
 *
 * TODO: Store heartbeats. For now, the body is only logged.
 */
export async function POST(request: NextRequest) {
  // Ensure device ID header is present
  const deviceId = request.headers.get("x-device-id");
  if (!deviceId) {
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
    console.error(`[api/heartbeat] Auth failed: ${authResult.message}`);
    return NextResponse.json(
      { error: "Unauthorized", details: "Invalid request signature" },
      { status: 401 },
    );
  }

  let heartbeat: unknown;
  try {
    heartbeat = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  console.log(
    `[api/heartbeat] Heartbeat from ${deviceId}:`,
    JSON.stringify(heartbeat, null, 2),
  );

  return NextResponse.json({ ok: true });
}
