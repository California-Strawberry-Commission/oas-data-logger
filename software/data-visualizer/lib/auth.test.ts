import { getCurrentUser, type User } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentUser", () => {
  const testUser: User = { id: "user-1", role: "USER", email: "a@b.com" };

  describe("session auth", () => {
    it("returns null when there is no session", async () => {
      vi.mocked(cookies).mockResolvedValue({
        get: vi.fn().mockReturnValue(undefined),
      } as any);
      expect(await getCurrentUser()).toBeNull();
    });

    it("returns the user when the session is valid and the user exists", async () => {
      vi.mocked(cookies).mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "valid-token" }),
      } as any);
      vi.mocked(jwtVerify).mockResolvedValue({
        payload: { sub: testUser.id },
      } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(testUser as any);

      expect(await getCurrentUser()).toEqual(testUser);
    });

    it("returns null when the user has been deleted from the DB", async () => {
      vi.mocked(cookies).mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "valid-token" }),
      } as any);
      vi.mocked(jwtVerify).mockResolvedValue({
        payload: { sub: testUser.id },
      } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      expect(await getCurrentUser()).toBeNull();
    });
  });
});
