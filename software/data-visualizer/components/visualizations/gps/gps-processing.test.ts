import {
  distanceMeters,
  median,
  STREAM_ID_ALTITUDE,
  STREAM_ID_LATITUDE,
  STREAM_ID_LONGITUDE,
  STREAM_ID_SATELLITES,
  STREAM_ID_WIFI_RSSI,
  toDwellMinsSamples,
  toLatLng,
  toMapPoints,
  toSpeedMphSamples,
  findClosestIndex,
  type MapPoint,
} from "@/components/visualizations/gps/gps-processing";
import type { TimeSeriesSample } from "@/components/visualizations/gps/time-series-chart";
import type { RunDataSample } from "@/lib/api";
import { describe, expect, it } from "vitest";

describe("toLatLng", () => {
  it("handles [lat, lng] array form", () => {
    expect(toLatLng([12.3, -123.4])).toEqual({ lat: 12.3, lng: -123.4 });
  });

  it("handles [lat, lng, alt] array form", () => {
    expect(toLatLng([12.3, -123.4, 100])).toEqual({ lat: 12.3, lng: -123.4 });
  });

  it("handles {lat, lng} object form", () => {
    expect(toLatLng({ lat: 12.3, lng: -123.4 })).toEqual({
      lat: 12.3,
      lng: -123.4,
    });
  });

  it("throws on unsupported input", () => {
    expect(() => toLatLng({ alt: 10 } as never)).toThrow();
  });
});

describe("distanceMeters", () => {
  it("returns 0 for identical points", () => {
    expect(distanceMeters([12.3, -123.4], [12.3, -123.4])).toBe(0);
  });

  it("returns correct distance", () => {
    expect(distanceMeters([12.3, -123.4], [12.4, -123.5])).toBeCloseTo(
      15544.45,
      2,
    );
  });

  it("is commutative", () => {
    const a = [12.3, -123.4] as [number, number];
    const b = [13.4, -124.5] as [number, number];
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
  });
});

