import { decryptSecret } from "@/lib/crypto";
import prisma from "@/lib/prisma";
import { verifyDeviceSignature } from "@/lib/verify-device";
import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    deviceSecret: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/crypto", () => ({
  decryptSecret: vi.fn(),
}));

const DEVICE_ID = "device-abc-123";
const SECRET = "super-secret-key";
const TIMESTAMP = "1700000000";
const NONCE = "random-nonce-xyz";

function makeSignature(payload?: string): string {
  const payloadHash = crypto
    .createHash("sha256")
    .update(payload ?? "")
    .digest("hex");
  const stringToSign = `${DEVICE_ID}:${TIMESTAMP}:${NONCE}:${payloadHash}`;
  return crypto.createHmac("sha256", SECRET).update(stringToSign).digest("hex");
}

function makeHeaders(overrides: Record<string, string> = {}): Headers {
  const defaults: Record<string, string> = {
    "x-timestamp": TIMESTAMP,
    "x-nonce": NONCE,
    "x-signature": makeSignature(),
  };
  return new Headers({ ...defaults, ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifyDeviceSignature", () => {
  describe("normal auth", () => {
    it("returns failure when required security headers are missing", async () => {
      const result = await verifyDeviceSignature(DEVICE_ID, new Headers());
      expect(result.success).toBe(false);
    });

    it("returns failure when device is not found in the database", async () => {
      vi.mocked(prisma.deviceSecret.findUnique).mockResolvedValue(null);

      const result = await verifyDeviceSignature(DEVICE_ID, makeHeaders());

      expect(result.success).toBe(false);
    });

    it("returns failure when signature does not match", async () => {
      vi.mocked(prisma.deviceSecret.findUnique).mockResolvedValue({
        deviceId: DEVICE_ID,
        secret: "encrypted-blob",
      } as any);
      vi.mocked(decryptSecret).mockReturnValue(SECRET);

      const headers = makeHeaders({ "x-signature": "bad-signature" });
      const result = await verifyDeviceSignature(DEVICE_ID, headers);

      expect(result.success).toBe(false);
    });

    it("returns success when signature is valid with no payload", async () => {
      vi.mocked(prisma.deviceSecret.findUnique).mockResolvedValue({
        deviceId: DEVICE_ID,
        secret: "encrypted-blob",
      } as any);
      vi.mocked(decryptSecret).mockReturnValue(SECRET);

      const result = await verifyDeviceSignature(DEVICE_ID, makeHeaders());

      expect(result.success).toBe(true);
    });

    it("returns success when signature is valid with a payload", async () => {
      const payload = '{"sensor":"temp","value":23.5}';
      vi.mocked(prisma.deviceSecret.findUnique).mockResolvedValue({
        deviceId: DEVICE_ID,
        secret: "encrypted-blob",
      } as any);
      vi.mocked(decryptSecret).mockReturnValue(SECRET);

      const headers = makeHeaders({ "x-signature": makeSignature(payload) });
      const result = await verifyDeviceSignature(DEVICE_ID, headers, payload);

      expect(result).toEqual({ success: true });
    });
  });
});
