import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";

/**
 * Device Provisioning Endpoint (Admin Only)
 * * PURPOSE:
 * This API is the destination for the local provisioning script. It receives the
 * raw identity credentials (ID + Secret) generated during the manufacturing process
 * and safely stores them in the database.
 * * SECURITY:
 * - Input: Receives the raw Device Secret in the request body.
 * - Processing: Immediately encrypts the secret using AES-256-GCM (via encryptSecret).
 * - Storage: Only the ENCRYPTED secret is saved to the database. The server never
 * stores the plaintext secret persistently.
 * * DATA INTEGRITY (Prisma Transaction):
 * Uses an atomic transaction to ensure that we never end up with
 * a device record without a secret or a secret without a device.
 * Both records are created/updated together, or the entire operation fails.
 * * USAGE:
 * POST /api/admin/provision
 * Body: { "deviceId": "...", "secret": "..." }
 */

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { deviceId, secret } = body;

    if (!deviceId || !secret) {
      return NextResponse.json(
        { message: "Missing deviceId or secret" },
        { status: 400 }
      );
    }

    const encryptedSecret = encryptSecret(secret);

    await prisma.$transaction(async (tx) => {
      // Ensure Device exists
      await tx.device.upsert({
        where: { id: deviceId },
        update: {},
        create: {
          id: deviceId,
          name: `New Device ${deviceId}`,
        },
      });

      await tx.deviceSecret.upsert({
        where: { deviceId: deviceId },
        update: {
          secret: encryptedSecret,
        },
        create: {
          deviceId: deviceId,
          secret: encryptedSecret,
        },
      });
    });

    return NextResponse.json({ success: true, deviceId });
  } catch (error) {
    console.error("Provisioning error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
