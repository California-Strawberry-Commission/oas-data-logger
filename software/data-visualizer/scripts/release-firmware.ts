import { PrismaClient } from "@/generated/prisma/client";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  Channel,
  createPrismaClient,
  DeviceType,
  EnvName,
  isChannel,
  isDeviceType,
  isEnvName,
  readEnvFile,
} from "./lib/firmware";

//#region CLI Args

function printUsageAndExit(code = 0) {
  console.log(`
Releases app firmware to an env. Each release uploads the .bin and .elf to the
env's S3 bucket and adds a FirmwareRelease row to the env's DB.

  local    Builds the working tree (or --ref). Version is
           <version>-dev.<shortsha>[.dirty]. GitHub is not touched.
  preview  Builds --ref in a clean worktree. Version is <version> (STABLE) or
           <version>-beta.N (BETA, N derived from existing tags), and the
           GitHub release firmware/v<version> is created with the .bins.
  prod     Promotes the GitHub release firmware/v<version> (--version is the
           full version, e.g. 0.0.2 or 0.0.2-beta.3; channel follows from it).
           The .bins are verified against the preview DB, and the .elfs and
           build numbers are taken from preview.

Usage:
  release-firmware
    --env local|preview|prod
    --version <x.y.z>           (prod: x.y.z or x.y.z-beta.N)
    [--deviceType V0|V1]        (default both)
    [--channel STABLE|BETA]     (local/preview only; default STABLE)
    [--ref <git ref>]           (local/preview; default HEAD, or the working
                                 tree for local)
    [--publish]
    [--dry-run]                 (build/verify only; no GitHub, S3, or DB writes)
`);
  process.exit(code);
}

const {
  values: {
    env: envRaw,
    deviceType: deviceTypeRaw,
    channel: channelRaw,
    version: versionRaw,
    ref: refArg,
    publish = false,
    "dry-run": dryRun = false,
    help,
  },
} = parseArgs({
  options: {
    env: { type: "string" },
    deviceType: { type: "string" },
    channel: { type: "string" },
    version: { type: "string" },
    ref: { type: "string" },
    publish: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean" },
  },
  strict: true,
});

if (help) {
  printUsageAndExit(0);
}

if (!envRaw || !versionRaw) {
  printUsageAndExit(2);
}

if (!isEnvName(envRaw!)) {
  throw new Error(`env must be local, preview, or prod`);
}
if (deviceTypeRaw && !isDeviceType(deviceTypeRaw)) {
  throw new Error(`deviceType must be V0 or V1`);
}
if (channelRaw && !isChannel(channelRaw)) {
  throw new Error(`channel must be STABLE or BETA`);
}

const env: EnvName = envRaw!;
const deviceTypes: DeviceType[] = deviceTypeRaw
  ? [deviceTypeRaw as DeviceType]
  : ["V0", "V1"];
const versionArg: string = versionRaw!.replace(/^v/, "");

// For prod, we promote an existing release from preview so we require
// the full version name
if (env === "prod") {
  if (!/^\d+\.\d+\.\d+(-beta\.\d+)?$/.test(versionArg)) {
    throw new Error(`version must be x.y.z or x.y.z-beta.N for prod`);
  }
  if (refArg) {
    throw new Error(`--ref is not supported for prod`);
  }
} else if (!/^\d+\.\d+\.\d+$/.test(versionArg)) {
  throw new Error(`version must be x.y.z`);
}

// For prod, the channel is extracted from the version name
const channel: Channel =
  env === "prod"
    ? versionArg.includes("-beta.")
      ? "BETA"
      : "STABLE"
    : ((channelRaw as Channel | undefined) ?? "STABLE");
if (channelRaw && channelRaw !== channel) {
  throw new Error(
    `--channel ${channelRaw} does not match version ${versionArg}`,
  );
}

//#endregion

// Paths relative to the repo root
const FIRMWARE_DIR = "software/oas-logger";
const FIRMWARE_SRC_PATHS = [FIRMWARE_DIR, "software/dlflib"];
// Pre-script that injects the build identity. Commits without it can't be
// released since the build number would silently not be applied
const FW_VERSION_SCRIPT = `${FIRMWARE_DIR}/scripts/pio/fw_version.py`;

const HARDWARE_REV: Record<DeviceType, string> = { V0: "rev0", V1: "rev1" };

// Builds made with pio directly use FW_BUILD_NUMBER 0 (factory) or 1 (app) from
// platformio.ini, so releases start above them to be picked up via OTA
const MIN_BUILD_NUMBER = 2;

