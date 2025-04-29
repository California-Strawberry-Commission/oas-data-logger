import { PrismaClient } from "@/generated/prisma/client";

// Creates a Prisma Client and attaches it to the global object so that
// only one instance of the client is created in the application. This
// helps resolve issues with hot reloading that can occur when using
// Prisma ORM with Next.js in development mode.

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
};

const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
