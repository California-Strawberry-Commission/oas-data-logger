import { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/lib/auth";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV !== "development") {
    console.log(`Skipping database seed (NODE_ENV is not development).`);
    return;
  }

  const email = "admin@example.com";
  const password = "password123";

  const passwordHash = await hashPassword(password);

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
