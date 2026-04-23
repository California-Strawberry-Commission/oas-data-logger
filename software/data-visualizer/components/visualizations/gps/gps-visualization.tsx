"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { MapPoint, Track } from "@/components/visualizations/gps/map";
import RunSummaryCard from "@/components/visualizations/gps/run-summary-card";
import TimeSeriesChart, {
  formatElapsed,
  type TimeSeries,
  type TimeSeriesSample,
} from "@/components/visualizations/gps/time-series-chart";
import { useRunStreamsMany, type Run, type RunDataSample } from "@/lib/api";
import { LatLngExpression } from "leaflet";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

// Lazy load Map
const MapComponent = dynamic(() => import("./map"), {
  ssr: false,
  loading: () => <LoadingMap />,
});

export type RunWithColor = {
  run: Run;
  color?: string;
};

const STREAM_ID_SATELLITES = "gpsData.satellites";
const STREAM_ID_LATITUDE = "gpsData.lat";
const STREAM_ID_LONGITUDE = "gpsData.lng";
const STREAM_ID_ALTITUDE = "gpsData.alt";
const STREAM_ID_WIFI_RSSI = "wifiRssi";
const MIN_NUM_SATELLITES = 1; // filter out GPS points that were logged with less than X satellites
const MAX_JUMP_METERS = 100; // filter out GPS points that jump more than X meters from the previous point
const MPS_TO_MPH = 2.2369362920544; // meters per second to miles per hour
const MILES_TO_METERS = 1609.344;
const SPEED_OUTLIER_MPH = 100; // consider any speeds above this as outliers

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
 * Calculates the haversine distance between two points.
 *
 * @param a First point.
 * @param b Second point.
 * @returns Haversine distance between a and b.
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

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function toMapPoints(
  dataPoints: RunDataSample[],
  tickBaseUs: number,
): MapPoint[] {
  // Split out datapoints into lat, lng, and alt
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

  // Assume that lat/lng share the same ticks, and satellites data may be sampled
  // at a different rate than for lat/lng.
  // For each lat/lng tick, we want the satellites value from the most recent
  // satellites tick that is less than or equal to the lat/lng tick.
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

    // Get the satellites data for this tick
    while (satIdx + 1 < satTicks.length && satTicks[satIdx + 1] <= tick) {
      satIdx++;
    }
    const numSatellites =
      satIdx >= 0 ? satellitesMap.get(satTicks[satIdx]) : undefined;
    if (!numSatellites) {
      continue;
    }

    // Get the WiFi RSSI data for this tick
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

function toSpeedMphSamples(points: MapPoint[]): TimeSeriesSample[] {
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
    // Ignore outlier speeds
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

  const speedMphSamples: TimeSeriesSample[] = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    speedMphSamples[i] = {
      elapsedS: points[i].elapsedS,
      value: filteredSpeedsMph[i],
    };
  }

  return speedMphSamples;
}

function toDwellMinsSamples(
  points: MapPoint[],
  speeds: TimeSeriesSample[],
): TimeSeriesSample[] {
  if (points.length <= 1) {
    return [];
  }

  // Hysteresis thresholds for stopped/moving
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
        // Entered dwell
        stopped = true;
        dwellS += dt;
      } else {
        // Moving along
        dwellS = 0;
      }
    } else {
      if (speed >= EXIT_STOPPED_MPH) {
        // Exiting dwell
        stopped = false;
        dwellS = 0;
      } else {
        // Still dwelling
        dwellS += dt;
      }
    }

    result[i] = {
      elapsedS: points[i].elapsedS,
      value: dwellS / 60,
    };
  }
  return result;
}

function LoadingMap() {
  return (
    <div className="flex items-center justify-center h-full bg-gray-200">
      <span className="text-gray-500 animate-pulse">Loading...</span>
    </div>
  );
}

function NoDataMap() {
  return (
    <div className="flex items-center justify-center h-full bg-gray-200">
      <span className="text-gray-500">No data</span>
    </div>
  );
}

function ErrorMap({ msg }: { msg: string }) {
  return (
    <div className="flex items-center justify-center h-full bg-gray-200">
      <span className="text-gray-500">Error: {msg}</span>
    </div>
  );
}

