import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";
import { cookies } from "next/headers";

const alg = "HS256";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET);

export type User = {
  id: string;
  role: "USER" | "ADMIN";
  email: string;
};

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function setSession(cookies: ResponseCookies, userId: string) {
  // Note: calling `await cookies()` inside a helper does not reliably work for
  // responses as it may not be bound to the same response context as that in the
  // route handler. So, to be safe, we pass ResponseCookies in as a param that we
  // then modify.
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);

  cookies.set("session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function getSession(): Promise<{ userId: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) {
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload?.sub ? { userId: payload.sub } : null;
  } catch {
    return null;
  }
}

export async function clearSession(cookies: ResponseCookies) {
  // Note: calling `await cookies()` inside a helper does not reliably work for
  // responses as it may not be bound to the same response context as that in the
  // route handler. So, to be safe, we pass ResponseCookies in as a param that we
  // then modify.
  cookies.delete("session");
}

export async function getCurrentUser(
  requestHeaders?: Headers,
): Promise<User | null> {
  // First try dev bypass
  if (requestHeaders) {
    const devUser = await checkDevBypass(requestHeaders);
    if (devUser) {
      return devUser;
    }
  }

  // Normal session auth
  const session = await getSession();
  if (!session) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, role: true, email: true },
  });

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    role: user.role as "USER" | "ADMIN",
    email: user.email,
  };
}

async function checkDevBypass(headers: Headers): Promise<User | null> {
  // Never allow bypass in production
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const expectedKey = process.env.AUTH_DEV_KEY;
  const providedKey = headers.get("x-dev-key");
  if (!expectedKey || !providedKey || expectedKey !== providedKey) {
    return null;
  }

  // Impersonate by userId or by email
  const devUserId = headers.get("x-dev-user-id");
  const devEmail = headers.get("x-dev-user-email");

  const user = await prisma.user.findFirst({
    where: devUserId
      ? { id: devUserId }
      : devEmail
        ? { email: devEmail }
        : undefined,
    select: { id: true, role: true, email: true },
  });
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    role: user.role as "USER" | "ADMIN",
    email: user.email,
  };
}
