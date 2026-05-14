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
 * 2. DB Upsert (--db-only): Connects via Serial (USB) to an already provisioned device,
 * requests its existing ID and secret from NVS, verifies ID against passed --id value,
 * upserts the existing secret into the passed --env(s).
 *
 * CLI ARGUMENTS:
 * @param {string} [port]   - The serial port path (e.g. /dev/ttyACM0). Required for both modes.
 * @param {string[]} --env    - The environment configs to load (local, preview, prod). Defaults to ['local'].
 * @param {flag}   --db-only - If present, pulls existing secret from device, performs a direct DB update.
 * @param {string} --id     - Expected device ID (Required for --db-only mode).
 *
 * USAGE EXAMPLES:
 * Interactive Provisioning:
 * npm run provision-device -- /dev/ttyACM0
 * npm run provision-device -- /dev/ttyACM0 --env=local
 * npm run provision-device -- /dev/ttyACM0 --env=local --env=preview --env=prod
 *
 * DB-only
 * npm run provision-device -- /dev/ttyACM0 --db-only --id=device_123 --env=prod
 * npm run provision-device -- /dev/ttyACM0 --db-only --id=device_123 --env=preview --env=prod
 */

//#region Types

type EnvName = "local" | "preview" | "prod";

type DeviceCredentials = {
  deviceId: string;
  secret: string;
};

//#endregion

//#region CLI Args

const {
  values: { env: envRaw, "db-only": dbOnly, id: expectedDeviceId },
  positionals,
} = parseArgs({
  options: {
    env: { type: "string", multiple: true, default: ["local"] },
    "db-only": { type: "boolean", default: false },
    id: { type: "string" },
  },
  allowPositionals: true, // Allows for serialport to be captured
});

// The serial port is the first positional argument
const portPath = positionals[0];

function isEnvName(x: string): x is EnvName {
  return x === "local" || x === "preview" || x === "prod";
}

const parsedEnvs = envRaw as string[];

for (const env of parsedEnvs) {
  if (!isEnvName(env)) {
    console.error(
      `Error: --env must be one of local|preview|prod (got: ${env})`,
    );
    process.exit(1);
  }
}

const targetEnvs: EnvName[] = parsedEnvs as EnvName[];

//#endregion

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

function isValidSecret(secret: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(secret);
}

