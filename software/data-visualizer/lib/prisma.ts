import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Creates a Prisma Client and attaches it to the global object so that
// only one instance of the client is created in the application. This
// helps resolve issues with hot reloading that can occur when using
// Prisma ORM with Next.js in development mode.

// Extend the global object with a `prisma` property.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function makePrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  // Create a PostgreSQL adapter
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });
  return new PrismaClient({ adapter });
}

// Reuse an existing Prisma client if one was already created
// in this Node.js process (important for Next.js dev mode).
// Otherwise, create a new one.
const prisma = globalForPrisma.prisma ?? makePrismaClient();

// In development mode, store the Prisma client on the global object.
// This prevents Next.js hot reloads from creating multiple
// database connection pools and exhausting Postgres connections.
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
