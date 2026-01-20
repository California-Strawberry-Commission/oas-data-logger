const fs = require("fs");
const path = require("path");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const nodeCrypto = require("crypto");
const dotenv = require("dotenv");

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
 * npx tsx scripts/provision-device.js /dev/ttyUSB0 --env=local
 * npx tsx scripts/provision-device.js --db-only --id=device_123 --secret=abc...123 --env=prod
 */

const args = process.argv.slice(2);
const getArg = (key) => {
  const arg = args.find((a) => a.startsWith(`--${key}=`));
  return arg ? arg.split("=")[1] : null;
};

const env = getArg("env") || "local";
const dbOnly = args.includes("--db-only");
const manualId = getArg("id");
const manualSecret = getArg("secret");
const portPath = args.find((arg) => !arg.startsWith("--"));

const envPath = path.resolve(__dirname, `../.env.${env}`);
console.log(`[Setup] Loading config from: ${envPath}`);
dotenv.config({ path: envPath });

const { encryptSecret } = require("@/lib/crypto");
const { PrismaClient } = require("../generated/prisma/client");

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL is missing.");
  process.exit(1);
}

let isProvisioning = false;
const BAUD_RATE = 115200;

function generateSecret() {
  return nodeCrypto.randomBytes(16).toString("hex"); // 32 hex chars
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
  const prisma = new PrismaClient();

  try {
    if (dbOnly) {
      if (!manualId || !manualSecret) {
        throw new Error("Missing --id or --secret for --db-only mode.");
      }

      const hex64Regex = /^[0-9a-fA-F]{64}$/;
      if (!hex64Regex.test(manualSecret)) {
        throw new Error(
          "Invalid secret format. Must be a 32-byte hex string (64 chars)."
        );
      }

      console.log(`[Mode] Manual DB Update (${env})`);
      await registerDeviceInDB(prisma, manualId, manualSecret);
      return;
    }

    if (!portPath) {
      throw new Error("Please specify the serial port (e.g., /dev/ttyUSB0).");
    }

    console.log(`[Mode] Interactive Serial Provisioning on ${portPath}`);
    const port = new SerialPort({
      path: portPath,
      baudRate: BAUD_RATE,
      autoOpen: false,
    });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    await new Promise((resolve, reject) => {
      port.open((err) => (err ? reject(err) : resolve()));
    });
    console.log("Port open. Waiting for 'DEVICE_ID:'...");

    await new Promise((resolve, reject) => {
      let completed = false;

      const timeout = setTimeout(() => {
        if (!completed)
          reject(new Error("Timeout: Device did not respond in 20s."));
      }, 20000);

      parser.on("data", async (line) => {
        if (completed) return;
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
            setTimeout(() => {
              port.write(`PROV_SET:${secret}\n`, (err) => {
                if (err) console.error("Write error:", err);
              });
            }, 500);
          } catch (err) {
            completed = true;
            clearTimeout(timeout);
            reject(err);
          }
        }

        if (cleanLine.includes("PROV_SUCCESS")) {
          console.log("SUCCESS: Device accepted the secret.");
          completed = true;
          clearTimeout(timeout);
          resolve();
        }

        if (cleanLine.includes("PROV_FAIL")) {
          console.error("FAILURE: Device rejected the secret.");
          completed = true;
          clearTimeout(timeout);
          reject(new Error("Device reported provisioning failure"));
        }
      });
    });

    port.close();
  } catch (err) {
    console.error("\n[Error]", err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