function generateSecret(): string {
  return nodeCrypto.randomBytes(32).toString("hex"); // 64 hex chars
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

async function registerDeviceInEnvs(
  envs: EnvName[],
  deviceId: string,
  rawSecret: string,
) {
  const scriptDirname = path.dirname(fileURLToPath(import.meta.url));

  for (const env of envs) {
    dotenv({
      path: path.resolve(scriptDirname, `../.env.${env}`),
      override: true,
    });

    const databaseUrl = requireEnv("DATABASE_URL");
    const prisma = createPrismaClient(databaseUrl);

    try {
      console.log(`[DB:${env}] Registering device ${deviceId}...`);
      await registerDeviceInDB(prisma, deviceId, rawSecret);
    } finally {
      await prisma.$disconnect();
    }
  }
}

async function readProvisionedDeviceCredentials(
  portPath: string,
): Promise<DeviceCredentials> {
  const port = new SerialPort({
    path: portPath,
    baudRate: BAUD_RATE,
    autoOpen: false,
  });

  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

  let deviceId: string | undefined;
  let secret: string | undefined;
  let requestInterval: NodeJS.Timeout | undefined;

  try {
    await openSerialPort(port);

    const credentialsTask = new Promise<DeviceCredentials>(
      (resolve, reject) => {
        parser.on("data", (line) => {
          const cleanLine = line.toString().trim();

          if (cleanLine.startsWith("DEVICE_ID:")) {
            deviceId = cleanLine.split(":")[1]?.trim();
            port.write("PROV_GET\n", (err) => {
              if (err) {
                reject(err);
                return;
              }
            });
          }

          if (cleanLine.startsWith("PROV_SECRET:")) {
            secret = cleanLine.split(":")[1]?.trim();
          }

          if (cleanLine.startsWith("PROV_FAIL:")) {
            reject(new Error("Device reported provisioning failure"));
            return;
          }

          if (deviceId && secret) {
            if (!isValidSecret(secret)) {
              reject(
                new Error(
                  "Invalid secret format. Must be a 32-byte hex string (64 chars).",
                ),
              );
              return;
            }
            resolve({ deviceId, secret });
            return;
          }
        });

        // This matches esptool.py behavior of ignoring issues raised by Linux for using set() over native USB
        // This is required to use port.set() over ACM (native USB, which currently PCB only supports)

        port.on("error", (err) => {
          if (err.message.includes("Operation not supported, cannot set")) {
            console.warn("Ignored Linux ACM warning.");
          } else {
            // Still notify for non ACM warning for call to set
            console.error("Serial port error:", err.message);
          }
        });

        // It is safer to omit dtr flag and let hardware keep pin at state it is (high for normal boot)
        // This prevents further driver issues, although on Ubuntu 22.04 and SerialPort 13.0.0 including dtr flag is safe.
        port.set({ rts: true });
        setTimeout(() => {
          port.set({ rts: false }, (err) => {});
        }, 100);
      },
    );

    return await withTimeout(
      credentialsTask,
      7000,
      "Timeout: Device did not return provisioned credentials.",
    );
  } finally {
    if (requestInterval) {
      clearInterval(requestInterval);
    }

    parser.removeAllListeners("data");
    port.removeAllListeners();

    if (port.isOpen) {
      await closeSerialPort(port);
    }
  }
}

async function firstTimeProvision(
  portPath: string,
  targetEnvs: EnvName[],
): Promise<void> {
  const port = new SerialPort({
    path: portPath,
    baudRate: BAUD_RATE,
    autoOpen: false,
  });

  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

  try {
    await openSerialPort(port);
    console.log("Port open. Waiting for 'DEVICE_ID:'...");

    const provisioningTask = new Promise<void>((resolve, reject) => {
      let isProvisioning = false;

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
            await registerDeviceInEnvs(targetEnvs, deviceId, secret);

            console.log("Pushing secret to device...");
            await sleep(500); // Needed to allow hardware to catch up

            if (!port) {
              reject(new Error("Serial port not initialized"));
              return;
            }
            port.write(`PROV_SET:${secret}\n`, (err) => {
              if (err) {
                reject(err);
                return;
              }
            });
          } catch (err) {
            reject(err);
            return;
          }
        }

        if (cleanLine.includes("PROV_SUCCESS")) {
          console.log("SUCCESS: Device accepted the secret.");
          resolve();
          return;
        }

        if (cleanLine.includes("PROV_FAIL")) {
          reject(new Error("Device reported provisioning failure"));
          return;
        }
      });
    });

    await withTimeout(
      provisioningTask,
      20000,
      "Timeout: Device did not respond in 20s.",
    );
  } finally {
    // cleanup, but let main handle error catch
    parser.removeAllListeners("data");
    port.removeAllListeners();

    if (port.isOpen) {
      await closeSerialPort(port);
    }
  }
}

function printUsage() {
  console.error(
    "\nUsage:\n" +
      "  npm run provision-device -- /dev/ttyXXX [--env=local] [--env=preview] [--env=prod]\n" +
      "  npm run provision-device -- /dev/ttyXX --db-only --id=<deviceId> [--env=local] [--env=preview] [--env=prod]\n\n" +
      "Notes:\n" +
      "  --env may be repeated. Allowed values: local, preview, prod. Defaults to local.\n" +
      "  Repeating --env writes the same device secret to each selected database environment.\n\n" +
      "Examples:\n" +
      "  npm run provision-device -- /dev/ttyACM0\n" +
      "  npm run provision-device -- /dev/ttyACM0 --env=local\n" +
      "  npm run provision-device -- /dev/ttyACM0 --env=local --env=preview --env=prod\n" +
      "  npm run provision-device -- /dev/ttyACM0 --db-only --id=device_123 --env=prod\n" +
      "  npm run provision-device -- /dev/ttyACM0 --db-only --id=device_123 --env=preview --env=prod\n",
  );
}

async function main() {
  try {
    if (dbOnly) {
      if (!expectedDeviceId) {
        throw new Error("Missing --id for --db-only mode.");
      }

      if (!portPath) {
        throw new Error("Missing serial port for --db-only mode.");
      }

      console.log(
        `[Mode] DB Upsert from Provisioned Device (${targetEnvs.join(", ")})`,
      );

      const credentials = await readProvisionedDeviceCredentials(portPath);

      if (expectedDeviceId !== credentials.deviceId) {
        throw new Error(
          `Device ID mismatch. Provided ${expectedDeviceId}, but device gave ${credentials.deviceId}.`,
        );
      }

      await registerDeviceInEnvs(
        targetEnvs,
        credentials.deviceId,
        credentials.secret,
      );
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

      printUsage();

      process.exitCode = 1;
      return;
    }
    console.log(`[Mode] Interactive Serial Provisioning on ${portPath}`);
    await firstTimeProvision(portPath, targetEnvs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ERROR]", msg);
    process.exitCode = 1;
  }
}

main();
