import { formatElapsed, isValidUuid } from "@/lib/utils";
import { describe, expect, it } from "vitest";

describe("formatElapsed", () => {
  it("formats seconds only", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(45)).toBe("45s");
    expect(formatElapsed(59)).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatElapsed(60)).toBe("1m 0s");
    expect(formatElapsed(90)).toBe("1m 30s");
    expect(formatElapsed(3599)).toBe("59m 59s");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatElapsed(3600)).toBe("1h 0m 0s");
    expect(formatElapsed(3661)).toBe("1h 1m 1s");
    expect(formatElapsed(7384)).toBe("2h 3m 4s");
  });

  it("truncates fractional seconds", () => {
    expect(formatElapsed(1.9)).toBe("1s");
    expect(formatElapsed(61.9)).toBe("1m 1s");
  });
});

describe("isValidUuid", () => {
  it("accepts a valid lowercase UUID", () => {
    expect(isValidUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("accepts a valid uppercase UUID", () => {
    expect(isValidUuid("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });

  it("accepts a valid mixed-case UUID", () => {
    expect(isValidUuid("550e8400-E29B-41d4-A716-446655440000")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidUuid("")).toBe(false);
  });

  it("rejects a UUID with missing hyphens", () => {
    expect(isValidUuid("550e8400e29b41d4a716446655440000")).toBe(false);
  });

  it("rejects a UUID with hyphens in the wrong position", () => {
    expect(isValidUuid("550e8-400e29b-41d4a716-446655440000")).toBe(false);
  });

  it("rejects a UUID that is too short", () => {
    expect(isValidUuid("550e8400-e29b-41d4-a716-44665544000")).toBe(false);
  });

  it("rejects a UUID that is too long", () => {
    expect(isValidUuid("550e8400-e29b-41d4-a716-4466554400001")).toBe(false);
  });

  it("rejects a UUID with non-hex characters", () => {
    expect(isValidUuid("550e8400-e29b-41d4-a716-44665544000g")).toBe(false);
  });
});
