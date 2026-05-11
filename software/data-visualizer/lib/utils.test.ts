import {
  formatElapsed,
  formatTimeAgo,
  groupRunsIntoSessions,
  isValidUuid,
} from "@/lib/utils";
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

describe("formatTimeAgo", () => {
  it("formats sub-minute durations in seconds", () => {
    expect(formatTimeAgo(0)).toBe("0s ago");
    expect(formatTimeAgo(1)).toBe("1s ago");
    expect(formatTimeAgo(59)).toBe("59s ago");
    expect(formatTimeAgo(59.9)).toBe("59s ago");
  });

  it("formats sub-hour durations in minutes", () => {
    expect(formatTimeAgo(60)).toBe("1m ago");
    expect(formatTimeAgo(90)).toBe("1m ago");
    expect(formatTimeAgo(3599)).toBe("59m ago");
  });

  it("formats sub-day durations in hours", () => {
    expect(formatTimeAgo(3600)).toBe("1h ago");
    expect(formatTimeAgo(7199)).toBe("1h ago");
    expect(formatTimeAgo(86399)).toBe("23h ago");
  });

  it("formats durations of a day or more in days", () => {
    expect(formatTimeAgo(86400)).toBe("1d ago");
    expect(formatTimeAgo(172800)).toBe("2d ago");
    expect(formatTimeAgo(86400 * 10)).toBe("10d ago");
  });
});

function run(
  epochTimeS: number,
  durationS: number,
): { epochTimeS: number; durationS: number } {
  return { epochTimeS, durationS };
}

describe("groupRunsIntoSessions", () => {
  it("returns an empty array for no runs", () => {
    expect(groupRunsIntoSessions([])).toEqual([]);
  });

  it("puts a single run into a single session", () => {
    expect(groupRunsIntoSessions([run(0, 100)])).toEqual([[run(0, 100)]]);
  });

  it("merges runs whose end-to-start gap is below the threshold", () => {
    const a = run(0, 1000);
    const b = run(1000 + 7 * 3600, 500); // gap is 7h, which is below 8h default threshold
    expect(groupRunsIntoSessions([a, b])).toEqual([[a, b]]);
  });

  it("splits runs whose end-to-start gap meets the threshold", () => {
    const a = run(0, 1000);
    const b = run(1000 + 8 * 3600, 500); // gap is exactly the 8h default threshold
    expect(groupRunsIntoSessions([a, b])).toEqual([[a], [b]]);
  });

  it("splits runs whose end-to-start gap exceeds the threshold", () => {
    const a = run(0, 1000);
    const b = run(1000 + 9 * 3600, 500); // gap is 9h, which is above the 8h default threshold
    expect(groupRunsIntoSessions([a, b])).toEqual([[a], [b]]);
  });

  it("sorts runs by epochTimeS before grouping", () => {
    const a = run(0, 1000);
    const b = run(500, 200); // starts after a but overlaps
    expect(groupRunsIntoSessions([b, a])).toEqual([[a, b]]);
  });

  it("groups multiple runs into the correct sessions", () => {
    const a = run(0, 100);
    const b = run(200, 100);
    const c = run(8 * 3600 + 400, 100);
    const d = run(8 * 3600 + 600, 100);
    expect(groupRunsIntoSessions([a, b, c, d])).toEqual([
      [a, b],
      [c, d],
    ]);
  });

  it("respects a custom gapThresholdS", () => {
    const a = run(0, 100);
    const b = run(200, 100);
    expect(groupRunsIntoSessions([a, b], 50)).toEqual([[a], [b]]);
    expect(groupRunsIntoSessions([a, b], 200)).toEqual([[a, b]]);
  });

  it("does not mutate the input array", () => {
    const input = [run(500, 100), run(0, 100)];
    const copy = [...input];
    groupRunsIntoSessions(input);
    expect(input).toEqual(copy);
  });
});
