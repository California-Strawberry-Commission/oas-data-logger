import { PrismaPg } from "@prisma/adapter-pg";
import { ReadlineParser } from "@serialport/parser-readline";
import { config as dotenv } from "dotenv";
import nodeCrypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { SerialPort } from "serialport";
import { PrismaClient } from "@/generated/prisma/client";
import { encryptSecret } from "@/lib/crypto";

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
 * npm run provision-device -- /dev/ttyUSB0 --env=local
 * npm run provision-device -- --db-only --id=device_123 --secret=abc...123 --env=prod
 */

//#region Types

type EnvName = "local" | "preview" | "prod";

//#endregion

//#region CLI Args

const {
  values: {
    env: envRaw,
    "db-only": dbOnly,
    id: manualId,
    secret: manualSecret,
  },
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

function isEnvName(x: string): x is EnvName {
  return x === "local" || x === "preview" || x === "prod";
}

if (!isEnvName(envRaw)) {
  console.error(
    `Error: --env must be one of local|preview|prod (got: ${envRaw})`,
  );
  process.exit(1);
}
const env: EnvName = envRaw;

//#endregion

let isProvisioning = false;
const BAUD_RATE = 115200;

function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });
  return new PrismaClient({ adapter });
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing env var ${name}`);
  }
  return val;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  msg: string,
): Promise<T> {
  let t: NodeJS.Timeout | undefined;

  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(msg)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (t) {
      clearTimeout(t);
    }
  }) as Promise<T>;
}

async function openSerialPort(port: SerialPort) {
  await new Promise<void>((resolve, reject) => {
    port.open((err) => (err ? reject(err) : resolve()));
  });
}

async function closeSerialPort(port: SerialPort) {
  await new Promise<void>((resolve) => {
    port.close(() => resolve());
  });
}

function generateSecret(): string {
  return nodeCrypto.randomBytes(32).toString("hex"); // 32 hex chars
}

async function registerDeviceInDB(
  prisma: PrismaClient,
  deviceId: string,
  rawSecret: string,
) {
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
  // Resolve .env file relative to this script file
  const scriptDirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv({
    path: path.resolve(scriptDirname, `../.env.${env}`),
  });

  const databaseUrl = requireEnv("DATABASE_URL");

  const prisma = createPrismaClient(databaseUrl);

  let parser: ReadlineParser | undefined;
  let port: SerialPort | undefined;
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
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("\n[Error] Failed to list serial ports:", msg);
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

    await openSerialPort(port);
    console.log("Port open. Waiting for 'DEVICE_ID:'...");

    const provisioningTask = new Promise<void>((resolve, reject) => {
      if (!parser || !port) {
        reject(new Error("Serial parser/port not initialized"));
        return;
      }

      parser.on("data", async (line) => {
        const cleanLine = line.toString().trim();

        if (cleanLine.startsWith("DEVICE_ID:")) {
          if (isProvisioning) {
            return;
          }
          isProvisioning = true;

          const deviceId = cleanLine.split(":")[1].trim();
          if (!deviceId) {
            reject(new Error("Malformed DEVICE_ID line"));
            return;
          }
          console.log(`\nDetected Device ID: ${deviceId}`);

          const secret = generateSecret();
          console.log(`Generated Secret: ${secret}`);

          try {
            await registerDeviceInDB(prisma, deviceId, secret);

            console.log("Pushing secret to device...");
            await sleep(500); // Needed to allow hardware to catch up

            if (!port) {
              reject(new Error("Serial port not initialized"));
              return;
            }
            port.write(`PROV_SET:${secret}\n`, (err) => {
              if (err) {
                console.error("Write error:", err);
              }
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
    await closeSerialPort(port);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("\n[Error]", msg);
    process.exitCode = 1;
  } finally {
    if (parser) {
      parser.removeAllListeners("data");
    }

    if (port) {
      port.removeAllListeners();
      if (port.isOpen) {
        await closeSerialPort(port);
      }
    }

    await prisma.$disconnect();
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[ERROR]", msg);
  process.exit(1);
});
