import { parseArgs } from "node:util";
import {
  createPrismaClient,
  DeviceType,
  EnvName,
  isDeviceType,
  isEnvName,
  loadEnvFile,
  requireEnv,
} from "./lib/firmware";

//#region CLI Args

function printUsageAndExit(code = 0) {
  console.log(`
Modifies an existing firmware release in the env's DB. With no modification
flags, prints the release.

Usage:
  update-firmware
    --env local|preview|prod
    --deviceType V0|V1
    --buildNumber <int>
    [--publish | --unpublish]
`);
  process.exit(code);
}

const {
  values: {
    env: envRaw,
    deviceType: deviceTypeRaw,
    buildNumber: buildNumberRaw,
    publish = false,
    unpublish = false,
    help,
  },
} = parseArgs({
  options: {
    env: { type: "string" },
    deviceType: { type: "string" },
    buildNumber: { type: "string" },
    publish: { type: "boolean", default: false },
    unpublish: { type: "boolean", default: false },
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
if (publish && unpublish) {
  throw new Error(`--publish and --unpublish are mutually exclusive`);
}

const buildNumber = Number(buildNumberRaw);
if (!Number.isInteger(buildNumber) || buildNumber <= 0) {
  throw new Error(`buildNumber must be a positive integer`);
}

const env: EnvName = envRaw!;
const deviceType: DeviceType = deviceTypeRaw!;

//#endregion

async function main() {
  loadEnvFile(env);

  const prisma = createPrismaClient(requireEnv("DATABASE_URL"));

  try {
    const where = {
      deviceType_buildNumber: { deviceType, buildNumber },
    };

    let row = await prisma.firmwareRelease.findUnique({ where });
    if (!row) {
      throw new Error(
        `No firmware release found for ${deviceType} build ${buildNumber}`,
      );
    }

    if (publish || unpublish) {
      if (row.isPublished === publish) {
        console.log(
          `Firmware ${deviceType} build ${buildNumber} is already ${
            publish ? "published" : "unpublished"
          }`,
        );
      } else {
        // S3 objects are kept on unpublish so the release can be republished
        row = await prisma.firmwareRelease.update({
          where,
          data: {
            isPublished: publish,
            publishedAt: publish ? new Date() : null,
          },
        });
        console.log("DB successfully updated:");
      }
    }

    console.table({
      id: row.id,
      deviceType,
      channel: row.channel,
      version: row.version,
      buildNumber,
      gitHash: row.gitHash,
      s3Key: row.s3Key,
      elfS3Key: row.elfS3Key,
      isPublished: row.isPublished,
      publishedAt: row.publishedAt,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("ERROR:", err?.message ?? err);
  process.exit(1);
});
