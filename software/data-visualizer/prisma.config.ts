import { config as dotenv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Env file is used for local dev only for DATABASE_URL
dotenv({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
