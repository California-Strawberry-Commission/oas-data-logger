import type { TimeSeriesSample } from "@/components/visualizations/gps/time-series-chart";
import type { RunDataSample } from "@/lib/api";
import type { LatLngExpression } from "leaflet";

export type MapPoint = {
  elapsedS: number;
  position: LatLngExpression;
  numSatellites: number;
  wifiRssi?: number; // dBm
};

export const STREAM_ID_SATELLITES = "gpsData.satellites";
export const STREAM_ID_LATITUDE = "gpsData.lat";
export const STREAM_ID_LONGITUDE = "gpsData.lng";
export const STREAM_ID_ALTITUDE = "gpsData.alt";
export const STREAM_ID_WIFI_RSSI = "wifiRssi";

export const MIN_NUM_SATELLITES = 1;
export const MAX_JUMP_METERS = 100;
export const MPS_TO_MPH = 2.2369362920544;
export const MILES_TO_METERS = 1609.344;
export const SPEED_OUTLIER_MPH = 100;

/**
 * Normalizes any {@link LatLngExpression} form to a plain `{lat, lng}` object.
 *
 * @param position - A position in array `[lat, lng]`, `[lat, lng, alt]`, or object `{lat, lng}` form.
 * @returns A plain object with `lat` and `lng` properties.
 */
export function toLatLng(position: LatLngExpression): {
  lat: number;
  lng: number;
} {
  if (Array.isArray(position)) {
    const [lat, lng] = position as [number, number];
    return { lat, lng };
  }
  if ("lat" in position && "lng" in position) {
    return { lat: position.lat, lng: position.lng };
  }
  throw new Error("Unsupported LatLngExpression shape");
}

/**
 * Returns the great-circle distance in meters between two points using the Haversine formula.
 *
 * @param a - First point.
 * @param b - Second point.
 * @returns Distance between `a` and `b` in meters.
 */
export function distanceMeters(
  a: LatLngExpression,
  b: LatLngExpression,
): number {
  const { lat: lat1, lng: lng1 } = toLatLng(a);
  const { lat: lat2, lng: lng2 } = toLatLng(b);

  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLatRad = toRad(lat2 - lat1);
  const dLngRad = toRad(lng2 - lng1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);

  const sinDLat = Math.sin(dLatRad / 2);
  const sinDLon = Math.sin(dLngRad / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return R * c;
}

/**
 * Returns the median of `values`, or 0 for an empty array. Does not mutate the input.
 *
 * @param values - Array of numbers to compute the median of.
 * @returns The median value, or `0` if `values` is empty.
 */
export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Merges raw stream samples into an array of {@link MapPoint}s.
 *
 * Latitude, longitude, and altitude samples are assumed to share ticks. Satellite count
 * and WiFi RSSI may be sampled at a different rate; for each lat/lng/alt tick the
 * most-recent value at or before that tick is used.
 *
 * Points where satellite count is 0 are dropped.
 *
 * @param dataPoints - Raw stream samples from all GPS-related streams.
 * @param tickBaseUs - Microseconds per tick, used to convert ticks to elapsed seconds.
 * @returns Time-ordered array of {@link MapPoint}s.
 */
export function toMapPoints(
  dataPoints: RunDataSample[],
  tickBaseUs: number,
): MapPoint[] {
  const satellitesMap = new Map<number, number>();
  const latMap = new Map<number, number>();
  const lngMap = new Map<number, number>();
  const altMap = new Map<number, number>();
  const wifiRssiMap = new Map<number, number>();
  for (const dp of dataPoints) {
    switch (dp.streamId) {
      case STREAM_ID_SATELLITES:
        satellitesMap.set(dp.tick, Number(dp.data));
        break;
      case STREAM_ID_LATITUDE:
        latMap.set(dp.tick, Number(dp.data));
        break;
      case STREAM_ID_LONGITUDE:
        lngMap.set(dp.tick, Number(dp.data));
        break;
      case STREAM_ID_ALTITUDE:
        altMap.set(dp.tick, Number(dp.data));
        break;
      case STREAM_ID_WIFI_RSSI:
        wifiRssiMap.set(dp.tick, Number(dp.data));
        break;
    }
  }

  // Assume lat/lng/alt share ticks; satellites and RSSI may be sampled at different rates.
  // For each lat/lng/alt tick, use the most recent satellite/RSSI value at or before that tick.
  const latTicks = Array.from(latMap.keys()).sort((a, b) => a - b);
  const satTicks = Array.from(satellitesMap.keys()).sort((a, b) => a - b);
  const rssiTicks = Array.from(wifiRssiMap.keys()).sort((a, b) => a - b);

  const mapPoints: MapPoint[] = [];
  let satIdx = -1;
  let rssiIdx = -1;
  for (const tick of latTicks) {
    const lat = latMap.get(tick);
    const lng = lngMap.get(tick);
    const alt = altMap.get(tick);

    // lat/lng are required. alt is optional
    if (lat === undefined || lng === undefined) {
      continue;
    }

    // Find the most recent satellite count at or before `tick`
    while (satIdx + 1 < satTicks.length && satTicks[satIdx + 1] <= tick) {
      satIdx++;
    }
    const numSatellites =
      satIdx >= 0 ? satellitesMap.get(satTicks[satIdx]) : undefined;
    // Ignore current point if numSatellites is undefined or 0
    if (!numSatellites) {
      continue;
    }

    // Find the most recent RSSI value at or before `tick`
    while (rssiIdx + 1 < rssiTicks.length && rssiTicks[rssiIdx + 1] <= tick) {
      rssiIdx++;
    }
    const wifiRssi =
      rssiIdx >= 0 ? wifiRssiMap.get(rssiTicks[rssiIdx]) : undefined;

    const elapsedS = tickBaseUs * 1e-6 * tick;
    const position: LatLngExpression =
      alt !== undefined ? [lat, lng, alt] : [lat, lng];

    mapPoints.push({ position, elapsedS, numSatellites, wifiRssi });
  }

  return mapPoints;
}

/**
 * Derives a speed time-series (mph) from an ordered array of {@link MapPoint}s.
 *
 * Speed is computed from consecutive Haversine distances. Values above
 * {@link SPEED_OUTLIER_MPH} are replaced with the previous sample's speed, and
 * a 3-point median filter is applied to suppress single-sample spikes.
 *
 * @param points - GPS points sorted by `elapsedS` in ascending order.
 * @returns One {@link TimeSeriesSample} per input point, with speed in mph.
 */
export function toSpeedMphSamples(points: MapPoint[]): TimeSeriesSample[] {
  if (points.length === 0) {
    return [];
  }

  const speedsMph: number[] = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].elapsedS - points[i - 1].elapsedS;
    if (!Number.isFinite(dt)) {
      speedsMph[i] = 0;
      continue;
    }

    if (dt <= 0) {
      speedsMph[i] = speedsMph[i - 1];
      continue;
    }

    const distM = distanceMeters(points[i - 1].position, points[i].position);
    const rawSpeed = (distM / dt) * MPS_TO_MPH;
    speedsMph[i] =
      Number.isFinite(rawSpeed) && rawSpeed <= SPEED_OUTLIER_MPH
        ? rawSpeed
        : speedsMph[i - 1];
  }

  // Median filter to suppress single-sample spikes
  const filteredSpeedsMph: number[] = new Array(points.length).fill(0);
  filteredSpeedsMph[0] = speedsMph[0];
  for (let i = 1; i < points.length; i++) {
    const window = [
      speedsMph[Math.max(0, i - 1)],
      speedsMph[i],
      speedsMph[Math.min(points.length - 1, i + 1)],
    ];
    filteredSpeedsMph[i] = median(window);
  }

  return points.map((p, i) => ({
    elapsedS: p.elapsedS,
    value: filteredSpeedsMph[i],
  }));
}