function run(cmd: string, args: string[], opts: { cwd?: string } = {}) {
  return execFileSync(cmd, args, {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function requireCommand(cmd: string, hint: string) {
  const result = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error(`'${cmd}' not found on PATH. ${hint}`);
  }
}

function sha256File(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function resolveCommit(repoRoot: string, ref: string): string {
  return run("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: repoRoot,
  });
}

//#region Envs

type EnvContext = {
  name: EnvName;
  prisma: PrismaClient;
  s3: S3Client;
  bucket: string;
};

function openEnv(name: EnvName): EnvContext {
  const vars = readEnvFile(name);
  const get = (key: string) => {
    if (!vars[key]) {
      throw new Error(`Missing env var ${key} in .env.${name}`);
    }
    return vars[key];
  };
  return {
    name,
    prisma: createPrismaClient(get("DATABASE_URL")),
    s3: new S3Client({
      region: get("AWS_REGION"),
      credentials: {
        accessKeyId: get("AWS_ACCESS_KEY_ID"),
        secretAccessKey: get("AWS_SECRET_ACCESS_KEY"),
      },
    }),
    bucket: get("S3_BUCKET_NAME"),
  };
}

/**
 * Returns the latest build number for deviceType in the env's DB, or 0 if there
 * is none. Note that build numbers are shared across channels.
 */
async function lastBuildNumber(
  ctx: EnvContext,
  deviceType: DeviceType,
): Promise<number> {
  const last = await ctx.prisma.firmwareRelease.findFirst({
    where: {
      deviceType,
    },
    orderBy: { buildNumber: "desc" },
    select: { buildNumber: true },
  });
  return last?.buildNumber ?? 0;
}

//#endregion

//#region Build

type Artifact = {
  deviceType: DeviceType;
  version: string;
  buildNumber: number;
  gitHash: string;
  binPath: string;
  elfPath: string;
  sha256: string;
};

function artifactBaseName(version: string, deviceType: DeviceType): string {
  return `firmware-v${version}-${HARDWARE_REV[deviceType]}`;
}

/**
 * Builds the app firmware for each device type, with build numbers from the
 * env's DB. When gitHash is null, the working tree is built as is. Otherwise,
 * gitHash is built in a temporary worktree.
 */
async function buildAll(
  ctx: EnvContext,
  repoRoot: string,
  version: string,
  gitHash: string,
  checkoutHash: string | null,
  outDir: string,
): Promise<Artifact[]> {
  const buildAllIn = async (repoDir: string) => {
    const artifacts: Artifact[] = [];
    for (const deviceType of deviceTypes) {
      const buildNumber = Math.max(
        (await lastBuildNumber(ctx, deviceType)) + 1,
        MIN_BUILD_NUMBER,
      );
      artifacts.push(
        buildFirmware(
          repoDir,
          deviceType,
          version,
          buildNumber,
          gitHash,
          outDir,
        ),
      );
    }
    return artifacts;
  };

  if (!checkoutHash) {
    return buildAllIn(repoRoot);
  }

  // Check whether FW_VERSION_SCRIPT exists at the specific commit
  try {
    run("git", ["cat-file", "-e", `${checkoutHash}:${FW_VERSION_SCRIPT}`], {
      cwd: repoRoot,
    });
  } catch {
    throw new Error(
      `${checkoutHash} does not contain ${FW_VERSION_SCRIPT}, so the build number cannot be injected`,
    );
  }

  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "oas-fw-wt-"));
  console.log(`Creating worktree at ${worktreeDir} (${checkoutHash})`);
  run("git", ["worktree", "add", "--detach", worktreeDir, checkoutHash], {
    cwd: repoRoot,
  });
  try {
    return await buildAllIn(worktreeDir);
  } finally {
    run("git", ["worktree", "remove", "--force", worktreeDir], {
      cwd: repoRoot,
    });
  }
}

/**
 * Builds the app firmware for deviceType in repoDir (a checkout of the repo),
 * and copies the .bin and .elf into outDir.
 */
function buildFirmware(
  repoDir: string,
  deviceType: DeviceType,
  version: string,
  buildNumber: number,
  gitHash: string,
  outDir: string,
): Artifact {
  const pioEnv = `${deviceType.toLowerCase()}-app`;
  const firmwareDir = path.join(repoDir, FIRMWARE_DIR);
  console.log(
    `Building ${deviceType} v${version} (${channel}, build ${buildNumber})`,
  );
  const result = spawnSync("pio", ["run", "-e", pioEnv], {
    cwd: firmwareDir,
    stdio: "inherit",
    env: {
      ...process.env,
      FW_BUILD_NUMBER: String(buildNumber),
      FW_VERSION: version,
      OTA_CHANNEL: channel,
      FW_GIT_HASH: gitHash,
    },
  });
  if (result.status !== 0) {
    throw new Error(`pio run -e ${pioEnv} failed`);
  }

  const buildDir = path.join(firmwareDir, ".pio", "build", pioEnv);
  const baseName = artifactBaseName(version, deviceType);
  const binPath = path.join(outDir, `${baseName}.bin`);
  const elfPath = path.join(outDir, `${baseName}.elf`);
  fs.copyFileSync(path.join(buildDir, "firmware.bin"), binPath);
  fs.copyFileSync(path.join(buildDir, "firmware.elf"), elfPath);
  return {
    deviceType,
    version,
    buildNumber,
    gitHash,
    binPath,
    elfPath,
    sha256: sha256File(binPath),
  };
}

