import { PrismaClient } from "@/generated/prisma/client";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as dotenv } from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs";
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
  publish-firmware
    --env local|preview|prod
    --file <firmware.bin>
    --deviceType V0|V1
    --version <string>
    [--channel STABLE|BETA]
    [--publish]
    [--buildNumber <int>]
    [--s3Key <key>]
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
    file: fileRaw,
    deviceType: deviceTypeRaw,
    channel: channelRaw = "STABLE",
    version: versionRaw,
    publish = false,
    buildNumber: buildNumberArg,
    s3Key: s3KeyArg,
    help,
  },
} = parseArgs({
  options: {
    env: { type: "string" },
    file: { type: "string" },
    deviceType: { type: "string" },
    channel: { type: "string" },
    version: { type: "string" },
    publish: { type: "boolean", default: false },
    buildNumber: { type: "string" },
    s3Key: { type: "string" },
    help: { type: "boolean" },
  },
  strict: true,
});

if (help) {
  printUsageAndExit(0);
}

if (!envRaw || !fileRaw || !deviceTypeRaw || !versionRaw) {
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

const env: EnvName = envRaw!;
const file: string = fileRaw!;
const deviceType: DeviceType = deviceTypeRaw!;
const channel: Channel = channelRaw!;
const version: string = versionRaw!;

//#endregion

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing env var ${name}`);
  }
  return val;
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    while (true) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

async function s3ObjectExists(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
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

  const databaseUrl = requireEnv("DATABASE_URL");
  const awsRegion = requireEnv("AWS_REGION");
  const s3Bucket = requireEnv("S3_BUCKET_NAME");

  const fileAbsPath = path.resolve(file);
  const fileStat = fs.statSync(fileAbsPath);
  if (!fileStat.isFile()) {
    throw new Error(`Not a file: ${fileAbsPath}`);
  }

  const size = fileStat.size;
  const sha256 = sha256File(fileAbsPath);

  const prisma = createPrismaClient(databaseUrl);
  const s3 = new S3Client({
    region: awsRegion,
    credentials: {
      accessKeyId: requireEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("AWS_SECRET_ACCESS_KEY"),
    },
  });

  try {
    // Figure out the next incremental build number
    let buildNumber: number;
    if (!buildNumberArg) {
      const last = await prisma.firmwareRelease.findFirst({
        where: { deviceType, channel },
        orderBy: { buildNumber: "desc" },
        select: { buildNumber: true },
      });
      buildNumber = (last?.buildNumber ?? 0) + 1;
    } else {
      buildNumber = Number(buildNumberArg);
      if (!Number.isInteger(buildNumber) || buildNumber <= 0) {
        throw new Error(`buildNumber must be a positive integer`);
      }
    }

    // Generate S3 key
    const shaShort = sha256.slice(0, 12);
    const baseName = path.basename(fileAbsPath).replace(/\.bin$/i, "");
    const s3Key =
      s3KeyArg ??
      `firmware/${deviceType}/${channel}/${String(buildNumber).padStart(
        6,
        "0",
      )}/${baseName}-${shaShort}.bin`;

    // Upload file to S3
    const exists = await s3ObjectExists(s3, s3Bucket, s3Key);
    if (!exists) {
      await s3.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: s3Key,
          Body: fs.createReadStream(fileAbsPath),
          ContentType: "application/octet-stream",
          CacheControl: "no-cache",
        }),
      );
      console.log(
        "Successfully uploaded object to S3:",
        JSON.stringify(
          {
            bucket: s3Bucket,
            key: s3Key,
            sizeBytes: size,
            sha256: sha256.slice(0, 12) + "...",
          },
          null,
          2,
        ),
      );
    } else {
      console.log(
        `Object with key ${s3Key} already exists in S3 bucket ${s3Bucket}. Skipping upload`,
      );
    }

    // Update DB
    const now = new Date();
    const row = await prisma.firmwareRelease.upsert({
      where: {
        deviceType_channel_buildNumber: { deviceType, channel, buildNumber },
      },
      create: {
        deviceType,
        channel,
        version,
        buildNumber,
        sha256,
        size,
        s3Key,
        isPublished: publish,
        publishedAt: publish ? now : null,
      },
      update: {
        version,
        sha256,
        size,
        s3Key,
        isPublished: publish,
        publishedAt: publish ? now : null,
      },
    });

    console.log("DB successfully updated:");
    console.table({
      id: row.id,
      deviceType,
      channel,
      version,
      buildNumber,
      sha256,
      size,
      s3Key,
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