describe("median", () => {
  it("returns 0 for empty array", () => {
    expect(median([])).toBe(0);
  });

  it("returns the single element", () => {
    expect(median([5])).toBe(5);
  });

  it("returns middle value for odd-length array", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("returns average of two middle values for even-length array", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("does not mutate the input array", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

function makeSample(
  streamId: string,
  tick: number,
  data: number,
): RunDataSample {
  return { streamId, tick, data };
}

describe("toMapPoints", () => {
  it("returns empty array for no input", () => {
    expect(toMapPoints([], 1000)).toHaveLength(0);
  });

  it("skips ticks with missing lat or lng", () => {
    let samples = [
      makeSample(STREAM_ID_SATELLITES, 0, 5),
      makeSample(STREAM_ID_LATITUDE, 1, 12.3),
      // No longitude at tick 1
    ];
    expect(toMapPoints(samples, 1000)).toHaveLength(0);

    samples = [
      makeSample(STREAM_ID_SATELLITES, 0, 5),
      makeSample(STREAM_ID_LATITUDE, 1, 12.3),
      // No longitude at tick 1
      makeSample(STREAM_ID_LATITUDE, 2, 12.3),
      makeSample(STREAM_ID_LONGITUDE, 2, -123.4),
    ];
    expect(toMapPoints(samples, 1000)).toHaveLength(1);
  });

  it("skips ticks with no satellite data", () => {
    const samples = [
      // No satellite sample
      makeSample(STREAM_ID_LATITUDE, 1, 12.3),
      makeSample(STREAM_ID_LONGITUDE, 1, -123.4),
    ];
    expect(toMapPoints(samples, 1000)).toHaveLength(0);
  });

  it("produces a MapPoint with correct elapsed time", () => {
    const tick = 5000;
    const samples = [
      makeSample(STREAM_ID_SATELLITES, 0, 4),
      makeSample(STREAM_ID_LATITUDE, tick, 12.3),
      makeSample(STREAM_ID_LONGITUDE, tick, -123.4),
    ];
    const mapPoints = toMapPoints(samples, 1000); // 1 ms per tick
    expect(mapPoints).toHaveLength(1);
    expect(mapPoints[0].position).toEqual([12.3, -123.4]);
    // elapsedS should be = 5000 * 1000 * 1e-6 = 5 seconds
    expect(mapPoints[0].elapsedS).toBeCloseTo(5, 6);
    expect(mapPoints[0].numSatellites).toBe(4);
    expect(mapPoints[0].wifiRssi).toBeUndefined();
  });

  it("uses most-recent satellite tick and WiFi RSSI at or before lat/lng tick", () => {
    const samples = [
      makeSample(STREAM_ID_SATELLITES, 10, 3),
      makeSample(STREAM_ID_SATELLITES, 30, 7),
      makeSample(STREAM_ID_WIFI_RSSI, 10, -60),
      makeSample(STREAM_ID_WIFI_RSSI, 30, -50),
      makeSample(STREAM_ID_LATITUDE, 20, 12.3),
      makeSample(STREAM_ID_LONGITUDE, 20, -123.4),
    ];
    const mapPoints = toMapPoints(samples, 1000);
    expect(mapPoints).toHaveLength(1);
    expect(mapPoints[0].numSatellites).toBe(3);
    expect(mapPoints[0].wifiRssi).toBe(-60);
  });

  it("includes altitude when present", () => {
    const samples = [
      makeSample(STREAM_ID_SATELLITES, 0, 5),
      makeSample(STREAM_ID_LATITUDE, 1, 12.3),
      makeSample(STREAM_ID_LONGITUDE, 1, -123.4),
      makeSample(STREAM_ID_ALTITUDE, 1, 100),
    ];
    const mapPoints = toMapPoints(samples, 1000);
    expect(mapPoints).toHaveLength(1);
    expect(mapPoints[0].position).toEqual([12.3, -123.4, 100]);
  });
});

function makeMapPoint(elapsedS: number, lat: number, lng: number): MapPoint {
  return { elapsedS, position: [lat, lng], numSatellites: 4 };
}

describe("toSpeedMphSamples", () => {
  it("returns empty array for empty input", () => {
    expect(toSpeedMphSamples([])).toHaveLength(0);
  });

  it("returns single zero-speed sample for single point", () => {
    const mapPoints = [makeMapPoint(0, 12.3, -123.4)];
    const speedSamples = toSpeedMphSamples(mapPoints);
    expect(speedSamples).toHaveLength(1);
    expect(speedSamples[0].value).toBe(0);
  });

  it("returns zero speed for stationary points", () => {
    const mapPoints = [
      makeMapPoint(0, 12.3, -123.4),
      makeMapPoint(1, 12.3, -123.4),
      makeMapPoint(2, 12.3, -123.4),
    ];
    const speedSamples = toSpeedMphSamples(mapPoints);
    expect(speedSamples.every((s) => s.value === 0)).toBe(true);
  });

  it("calculates correct speed", () => {
    const mapPoints = [
      makeMapPoint(0, 12.3, -123.4),
      makeMapPoint(1, 12.3001, -123.4),
    ];
    const speedSamples = toSpeedMphSamples(mapPoints);
    expect(speedSamples[1].value).toBeCloseTo(24.87, 2);
  });

  it("replaces outlier speed with previous value", () => {
    const mapPoints = [
      makeMapPoint(0, 12.3, -123.4),
      makeMapPoint(1, 12.3, -123.4),
      makeMapPoint(2, 13.4, -123.4), // huge jump, outlier
      makeMapPoint(3, 13.4, -123.4),
    ];
    const speedSamples = toSpeedMphSamples(mapPoints);
    // The outlier at index 2 should be replaced by the previous speed (0)
    // After median filter the value should still be low
    expect(speedSamples[2].value).toBeCloseTo(0, 2);
  });

  it("output length matches input length", () => {
    const mapPoints = Array.from({ length: 10 }, (_, i) =>
      makeMapPoint(i, 12.3 + i * 0.00001, -123.4),
    );
    expect(toSpeedMphSamples(mapPoints)).toHaveLength(mapPoints.length);
  });

  it("elapsed times in output match input points", () => {
    const mapPoints = [
      makeMapPoint(0, 12.3, -123.4),
      makeMapPoint(5, 12.3001, -123.4),
    ];
    const samples = toSpeedMphSamples(mapPoints);
    expect(samples[0].elapsedS).toBe(0);
    expect(samples[1].elapsedS).toBe(5);
  });
});

function makeSpeedSample(elapsedS: number, value: number): TimeSeriesSample {
  return { elapsedS, value };
}

describe("toDwellMinsSamples", () => {
  it("returns empty array for empty points", () => {
    expect(toDwellMinsSamples([], [])).toHaveLength(0);
  });

  it("returns empty array for single point", () => {
    expect(
      toDwellMinsSamples(
        [makeMapPoint(0, 12.3, -123.4)],
        [makeSpeedSample(0, 0)],
      ),
    ).toHaveLength(0);
  });

  it("accumulates zero dwell when always moving above exit threshold", () => {
    const mapPoints = [
      makeMapPoint(0, 12.3, -123.4),
      makeMapPoint(1, 12.3, -123.4),
      makeMapPoint(2, 12.3, -123.4),
    ];
    const speeds = [
      makeSpeedSample(0, 5),
      makeSpeedSample(1, 5),
      makeSpeedSample(2, 5),
    ];
    const result = toDwellMinsSamples(mapPoints, speeds);
    expect(result.every((s) => s.value === 0)).toBe(true);
  });

  it("accumulates dwell time when stopped below enter threshold", () => {
    const mapPoints = [
      makeMapPoint(0, 12.3, -123.4),
      makeMapPoint(60, 12.3, -123.4),
    ];
    const speeds = [makeSpeedSample(0, 0.1), makeSpeedSample(60, 0.1)];
    const result = toDwellMinsSamples(mapPoints, speeds);
    expect(result[1].value).toBeCloseTo(1, 5); // 60 sec = 1 min dwell time
  });

  it("resets dwell when speed exceeds exit threshold", () => {
    const mapPoints = [
      makeMapPoint(0, 12.3, -123.4),
      makeMapPoint(60, 12.3, -123.4),
      makeMapPoint(120, 12.3, -123.4),
    ];
    const speeds = [
      makeSpeedSample(0, 0.1), // enter stopped
      makeSpeedSample(60, 0.1), // still stopped, dwell = 60s
      makeSpeedSample(120, 1.0), // exit stopped, dwell resets
    ];
    const result = toDwellMinsSamples(mapPoints, speeds);
    expect(result[1].value).toBeCloseTo(1, 5); // 1 min dwell
    expect(result[2].value).toBe(0); // reset after exiting
  });

  it("applies hysteresis", () => {
    const mapPoints = [
      makeMapPoint(0, 12.3, -123.4),
      makeMapPoint(1, 12.3, -123.4),
      makeMapPoint(2, 12.3, -123.4),
      makeMapPoint(3, 12.3, -123.4),
    ];
    const speeds = [
      makeSpeedSample(0, 5.0), // moving
      makeSpeedSample(1, 0.1), // enter stopped
      makeSpeedSample(2, 0.3), // still stopped (0.3 < exit threshold of 0.5)
      makeSpeedSample(3, 0.4), // still stopped (0.4 < exit threshold of 0.5)
    ];
    const result = toDwellMinsSamples(mapPoints, speeds);
    expect(result[1].value).toBeGreaterThan(0); // dwell started
    expect(result[2].value).toBeGreaterThan(result[1].value); // still accumulating
    expect(result[3].value).toBeGreaterThan(result[2].value); // still accumulating
  });

  it("output elapsed times match input points", () => {
    const pts = [makeMapPoint(0, 12.3, -123.4), makeMapPoint(30, 12.3, -123.4)];
    const speeds = [makeSpeedSample(0, 5), makeSpeedSample(30, 5)];
    const result = toDwellMinsSamples(pts, speeds);
    expect(result[0].elapsedS).toBe(0);
    expect(result[1].elapsedS).toBe(30);
  });
});

describe("findClosestIndex", () => {
  it("returns -1 for empty array", () => {
    expect(findClosestIndex([], 5)).toBe(-1);
  });

  it("returns -1 when target is before first point", () => {
    const mapPoints = [makeMapPoint(10, 0, 0), makeMapPoint(20, 0, 0)];
    expect(findClosestIndex(mapPoints, 5)).toBe(-1);
  });

  it("returns -1 when target is after last point", () => {
    const mapPoints = [makeMapPoint(10, 0, 0), makeMapPoint(20, 0, 0)];
    expect(findClosestIndex(mapPoints, 25)).toBe(-1);
  });

  it("returns correct index for exact matches", () => {
    const mapPoints = [
      makeMapPoint(10, 0, 0),
      makeMapPoint(20, 0, 0),
      makeMapPoint(30, 0, 0),
    ];
    expect(findClosestIndex(mapPoints, 10)).toBe(0);
    expect(findClosestIndex(mapPoints, 20)).toBe(1);
    expect(findClosestIndex(mapPoints, 30)).toBe(2);
  });

  it("returns the closer of two surrounding points", () => {
    const mapPoints = [
      makeMapPoint(10, 0, 0),
      makeMapPoint(20, 0, 0),
      makeMapPoint(30, 0, 0),
    ];
    expect(findClosestIndex(mapPoints, 24)).toBe(1);
    expect(findClosestIndex(mapPoints, 26)).toBe(2);
  });

  it("returns the earlier index when equidistant", () => {
    const mapPoints = [
      makeMapPoint(10, 0, 0),
      makeMapPoint(20, 0, 0),
      makeMapPoint(30, 0, 0),
    ];
    expect(findClosestIndex(mapPoints, 25)).toBe(1);
  });
});