export default function GpsVisualization({ runs }: { runs: RunWithColor[] }) {
  // TODO: Be able to toggle filter through UI
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [selectedElapsedS, setSelectedElapsedS] = useState<number | null>(null);

  // Dedupe runs
  const filteredRuns: RunWithColor[] = useMemo(() => {
    const seen = new Set<string>();
    const result: RunWithColor[] = [];
    for (const r of runs) {
      const runUuid = r.run.uuid;
      if (!runUuid) {
        continue;
      }
      if (seen.has(runUuid)) {
        continue;
      }
      seen.add(runUuid);
      result.push(r);
    }
    return result;
  }, [runs]);

  const runUuids: string[] = useMemo(
    () => filteredRuns.map((r) => r.run.uuid),
    [filteredRuns],
  );

  // Fetch each run's GPS streams
  const { anyLoading, firstError, dataByUuid } = useRunStreamsMany(runUuids, [
    STREAM_ID_SATELLITES,
    STREAM_ID_LATITUDE,
    STREAM_ID_LONGITUDE,
    STREAM_ID_ALTITUDE,
    STREAM_ID_WIFI_RSSI,
  ]);

  // Build rawPointsByRun from query results
  const rawPointsByRun = useMemo(() => {
    const result: Record<string, MapPoint[]> = {};

    for (const r of filteredRuns) {
      const run = r.run;
      const data = dataByUuid[run.uuid];
      if (!data) {
        continue;
      }

      const mapPoints = toMapPoints(data, run.tickBaseUs);
      mapPoints.sort((a, b) => a.elapsedS - b.elapsedS);
      result[run.uuid] = mapPoints;
    }
    return result;
  }, [filteredRuns, dataByUuid]);

  // Filter outliers from raw GPS data
  const filteredPointsByRun = useMemo(() => {
    const result: Record<string, MapPoint[]> = {};

    for (const [uuid, points] of Object.entries(rawPointsByRun)) {
      if (!filterEnabled) {
        result[uuid] = points;
        continue;
      }

      let lastKept: MapPoint | null = null;
      const filtered: MapPoint[] = [];
      for (const point of points) {
        if (point.numSatellites < MIN_NUM_SATELLITES) {
          continue;
        }

        if (lastKept) {
          const jump = distanceMeters(lastKept.position, point.position);
          if (jump > MAX_JUMP_METERS) {
            continue;
          }
        }

        filtered.push(point);
        lastKept = point;
      }

      result[uuid] = filtered;
    }

    return result;
  }, [rawPointsByRun, filterEnabled]);

  const tracks: Track[] = useMemo(() => {
    return filteredRuns
      .map((r) => ({
        id: r.run.uuid,
        epochTimeS: r.run.epochTimeS,
        points: filteredPointsByRun[r.run.uuid] ?? [],
        color: r.color,
      }))
      .filter((t) => t.points.length > 0);
  }, [filteredRuns, filteredPointsByRun]);

  const { speedMphSeries, dwellMinsSeries } = useMemo(() => {
    const speedMphSeries: TimeSeries[] = [];
    const dwellMinsSeries: TimeSeries[] = [];

    for (const r of filteredRuns) {
      const points = filteredPointsByRun[r.run.uuid];
      if (!points || points.length === 0) {
        continue;
      }

      const speeds = toSpeedMphSamples(points);
      speedMphSeries.push({
        id: r.run.uuid,
        samples: speeds,
        color: r.color,
      });

      const dwell = toDwellMinsSamples(points, speeds);
      dwellMinsSeries.push({
        id: r.run.uuid,
        samples: dwell,
        color: r.color,
      });
    }

    return { speedMphSeries, dwellMinsSeries };
  }, [filteredRuns, filteredPointsByRun]);

  const runSummaries = useMemo(() => {
    return filteredRuns
      .map((r) => {
        const points = filteredPointsByRun[r.run.uuid];
        if (points == null || points.length === 0) {
          return null;
        }

        let totalDistanceMi = 0;
        for (let i = 1; i < points.length; i++) {
          totalDistanceMi +=
            distanceMeters(points[i - 1].position, points[i].position) /
            MILES_TO_METERS;
        }

        const speedSamples =
          speedMphSeries.find((series) => series.id === r.run.uuid)?.samples ??
          [];
        const speedValues = speedSamples.map((s) => s.value);
        const maxSpeedMph =
          speedValues.length > 0 ? Math.max(...speedValues) : 0;
        const avgSpeedMph =
          speedValues.length > 0
            ? speedValues.reduce((a, b) => a + b, 0) / speedValues.length
            : 0;

        const dwellSamples =
          dwellMinsSeries.find((d) => d.id === r.run.uuid)?.samples ?? [];
        const maxDwellMins =
          dwellSamples.length > 0
            ? Math.max(...dwellSamples.map((d) => d.value))
            : 0;

        return {
          run: r.run,
          color: r.color,
          totalDistanceMi,
          maxSpeedMph,
          avgSpeedMph,
          maxDwellMins,
        };
      })
      .filter((runSummary) => runSummary !== null);
  }, [filteredRuns, filteredPointsByRun, speedMphSeries, dwellMinsSeries]);

  if (firstError) {
    return (
      <div className="w-full h-150">
        <ErrorMap
          msg={
            firstError instanceof Error
              ? firstError.message
              : "Failed to load run(s)"
          }
        />
      </div>
    );
  }

  // No runs selected
  if (filteredRuns.length === 0) {
    return (
      <div className="w-full h-150">
        <NoDataMap />
      </div>
    );
  }

  // Still fetching data
  if (anyLoading) {
    return (
      <div className="w-full h-150">
        <LoadingMap />
      </div>
    );
  }

  // Data fetched, but nothing to render
  if (tracks.length === 0) {
    return (
      <div className="w-full h-150">
        <NoDataMap />
      </div>
    );
  }

  return (
    <>
      {runSummaries.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {runSummaries.map((runSummary) => (
            <RunSummaryCard key={runSummary.run.uuid} summary={runSummary} />
          ))}
        </div>
      )}
      <div className="w-full h-150 border rounded-md overflow-hidden">
        <MapComponent
          tracks={tracks}
          selectedElapsedS={selectedElapsedS ?? 0}
          onSelectedElapsedChange={setSelectedElapsedS}
        />
      </div>
      <Card className="w-full h-60">
        <CardContent className="w-full h-full">
          <TimeSeriesChart
            data={speedMphSeries}
            selectedElapsedS={selectedElapsedS ?? undefined}
            onSelectedElapsedChange={setSelectedElapsedS}
            yAxisLabel="Speed (mph)"
            yAxisLabelOffset={25}
            tooltipValueFormatter={(v) => `${v.toFixed(1)} mph`}
            smooth
            smoothingHalfLifeS={2}
          />
        </CardContent>
      </Card>
      <Card className="w-full h-60">
        <CardContent className="w-full h-full">
          <TimeSeriesChart
            data={dwellMinsSeries}
            selectedElapsedS={selectedElapsedS ?? undefined}
            onSelectedElapsedChange={setSelectedElapsedS}
            yAxisLabel="Dwell time (minutes)"
            yAxisLabelOffset={50}
            tooltipValueFormatter={(v) => `${formatElapsed(v * 60)}`}
          />
        </CardContent>
      </Card>
    </>
  );
}
