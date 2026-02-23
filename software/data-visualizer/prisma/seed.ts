import { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/lib/auth";
import { PrismaPg } from "@prisma/adapter-pg";

function createPrismaClient() {
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

async function main() {
  if (process.env.NODE_ENV !== "development") {
    console.log(`Skipping database seed (NODE_ENV is not development).`);
    return;
  }

  const prisma = createPrismaClient();

  const email = "admin@example.com";
  const password = "password123";
  const passwordHash = await hashPassword(password);

  try {
    const admin = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash,
        role: "ADMIN",
      },
    });

    console.log(`Seeded admin user: ${admin.email}`);
    console.log(`Password: ${password}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[ERROR]", msg);
  process.exit(1);
});
