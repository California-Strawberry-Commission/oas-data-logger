import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { hashPassword, setSession } from "@/lib/auth";

export async function POST(req: Request) {
  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    return NextResponse.json({ error: "Email in use" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, passwordHash },
    select: { id: true },
  });

  const response = NextResponse.json({ ok: true });
  await setSession(response.cookies, user.id);
  return response;
}
