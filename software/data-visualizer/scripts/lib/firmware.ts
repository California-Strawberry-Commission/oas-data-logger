import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as dotenv, parse as parseDotenv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

//#region Types

export type EnvName = "local" | "preview" | "prod";
export type DeviceType = "V0" | "V1";
export type Channel = "STABLE" | "BETA";

export function isEnvName(x: string): x is EnvName {
  return x === "local" || x === "preview" || x === "prod";
}

export function isDeviceType(x: string): x is DeviceType {
  return x === "V0" || x === "V1";
}

export function isChannel(x: string): x is Channel {
  return x === "STABLE" || x === "BETA";
}

//#endregion

export function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing env var ${name}`);
  }
  return val;
}

function envFilePath(env: EnvName): string {
  // Resolve .env file relative to this script file
  const scriptDirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDirname, `../../.env.${env}`);
}

/**
 * Loads data-visualizer/.env.<env> into process.env.
 */
export function loadEnvFile(env: EnvName) {
  dotenv({ path: envFilePath(env) });
}

/**
 * Reads data-visualizer/.env.<env> without touching process.env, for scripts
 * that need to talk to multiple envs.
 */
export function readEnvFile(env: EnvName): Record<string, string> {
  return parseDotenv(fs.readFileSync(envFilePath(env)));
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });
  return new PrismaClient({ adapter });
}
