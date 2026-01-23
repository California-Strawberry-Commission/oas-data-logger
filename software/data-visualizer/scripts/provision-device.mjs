#!/usr/bin/env node
import { ReadlineParser } from "@serialport/parser-readline";
import dotenv from "dotenv";
import nodeCrypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { SerialPort } from "serialport";
import { PrismaClient } from "../generated/prisma/client/index.js";
import { encryptSecret } from "../lib/crypto.ts";

/**
 * Device Provisioning Script (Host Side)
 * MODES:
 * 1. Interactive (Default): Connects via Serial (USB), waits for the device to announce
 * its ID, generates a secret, saves it to the DB, and flashes it to the device.
 * 2. Manual (--db-only): Manually inserts a known device ID and secret into the database
 * without requiring a physical device connection.
 *
 * CLI ARGUMENTS:
 * @param {string} [port]   - The serial port path (e.g. /dev/ttyUSB0). Required for interactive mode.
 * @param {string} --env    - The environment config to load (local, preview, prod). Defaults to 'local'.
 * @param {flag}   --db-only - If present, skips serial connection and performs a direct DB update.
 * @param {string} --id     - The Device ID (Required for --db-only mode).
 * @param {string} --secret - The 32-byte Hex Secret (Required for --db-only mode).
 *
 * USAGE EXAMPLES:
 * node scripts/provision-device.mjs /dev/ttyUSB0 --env=local
 * node scripts/provision-device.mjs --db-only --id=device_123 --secret=abc...123 --env=prod
 */

const {
  values: { env, "db-only": dbOnly, id: manualId, secret: manualSecret },
  positionals,
} = parseArgs({
  options: {
    env: { type: "string", default: "local" },
    "db-only": { type: "boolean", default: false },
    id: { type: "string" },
    secret: { type: "string" },
  },
  allowPositionals: true, // Allows for serialport to be captured
});

// The serial port is the first positional argument
const portPath = positionals[0];

const scriptDirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(scriptDirname, `../.env.${env}`);

console.log(`[Setup] Loading config from: ${envPath}`);

dotenv.config({ path: envPath });

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL is missing.");
  process.exit(1);
}

let isProvisioning = false;
const BAUD_RATE = 115200;

function generateSecret() {
  return nodeCrypto.randomBytes(32).toString("hex"); // 32 hex chars
}

async function registerDeviceInDB(prisma, deviceId, rawSecret) {
  console.log(`[DB] Encrypting & saving secret for ${deviceId}...`);

  const encryptedSecret = encryptSecret(rawSecret);

  await prisma.device.upsert({
    where: { id: deviceId },
    update: {},
    create: { id: deviceId },
  });

  await prisma.deviceSecret.upsert({
    where: { deviceId },
    update: {
      secret: encryptedSecret,
      encryptionKeyVersion: 1,
    },
    create: {
      deviceId,
      secret: encryptedSecret,
      encryptionKeyVersion: 1,
    },
  });
  console.log("[DB] Update successful.");
}

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const withTimeout = (promise, ms, msg) => {
    let t;
    const timeout = new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(msg)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
  };

  let parser;
  let port;
  try {
    if (dbOnly) {
      if (!manualId || !manualSecret) {
        throw new Error("Missing --id or --secret for --db-only mode.");
      }

      const hex64Regex = /^[0-9a-fA-F]{64}$/;
      if (!hex64Regex.test(manualSecret)) {
        throw new Error(
          "Invalid secret format. Must be a 32-byte hex string (64 chars).",
        );
      }

      console.log(`[Mode] Manual DB Update (${env})`);
      await registerDeviceInDB(prisma, manualId, manualSecret);
      return;
    }

    if (!portPath) {
      let ports;

      try {
        ports = await SerialPort.list();
      } catch (err) {
        console.error("\n[Error] Failed to list serial ports:", err.message);
        process.exitCode = 1;
        return;
      }

      console.error("\n[Error] No serial port specified.");

      if (ports.length === 0) {
        console.error("No serial ports detected.");
      } else {
        console.error("\nAvailable serial ports:");
        for (const p of ports) {
          console.error(
            `  - ${p.path}${p.manufacturer ? ` (${p.manufacturer})` : ""}`,
          );
        }
      }

      console.error(
        "\nUsage:\n" +
          "  npx tsx scripts/provision-device.js /dev/ttyXXX --env=local\n",
      );

      process.exitCode = 1;
      return;
    }

    console.log(`[Mode] Interactive Serial Provisioning on ${portPath}`);
    port = new SerialPort({
      path: portPath,
      baudRate: BAUD_RATE,
      autoOpen: false,
    });
    parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    await new Promise((resolve, reject) => {
      port.open((err) => (err ? reject(err) : resolve()));
    });
    console.log("Port open. Waiting for 'DEVICE_ID:'...");

    const provisioningTask = new Promise((resolve, reject) => {
      parser.on("data", async (line) => {
        const cleanLine = line.toString().trim();

        if (cleanLine.startsWith("DEVICE_ID:")) {
          if (isProvisioning) return;
          isProvisioning = true;

          const deviceId = cleanLine.split(":")[1].trim();
          console.log(`\nDetected Device ID: ${deviceId}`);

          const secret = generateSecret();
          console.log(`Generated Secret: ${secret}`);

          try {
            await registerDeviceInDB(prisma, deviceId, secret);

            console.log("Pushing secret to device...");
            await sleep(500); // Needed to allow hardware to catch up

            port.write(`PROV_SET:${secret}\n`, (err) => {
              if (err) console.error("Write error:", err);
            });
          } catch (err) {
            reject(err);
          }
        }

        if (cleanLine.includes("PROV_SUCCESS")) {
          console.log("SUCCESS: Device accepted the secret.");
          resolve();
        }

        if (cleanLine.includes("PROV_FAIL")) {
          console.error("FAILURE: Device rejected the secret.");
          reject(new Error("Device reported provisioning failure"));
        }
      });
    });

    await withTimeout(
      provisioningTask,
      20000,
      "Timeout: Device did not respond in 20s.",
    );
    port.close();
  } catch (err) {
    console.error("\n[Error]", err.message);
    process.exitCode = 1;
  } finally {

    if (parser) parser.removeAllListeners("data");

    if (port) {
      port.removeAllListeners();
      if (port.isOpen) {
        await new Promise((resolve) => port.close((err) => resolve()));
      }
    }

    await prisma.$disconnect();
  }
}

main();
