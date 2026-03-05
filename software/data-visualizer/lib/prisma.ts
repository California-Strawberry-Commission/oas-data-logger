import { PrismaClient, type Prisma, type Run } from "@/generated/prisma/client";
import type { User } from "@/lib/auth";
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

export function runWhereForUser(
  user: User,
  uuid: string,
): Prisma.RunWhereInput {
  // ADMINs can access all runs.
  // Others can only access runs for devices they are associated with.
  const where =
    user.role === "ADMIN"
      ? { uuid }
      : {
          uuid,
          device: {
            userDevices: {
              some: {
                userId: user.id,
              },
            },
          },
        };
  return where;
}

export function runsWhereForUser(user: User): Prisma.RunWhereInput {
  // ADMINs can access all runs.
  // Others can only access runs for devices they are associated with.
  const where =
    user.role === "ADMIN"
      ? {}
      : {
          device: {
            userDevices: {
              some: {
                userId: user.id,
              },
            },
          },
        };
  return where;
}

export function devicesWhereForUser(user: User): Prisma.DeviceWhereInput {
  // ADMINs can access all devices.
  // USERs can only access devices they are associated with.
  const where =
    user.role === "ADMIN"
      ? {}
      : {
          userDevices: {
            some: {
              userId: user.id,
            },
          },
        };
  return where;
}

/**
 * Get run by UUID.
 *
 * @param user
 * @param uuid
 * @param options
 * @returns Returns the Run if it exists and the user is allowed to access it, otherwise null.
 */
export async function getRunForUser(
  user: User,
  uuid: string,
  options?: {
    select?: Prisma.RunSelect;
    include?: Prisma.RunInclude;
  },
): Promise<Run | null> {
  const where = runWhereForUser(user, uuid);
  return prisma.run.findFirst({
    where,
    ...options,
  });
}