/**
 * Derives a cumulative dwell-time series (minutes) from GPS points and their
 * corresponding speed samples.
 *
 * Uses hysteresis to avoid jitter: the device enters the stopped state when
 * speed falls below a certain speed and exits only when it rises above a
 * certain speed. The returned value at each point is the total seconds spent
 * stopped up to that moment, converted to minutes.
 *
 * @param points - GPS points sorted by `elapsedS` in ascending order.
 * @param speeds - Speed samples produced by {@link toSpeedMphSamples} for the same points.
 * @returns One {@link TimeSeriesSample} per input point, with cumulative dwell time in minutes.
 */
export function toDwellMinsSamples(
  points: MapPoint[],
  speeds: TimeSeriesSample[],
): TimeSeriesSample[] {
  if (points.length <= 1) {
    return [];
  }

  const ENTER_STOPPED_MPH = 0.2;
  const EXIT_STOPPED_MPH = 0.5;

  const result: TimeSeriesSample[] = new Array(points.length);
  result[0] = { elapsedS: points[0].elapsedS, value: 0 };
  let stopped = false;
  let dwellS = 0;

  for (let i = 1; i < points.length; i++) {
    const speed = speeds[i]?.value ?? 0;
    const dt = Math.max(0, points[i].elapsedS - points[i - 1].elapsedS);

    if (!stopped) {
      if (speed <= ENTER_STOPPED_MPH) {
        stopped = true;
        dwellS += dt;
      } else {
        dwellS = 0;
      }
    } else {
      if (speed >= EXIT_STOPPED_MPH) {
        stopped = false;
        dwellS = 0;
      } else {
        dwellS += dt;
      }
    }

    result[i] = { elapsedS: points[i].elapsedS, value: dwellS / 60 };
  }
  return result;
}

/**
 * Find the index of the point whose elapsedS is closest to targetElapsedS.
 * Uses binary search and assumes the input array is already sorted by
 * `elapsedS` in ascending order.
 *
 * @param points - Time-sorted GPS points.
 * @param targetElapsedS - Target elapsedS in seconds.
 * @returns Index of the closest point, or -1 if targetElapsedS lies outside of points.
 */
export function findClosestIndex(
  points: MapPoint[],
  targetElapsedS: number,
): number {
  if (
    points.length === 0 ||
    targetElapsedS < points[0].elapsedS ||
    targetElapsedS > points[points.length - 1].elapsedS
  ) {
    return -1;
  }

  let lo = 0;
  let hi = points.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].elapsedS < targetElapsedS) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  if (lo === 0) {
    return 0;
  }
  const prev = lo - 1;

  const d0 = Math.abs(points[lo].elapsedS - targetElapsedS);
  const d1 = Math.abs(points[prev].elapsedS - targetElapsedS);
  return d1 <= d0 ? prev : lo;
}