//#endregion

//#region GitHub

function releaseTag(version: string): string {
  return `firmware/v${version}`;
}

/**
 * Returns the tags on GitHub (origin) matching the glob pattern.
 */
function remoteTags(repoRoot: string, pattern: string): string[] {
  return run("git", ["ls-remote", "--tags", "origin", `refs/tags/${pattern}`], {
    cwd: repoRoot,
  })
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t")[1].replace(/^refs\/tags\//, ""));
}

function remoteTagExists(repoRoot: string, tag: string): boolean {
  return remoteTags(repoRoot, tag).includes(tag);
}

function releaseNotes(artifacts: Artifact[]): string {
  const { version, gitHash } = artifacts[0];
  return [
    `- Version: \`${version}\``,
    `- Channel: \`${channel}\``,
    `- Git hash: \`${gitHash}\``,
    ...artifacts.map(
      (a) =>
        `- ${a.deviceType} (${HARDWARE_REV[a.deviceType]}): build \`${a.buildNumber}\`, sha256 \`${a.sha256}\``,
    ),
  ].join("\n");
}

//#endregion

//#region Releases

/**
 * local: builds the working tree (or --ref).
 */
async function releaseLocal(
  ctx: EnvContext,
  repoRoot: string,
  outDir: string,
): Promise<Artifact[]> {
  const gitHash = resolveCommit(repoRoot, refArg ?? "HEAD");
  const dirty =
    !refArg &&
    !!run("git", ["status", "--porcelain", "--", ...FIRMWARE_SRC_PATHS], {
      cwd: repoRoot,
    });
  const version = `${versionArg}-dev.${gitHash.slice(0, 7)}${dirty ? ".dirty" : ""}`;

  return buildAll(
    ctx,
    repoRoot,
    version,
    gitHash,
    refArg ? gitHash : null,
    outDir,
  );
}

/**
 * preview: builds --ref in a clean worktree, and creates the GitHub release.
 */
async function releasePreview(
  ctx: EnvContext,
  repoRoot: string,
  outDir: string,
): Promise<Artifact[]> {
  requireCommand("gh", "Install the GitHub CLI and run `gh auth login`.");

  const gitHash = resolveCommit(repoRoot, refArg ?? "HEAD");
  // The release targets the commit, so it must be on GitHub
  if (!run("git", ["branch", "-r", "--contains", gitHash], { cwd: repoRoot })) {
    throw new Error(
      `${gitHash} is not on any remote branch. Push it first (and git fetch)`,
    );
  }

  // Fail if the version was already released as STABLE. This also prevents
  // betas of an already released version
  const stableTag = releaseTag(versionArg);
  if (remoteTagExists(repoRoot, stableTag)) {
    throw new Error(
      `${stableTag} already exists. Bump --version to release again`,
    );
  }
  let version = versionArg;
  if (channel === "BETA") {
    const betaPrefix = `${stableTag}-beta.`;
    const lastBeta = remoteTags(repoRoot, `${betaPrefix}*`)
      .map((tag) => Number(tag.slice(betaPrefix.length)))
      .filter(Number.isInteger)
      .reduce((max, n) => Math.max(max, n), 0);
    version = `${versionArg}-beta.${lastBeta + 1}`;
  }
  const tag = releaseTag(version);

  const artifacts = await buildAll(
    ctx,
    repoRoot,
    version,
    gitHash,
    gitHash,
    outDir,
  );

  if (!dryRun) {
    console.log(`Creating GitHub release ${tag}`);
    run(
      "gh",
      [
        "release",
        "create",
        tag,
        ...artifacts.map((a) => a.binPath),
        "--target",
        gitHash,
        "--title",
        `Firmware v${version}`,
        "--notes",
        releaseNotes(artifacts),
        ...(channel === "BETA" ? ["--prerelease"] : []),
      ],
      { cwd: repoRoot },
    );
  }

  return artifacts;
}

/**
 * prod: downloads the .bins from the GitHub release and verifies them against
 * the preview DB. The .elfs come from the preview S3 bucket, and build numbers
 * from the preview DB, since they are baked into the .bins.
 */
