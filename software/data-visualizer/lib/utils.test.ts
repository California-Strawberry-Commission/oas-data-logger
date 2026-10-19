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
    expect(groupRunsIntoSessions([run(0, 1000)])).toEqual([[run(0, 1000)]]);
  });

  it("merges runs whose end-to-start gap is below gapThresholdS", () => {
    const a = run(0, 1000);
    const b = run(1000 + 5 * 3600, 500); // gap is below the threshold
    expect(groupRunsIntoSessions([a, b])).toEqual([[a, b]]);
  });

  it("splits runs whose end-to-start gap equals gapThresholdS", () => {
    const a = run(0, 1000);
    const b = run(1000 + 6 * 3600, 500); // gap is exactly the threshold
    expect(groupRunsIntoSessions([a, b])).toEqual([[a], [b]]);
  });

  it("splits runs whose end-to-start gap exceeds gapThresholdS", () => {
    const a = run(0, 1000);
    const b = run(1000 + 7 * 3600, 500); // gap is above the threshold
    expect(groupRunsIntoSessions([a, b])).toEqual([[a], [b]]);
  });

  it("sorts runs by epochTimeS before grouping", () => {
    const a = run(0, 1000);
    const b = run(500, 200); // starts after a but overlaps
    expect(groupRunsIntoSessions([b, a])).toEqual([[a, b]]);
  });

  it("measures gaps from the latest end of any prior run in the session", () => {
    const a = run(0, 10 * 3600);
    const b = run(1000, 200); // contained within a
    const c = run(10 * 3600 + 1000, 200); // 1000s after a ends, long after b ends
    expect(groupRunsIntoSessions([a, b, c])).toEqual([[a, b, c]]);
  });

  it("groups multiple runs into the correct sessions", () => {
    const a = run(0, 200);
    const b = run(300, 200);
    const c = run(6 * 3600 + 600, 200);
    const d = run(6 * 3600 + 900, 200);
    expect(groupRunsIntoSessions([a, b, c, d])).toEqual([
      [a, b],
      [c, d],
    ]);
  });

  it("ignores runs shorter than minRunDurationS", () => {
    const a = run(0, 179);
    const b = run(1000, 180);
    expect(groupRunsIntoSessions([a, b])).toEqual([[b]]);
    expect(groupRunsIntoSessions([a])).toEqual([]);
  });

  it("always includes active runs, even if short", () => {
    const a = { ...run(0, 10), isActive: true };
    const b = { ...run(1000, 10), isActive: false };
    expect(groupRunsIntoSessions([a, b])).toEqual([[a]]);
  });

  it("does not let ignored runs bridge sessions", () => {
    const a = run(0, 200);
    const short = run(4 * 3600, 60);
    const b = run(8 * 3600, 200);
    expect(groupRunsIntoSessions([a, short, b])).toEqual([[a], [b]]);
  });

  it("splits a session exceeding maxSessionDurationSs at the largest gap", () => {
    // Runs every 4h with gaps below 6h, spanning > maxSessionDurationS
    const a = run(0, 3600);
    const b = run(4 * 3600, 3600); // gap 3h
    const c = run(9 * 3600, 3600); // gap 4h (largest)
    const d = run(12 * 3600, 3600); // gap 2h
    const e = run(16 * 3600, 10 * 3600); // gap 3h, ends at 26h
    expect(groupRunsIntoSessions([a, b, c, d, e])).toEqual([
      [a, b],
      [c, d, e],
    ]);
  });

  it("repeatedly splits until every session is within maxSessionDurationS", () => {
    // 15 runs of 1h, 4h apart start-to-start (gap 3h), except one larger gap
    const runs = Array.from({ length: 15 }, (_, i) =>
      run(i * 4 * 3600 + (i >= 10 ? 1800 : 0), 3600),
    );
    const sessions = groupRunsIntoSessions(runs);
    expect(sessions.flat()).toEqual(runs);
    // The largest gap is always a session boundary
    expect(sessions.some((s) => s[0] === runs[10])).toBe(true);
    for (const session of sessions) {
      const first = session[0];
      const last = session[session.length - 1];
      expect(
        last.epochTimeS + last.durationS - first.epochTimeS,
      ).toBeLessThanOrEqual(24 * 3600);
    }
  });

  it("does not split a single run longer than maxSessionDurationS", () => {
    const a = run(0, 30 * 3600);
    expect(groupRunsIntoSessions([a])).toEqual([[a]]);
  });

  it("does not mutate the input array", () => {
    const input = [run(500, 200), run(0, 200)];
    const copy = [...input];
    groupRunsIntoSessions(input);
    expect(input).toEqual(copy);
  });
});
