import { isValidUuid } from "@/lib/utils";
import { describe, expect, it } from "vitest";

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