async function releaseProd(
  ctx: EnvContext,
  repoRoot: string,
  outDir: string,
): Promise<Artifact[]> {
  requireCommand("gh", "Install the GitHub CLI and run `gh auth login`.");

  const version = versionArg;
  const tag = releaseTag(version);
  if (!remoteTagExists(repoRoot, tag)) {
    throw new Error(`GitHub release ${tag} does not exist`);
  }

  const preview = openEnv("preview");
  try {
    const artifacts: Artifact[] = [];
    for (const deviceType of deviceTypes) {
      // Look for the firmware release in preview matching the exact version name
      const previewRows = await preview.prisma.firmwareRelease.findMany({
        where: { deviceType, channel, version },
      });
      if (previewRows.length !== 1) {
        throw new Error(
          `Expected 1 preview release for ${deviceType}/${channel} v${version}, found ${previewRows.length}`,
        );
      }
      const previewRow = previewRows[0];
      if (!previewRow.elfS3Key || !previewRow.gitHash) {
        throw new Error(
          `Preview release for ${deviceType} v${version} has no .elf or git hash`,
        );
      }

      const baseName = artifactBaseName(version, deviceType);
      const binPath = path.join(outDir, `${baseName}.bin`);
      const elfPath = path.join(outDir, `${baseName}.elf`);

      console.log(`Downloading ${baseName}.bin from GitHub release ${tag}`);
      run(
        "gh",
        [
          "release",
          "download",
          tag,
          "--dir",
          outDir,
          "--pattern",
          `${baseName}.bin`,
        ],
        { cwd: repoRoot },
      );
      const sha256 = sha256File(binPath);
      if (sha256 !== previewRow.sha256) {
        throw new Error(
          `${baseName}.bin sha256 ${sha256} does not match preview ${previewRow.sha256}`,
        );
      }

      console.log(`Downloading ${previewRow.elfS3Key} from preview S3`);
      const elfObject = await preview.s3.send(
        new GetObjectCommand({
          Bucket: preview.bucket,
          Key: previewRow.elfS3Key,
        }),
      );
      fs.writeFileSync(elfPath, await elfObject.Body!.transformToByteArray());

      artifacts.push({
        deviceType,
        version,
        buildNumber: previewRow.buildNumber,
        gitHash: previewRow.gitHash,
        binPath,
        elfPath,
        sha256,
      });
    }
    return artifacts;
  } finally {
    await preview.prisma.$disconnect();
  }
}

//#endregion

/**
 * Uploads the artifact's .bin and .elf to the env's S3 bucket and creates the
 * corresponding FirmwareRelease row.
 */
async function recordRelease(ctx: EnvContext, artifact: Artifact) {
  const { deviceType, version, buildNumber, gitHash, sha256 } = artifact;

  // The .elf lives next to the .bin
  const s3Dir = `firmware/${deviceType}/${channel}/${String(
    buildNumber,
  ).padStart(6, "0")}`;
  const s3Key = `${s3Dir}/${path.basename(artifact.binPath)}`;
  const elfS3Key = `${s3Dir}/${path.basename(artifact.elfPath)}`;
  for (const [key, filePath] of [
    [s3Key, artifact.binPath],
    [elfS3Key, artifact.elfPath],
  ]) {
    await ctx.s3.send(
      new PutObjectCommand({
        Bucket: ctx.bucket,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentType: "application/octet-stream",
        CacheControl: "no-cache",
      }),
    );
    console.log(`Uploaded s3://${ctx.bucket}/${key}`);
  }

  // Fails if a row already exists for deviceType/channel/buildNumber
  const row = await ctx.prisma.firmwareRelease.create({
    data: {
      deviceType,
      channel,
      buildNumber,
      version,
      sha256,
      size: fs.statSync(artifact.binPath).size,
      s3Key,
      elfS3Key,
      gitHash,
      isPublished: publish,
      publishedAt: publish ? new Date() : null,
    },
  });

  console.log(`${ctx.name} DB successfully updated:`);
  console.table({
    id: row.id,
    deviceType,
    channel,
    version,
    buildNumber,
    sha256,
    size: row.size,
    s3Key,
    elfS3Key,
    gitHash,
    isPublished: row.isPublished,
  });
}

async function main() {
  if (env !== "prod") {
    requireCommand("pio", "Install PlatformIO Core.");
  }

  const scriptDirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = run("git", ["rev-parse", "--show-toplevel"], {
    cwd: scriptDirname,
  });

  const ctx = openEnv(env);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "oas-fw-release-"));

  try {
    const release = {
      local: releaseLocal,
      preview: releasePreview,
      prod: releaseProd,
    }[env];
    const artifacts = await release(ctx, repoRoot, outDir);

    if (dryRun) {
      console.log("Dry run: build only. Artifacts:");
      for (const a of artifacts) {
        console.log(`  ${a.binPath}\n  ${a.elfPath}`);
      }
      return;
    }

    for (const artifact of artifacts) {
      await recordRelease(ctx, artifact);
    }
  } finally {
    // Artifacts are kept for dry runs only
    if (!dryRun) {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
    await ctx.prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("ERROR:", err?.message ?? err);
  process.exit(1);
});
