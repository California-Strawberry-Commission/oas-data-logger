import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

//#region Types

type EnvName = "local" | "preview" | "prod";
type DeviceType = "V0" | "V1";
type Channel = "STABLE" | "BETA";

//#endregion

//#region CLI Args

function printUsageAndExit(code = 0) {
  console.log(`
Usage:
  unpublish-firmware
    --env local|preview|prod
    --deviceType V0|V1
    --buildNumber <int>
    [--channel STABLE|BETA]
`);
  process.exit(code);
}

function isEnvName(x: string): x is EnvName {
  return x === "local" || x === "preview" || x === "prod";
}

function isDeviceType(x: string): x is DeviceType {
  return x === "V0" || x === "V1";
}

function isChannel(x: string): x is Channel {
  return x === "STABLE" || x === "BETA";
}

const {
  values: {
    env: envRaw,
    deviceType: deviceTypeRaw,
    channel: channelRaw = "STABLE",
    buildNumber: buildNumberRaw,
    help,
  },
} = parseArgs({
  options: {
    env: { type: "string" },
    deviceType: { type: "string" },
    channel: { type: "string" },
    buildNumber: { type: "string" },
    help: { type: "boolean" },
  },
  strict: true,
});

if (help) {
  printUsageAndExit(0);
}

if (!envRaw || !deviceTypeRaw || !buildNumberRaw) {
  printUsageAndExit(2);
}

if (!isEnvName(envRaw!)) {
  throw new Error(`env must be local, preview, or prod`);
}
if (!isDeviceType(deviceTypeRaw!)) {
  throw new Error(`deviceType must be V0 or V1`);
}
if (!isChannel(channelRaw!)) {
  throw new Error(`channel must be STABLE or BETA`);
}

const buildNumber = Number(buildNumberRaw);
if (!Number.isInteger(buildNumber) || buildNumber <= 0) {
  throw new Error(`buildNumber must be a positive integer`);
}

const env: EnvName = envRaw!;
const deviceType: DeviceType = deviceTypeRaw!;
const channel: Channel = channelRaw!;

//#endregion

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing env var ${name}`);
  }
  return val;
}

function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });
  return new PrismaClient({ adapter });
}

async function main() {
  // Resolve .env file relative to this script file
  const scriptDirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv({
    path: path.resolve(scriptDirname, `../.env.${env}`),
  });

  const prisma = createPrismaClient(requireEnv("DATABASE_URL"));

  try {
    const where = {
      deviceType_channel_buildNumber: { deviceType, channel, buildNumber },
    };

    const existing = await prisma.firmwareRelease.findUnique({ where });
    if (!existing) {
      throw new Error(
        `No firmware release found for ${deviceType}/${channel} build ${buildNumber}`,
      );
    }
    if (!existing.isPublished) {
      console.log(
        `Firmware ${deviceType}/${channel} build ${buildNumber} is already unpublished`,
      );
      return;
    }

    // S3 object is kept so the release can be republished later
    const row = await prisma.firmwareRelease.update({
      where,
      data: { isPublished: false, publishedAt: null },
    });

    console.log("DB successfully updated:");
    console.table({
      id: row.id,
      deviceType,
      channel,
      version: row.version,
      buildNumber,
      s3Key: row.s3Key,
      isPublished: row.isPublished,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("ERROR:", err?.message ?? err);
  process.exit(1);
});
