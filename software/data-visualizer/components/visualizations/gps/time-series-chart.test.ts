import {
  downsampleMinMaxByTime,
  findClosestSample,
  smoothEma,
  type TimeSeriesSample,
} from "@/components/visualizations/gps/time-series-chart";
import { describe, expect, it } from "vitest";

function makeSample(elapsedS: number, value: number): TimeSeriesSample {
  return { elapsedS, value };
}

describe("findClosestSample", () => {
  it("returns null for empty array", () => {
    expect(findClosestSample([], 5)).toBeNull();
  });

  it("returns null when target is before first sample", () => {
    expect(
      findClosestSample([makeSample(10, 1), makeSample(20, 2)], 5),
    ).toBeNull();
  });

  it("returns null when target is after last sample", () => {
    expect(
      findClosestSample([makeSample(10, 1), makeSample(20, 2)], 25),
    ).toBeNull();
  });

  it("returns the only sample when array has one element and target matches", () => {
    expect(findClosestSample([makeSample(10, 42)], 10)).toEqual(
      makeSample(10, 42),
    );
  });

  it("returns exact match", () => {
    const samples = [makeSample(0, 1), makeSample(10, 2), makeSample(20, 3)];
    expect(findClosestSample(samples, 0)).toEqual(samples[0]);
    expect(findClosestSample(samples, 10)).toEqual(samples[1]);
    expect(findClosestSample(samples, 20)).toEqual(samples[2]);
  });

  it("returns the closer of two surrounding samples", () => {
    const samples = [makeSample(0, 1), makeSample(10, 2), makeSample(20, 3)];
    expect(findClosestSample(samples, 14)).toEqual(samples[1]);
    expect(findClosestSample(samples, 16)).toEqual(samples[2]);
  });

  it("returns the earlier sample when equidistant", () => {
    const samples = [makeSample(0, 1), makeSample(10, 2), makeSample(20, 3)];
    expect(findClosestSample(samples, 15)).toEqual(samples[1]);
  });
});

describe("smoothEma", () => {
  it("returns empty array for empty input", () => {
    expect(smoothEma([])).toHaveLength(0);
  });

  it("returns single sample unchanged", () => {
    expect(smoothEma([makeSample(0, 5)])).toEqual([makeSample(0, 5)]);
  });

  it("output has the same length as input", () => {
    const samples = [
      makeSample(0, 1),
      makeSample(1, 2),
      makeSample(2, 3),
      makeSample(3, 4),
    ];
    expect(smoothEma(samples)).toHaveLength(samples.length);
  });

  it("preserves elapsedS values", () => {
    const samples = [makeSample(0, 1), makeSample(5, 2), makeSample(10, 3)];
    const result = smoothEma(samples, 5);
    expect(result.map((r) => r.elapsedS)).toEqual([0, 5, 10]);
  });

  it("first output value equals first input value", () => {
    const samples = [makeSample(0, 7), makeSample(1, 100)];
    expect(smoothEma(samples, 5)[0].value).toBe(7);
  });

  it("with very large half-life, output changes slowly", () => {
    const samples = [makeSample(0, 0), makeSample(1, 100)];
    const result = smoothEma(samples, 1e9);
    expect(result[1].value).toBeCloseTo(0, 1);
  });

  it("with very small half-life, output tracks input quickly", () => {
    const samples = [makeSample(0, 0), makeSample(1, 100)];
    const result = smoothEma(samples, 1e-9);
    expect(result[1].value).toBeCloseTo(100, 1);
  });

  it("handles two samples at the same timestamp", () => {
    const samples = [makeSample(0, 0), makeSample(0, 50)];
    const result = smoothEma(samples, 5);
    expect(result[1].value).toBeCloseTo(50, 6);
  });

  it("smoothed value lies between previous and current", () => {
    const samples = [makeSample(0, 0), makeSample(1, 100)];
    const result = smoothEma(samples, 5);
    expect(result[1].value).toBeGreaterThan(0);
    expect(result[1].value).toBeLessThan(100);
  });
});

describe("downsampleMinMaxByTime", () => {
  it("returns empty array for empty input", () => {
    expect(downsampleMinMaxByTime([], 10)).toHaveLength(0);
  });

  it("returns input unchanged when length <= maxBuckets * 2", () => {
    const samples = [makeSample(0, 1), makeSample(1, 2), makeSample(2, 3)];
    expect(downsampleMinMaxByTime(samples, 2)).toBe(samples);
  });

  it("returns first element when maxBuckets is 0", () => {
    const samples = [makeSample(0, 1), makeSample(1, 2), makeSample(2, 3)];
    expect(downsampleMinMaxByTime(samples, 0)).toEqual([makeSample(0, 1)]);
  });

  it("always includes the first and last sample", () => {
    const samples = Array.from({ length: 100 }, (_, i) =>
      makeSample(i, Math.random()),
    );
    const result = downsampleMinMaxByTime(samples, 5);
    expect(result[0]).toEqual(samples[0]);
    expect(result[result.length - 1]).toEqual(samples[99]);
  });

  it("output is shorter than input when downsampling is needed", () => {
    const samples = Array.from({ length: 100 }, (_, i) =>
      makeSample(i, Math.random()),
    );
    const result = downsampleMinMaxByTime(samples, 5);
    expect(result.length).toBeLessThan(samples.length);
  });

  it("output is sorted by elapsedS", () => {
    const samples = Array.from({ length: 100 }, (_, i) =>
      makeSample(i, Math.random()),
    );
    const result = downsampleMinMaxByTime(samples, 5);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].elapsedS).toBeGreaterThanOrEqual(result[i - 1].elapsedS);
    }
  });

  it("has no duplicate elapsedS values", () => {
    const samples = Array.from({ length: 100 }, (_, i) =>
      makeSample(i, Math.random()),
    );
    const result = downsampleMinMaxByTime(samples, 5);
    const times = result.map((r) => r.elapsedS);
    expect(new Set(times).size).toBe(times.length);
  });

  it("preserves the min and max values within each bucket", () => {
    const samples = Array.from({ length: 10 }, (_, i) => makeSample(i, 0));
    samples[5].value = 99; // introduce a spike
    const result = downsampleMinMaxByTime(samples, 2);
    const values = result.map((r) => r.value);
    expect(values).toContain(99); // spike is preserved
  });

  it("returns input unchanged when time span is zero", () => {
    const data = [
      makeSample(5, 1),
      makeSample(5, 2),
      makeSample(5, 3),
      makeSample(5, 4),
      makeSample(5, 5),
    ];
    expect(downsampleMinMaxByTime(data, 2)).toBe(data);
  });
});
