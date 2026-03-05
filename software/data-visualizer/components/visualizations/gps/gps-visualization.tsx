"use client";

import type { MapPoint, Track } from "@/components/visualizations/gps/map";
import SpeedChart, {
  type SpeedSample,
  type SpeedSeries,
} from "@/components/visualizations/gps/speed-chart";
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

export const STREAM_ID_SATELLITES = "gpsData.satellites";
export const STREAM_ID_LATITUDE = "gpsData.lat";
export const STREAM_ID_LONGITUDE = "gpsData.lng";
export const STREAM_ID_ALTITUDE = "gpsData.alt";
const GPS_STREAM_IDS = [
  STREAM_ID_SATELLITES,
  STREAM_ID_LATITUDE,
  STREAM_ID_LONGITUDE,
  STREAM_ID_ALTITUDE,
];
const MIN_NUM_SATELLITES = 1; // filter out GPS points that were logged with less than X satellites
const MAX_JUMP_METERS = 100; // filter out GPS points that jump more than X meters from the previous point
const MPS_TO_MPH = 2.2369362920544;

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

function toMapPoints(
  dataPoints: RunDataSample[],
  tickBaseUs: number,
): MapPoint[] {
  // Split out datapoints into lat, lng, and alt
  const satellitesMap = new Map<number, number>();
  const latMap = new Map<number, number>();
  const lngMap = new Map<number, number>();
  const altMap = new Map<number, number>();
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
    }
  }

  // Assume that lat/lng share the same ticks, and satellites data may be sampled
  // at a different rate than for lat/lng.
  // For each lat/lng tick, we want the satellites value from the most recent
  // satellites tick that is less than or equal to the lat/lng tick.
  const latTicks = Array.from(latMap.keys()).sort((a, b) => a - b);
  const satTicks = Array.from(satellitesMap.keys()).sort((a, b) => a - b);

  const mapPoints: MapPoint[] = [];
  let satIdx = -1;

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

    const elapsedS = tickBaseUs * 1e-6 * tick;
    const position: LatLngExpression =
      alt !== undefined ? [lat, lng, alt] : [lat, lng];

    mapPoints.push({ position, elapsedS, numSatellites });
  }

  return mapPoints;
}

function toSpeedSamples(points: MapPoint[]): SpeedSample[] {
  if (points.length === 0) {
    return [];
  }

  const out: SpeedSample[] = [{ elapsedS: points[0].elapsedS, speedMph: 0 }];

  for (let i = 1; i < points.length; i++) {
    const dt = points[i].elapsedS - points[i - 1].elapsedS;
    if (!Number.isFinite(dt) || dt <= 0) {
      out.push({ elapsedS: points[i].elapsedS, speedMph: 0 });
      continue;
    }
    const distM = distanceMeters(points[i - 1].position, points[i].position);
    const mph = (distM / dt) * MPS_TO_MPH;
    out.push({
      elapsedS: points[i].elapsedS,
      speedMph: Number.isFinite(mph) ? mph : 0,
    });
  }
  return out;
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
  const [selectedElapsedS, setSelectedElapsedS] = useState<number>(0);

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
  const { anyLoading, firstError, dataByUuid } = useRunStreamsMany(
    runUuids,
    GPS_STREAM_IDS,
  );

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

  const speedSeries: SpeedSeries[] = useMemo(() => {
    return filteredRuns
      .map((r) => {
        const points = filteredPointsByRun[r.run.uuid];
        return {
          id: r.run.uuid,
          samples: points ? toSpeedSamples(points) : [],
          color: r.color,
        };
      })
      .filter((s) => s.samples.length > 0);
  }, [filteredRuns, filteredPointsByRun]);

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
      <div className="w-full h-150 border rounded-md overflow-hidden">
        <MapComponent
          tracks={tracks}
          selectedElapsedS={selectedElapsedS}
          onSelectedElapsedChange={setSelectedElapsedS}
        />
      </div>
      <div className="w-full h-60 p-4 border rounded-md overflow-hidden">
        <SpeedChart
          data={speedSeries}
          selectedElapsedS={selectedElapsedS}
          onSelectedElapsedChange={setSelectedElapsedS}
        />
      </div>
    </>
  );
}
