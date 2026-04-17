import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { beforeEach, describe, expect, it } from "vitest";

const TEST_KEY = "a".repeat(64);

beforeEach(() => {
  process.env.DEVICE_SECRET_ENCRYPTION_KEY = TEST_KEY;
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext secret", () => {
    const plaintext = "my-device-secret";
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  it("round-trips a long secret", () => {
    const plaintext = "x".repeat(1000);
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  it("produces a different ciphertext each call (random IV)", () => {
    const plaintext = "same-secret";
    expect(encryptSecret(plaintext)).not.toBe(encryptSecret(plaintext));
  });
});

describe("decryptSecret", () => {
  it("throws on a missing section", () => {
    expect(() => decryptSecret("onlytwoparts:abc")).toThrow();
  });

  it("throws on an empty string", () => {
    expect(() => decryptSecret("")).toThrow();
  });

  it("throws when the auth tag is tampered with", () => {
    const packed = encryptSecret("secret");
    const [iv, , ciphertext] = packed.split(":");
    const badTag = "00".repeat(16);
    expect(() => decryptSecret(`${iv}:${badTag}:${ciphertext}`)).toThrow();
  });

  it("throws when the ciphertext is tampered with", () => {
    const packed = encryptSecret("secret");
    const [iv, authTag] = packed.split(":");
    const badCiphertext = "bad-secret";
    expect(() => decryptSecret(`${iv}:${authTag}:${badCiphertext}`)).toThrow();
  });
});
