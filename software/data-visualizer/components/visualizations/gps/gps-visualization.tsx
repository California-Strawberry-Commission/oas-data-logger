"use client";

import type { MapPoint, Track } from "@/components/visualizations/gps/map";
import type {
  SpeedSample,
  SpeedSeries,
} from "@/components/visualizations/gps/speed-chart";
import SpeedChart from "@/components/visualizations/gps/speed-chart";
import { LatLngExpression } from "leaflet";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

// Lazy load Map
const MapComponent = dynamic(() => import("./map"), {
  ssr: false,
  loading: () => <LoadingMap />,
});

type RunMeta = {
  uuid: string;
  epochTimeS: bigint;
  tickBaseUs: bigint;
  streams: Stream[];
  isActive?: boolean;
};

type Stream = {
  streamId: string;
  streamType: string;
  count: number;
};

type DataPoint = {
  streamId: string;
  tick: number;
  data: number;
};

export const STREAM_ID_SATELLITES = "gpsData.satellites";
export const STREAM_ID_LATITUDE = "gpsData.lat";
export const STREAM_ID_LONGITUDE = "gpsData.lng";
export const STREAM_ID_ALTITUDE = "gpsData.alt";
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

function toMapPoints(dataPoints: DataPoint[], tickBaseUs: bigint): MapPoint[] {
  // Split out datapoints into lat, lng, and alt
  const satellitesMap = new Map<number, number>();
  const latMap = new Map<number, number>();
  const lngMap = new Map<number, number>();
  const altMap = new Map<number, number>();
  for (const dp of dataPoints) {
    switch (dp.streamId) {
      case STREAM_ID_SATELLITES:
        satellitesMap.set(dp.tick, dp.data);
        break;
      case STREAM_ID_LATITUDE:
        latMap.set(dp.tick, dp.data);
        break;
      case STREAM_ID_LONGITUDE:
        lngMap.set(dp.tick, dp.data);
        break;
      case STREAM_ID_ALTITUDE:
        altMap.set(dp.tick, dp.data);
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

    const elapsedS = Number(tickBaseUs) * 1e-6 * tick;
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

export default function GpsVisualization({ runUuids }: { runUuids: string[] }) {
  const [metaByRun, setMetaByRun] = useState<
    Record<string, RunMeta | undefined>
  >({});
  const [rawPointsByRun, setRawPointsByRun] = useState<
    Record<string, MapPoint[]>
  >({});
  const [error, setError] = useState<string>("");

  // TODO: Be able to toggle filter through UI
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [selectedElapsedS, setSelectedElapsedS] = useState<number>(0);

  // Dedupe runUuids and filter out empty
  const uuids = useMemo(
    () => Array.from(new Set(runUuids.filter(Boolean))),
    [runUuids],
  );

  // Fetch run metadata for all selected runs
  useEffect(() => {
    let cancelled = false;

    async function loadMeta() {
      if (uuids.length === 0) {
        setMetaByRun({});
        setRawPointsByRun({});
        setError("");
        return;
      }

      setError("");

      const results = await Promise.all(
        uuids.map(async (uuid) => {
          try {
            const res = await fetch(`/api/runs/${uuid}`);
            if (!res.ok) {
              return {
                uuid,
                meta: undefined as RunMeta | undefined,
                ok: false,
              };
            }
            const data = await res.json();
            const meta: RunMeta = {
              uuid: data.uuid,
              epochTimeS: BigInt(data.epochTimeS),
              tickBaseUs: BigInt(data.tickBaseUs),
              streams: data.streams,
              isActive: data.isActive,
            };
            return { uuid, meta, ok: true };
          } catch (e: any) {
            return { uuid, meta: undefined as RunMeta | undefined, ok: false };
          }
        }),
      );

      if (cancelled) {
        return;
      }

      const next: Record<string, RunMeta | undefined> = {};
      let anyFailed = false;
      for (const r of results) {
        if (r.ok && r.meta) {
          next[r.uuid] = r.meta;
        } else {
          anyFailed = true;
        }
      }

      setMetaByRun(next);
      if (anyFailed) {
        setError("Failed to load run(s)");
      }
    }

    loadMeta();
    return () => {
      cancelled = true;
    };
  }, [uuids]);

  // Fetch raw GPS data once meta is available
  useEffect(() => {
    let cancelled = false;

    async function loadGpsData() {
      const metas = uuids
        .map((uuid) => ({ uuid, meta: metaByRun[uuid] }))
        .filter((x): x is { uuid: string; meta: RunMeta } => !!x.meta);
      if (metas.length === 0) {
        setRawPointsByRun({});
        return;
      }

      const results = await Promise.all(
        metas.map(async ({ uuid, meta }) => {
          try {
            const res = await fetch(
              `/api/runs/${uuid}/streams?stream_ids=${STREAM_ID_SATELLITES},${STREAM_ID_LATITUDE},${STREAM_ID_LONGITUDE},${STREAM_ID_ALTITUDE}`,
            );
            if (!res.ok) {
              return {
                uuid,
                points: undefined as MapPoint[] | undefined,
                ok: false,
              };
            }

            const data = await res.json();
            const dataPoints: DataPoint[] = data.map((p: any) => ({
              streamId: p.streamId,
              tick: Number(p.tick),
              data: Number(p.data),
            }));

            const mapPoints = toMapPoints(dataPoints, meta.tickBaseUs);
            mapPoints.sort((a, b) => a.elapsedS - b.elapsedS);

            return { uuid, points: mapPoints, ok: true };
          } catch {
            return {
              uuid,
              points: undefined as MapPoint[] | undefined,
              ok: false,
            };
          }
        }),
      );

      if (cancelled) {
        return;
      }

      const next: Record<string, MapPoint[]> = {};
      for (const r of results) {
        if (r.ok && r.points) {
          next[r.uuid] = r.points;
        }
      }

      setRawPointsByRun(next);
    }

    loadGpsData();
    return () => {
      cancelled = true;
    };
  }, [uuids, metaByRun]);

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
    return uuids
      .map((uuid) => ({
        id: uuid,
        epochTimeS: Number(metaByRun[uuid]?.epochTimeS),
        points: filteredPointsByRun[uuid] ?? [],
      }))
      .filter((t) => t.points.length > 0);
  }, [uuids, filteredPointsByRun]);

  const speedDataByRun = useMemo(() => {
    const result: Record<string, SpeedSample[]> = {};

    for (const [uuid, points] of Object.entries(filteredPointsByRun)) {
      result[uuid] = points && points.length > 0 ? toSpeedSamples(points) : [];
    }

    return result;
  }, [filteredPointsByRun]);

  const speedSeries: SpeedSeries[] = useMemo(() => {
    return uuids
      .map((uuid) => ({
        id: uuid,
        samples: speedDataByRun[uuid] ?? [],
      }))
      .filter((s) => s.samples.length > 0);
  }, [uuids, speedDataByRun]);

  const hasAnyMeta = Object.keys(metaByRun).length > 0;
  const hasAnyRaw = Object.keys(rawPointsByRun).length > 0;
  const hasAnyPoints = tracks.length > 0;

  if (error) {
    return (
      <div className="w-full h-150">
        <ErrorMap msg={error} />
      </div>
    );
  }

  // No runs selected
  if (uuids.length === 0) {
    return (
      <div className="w-full h-150">
        <NoDataMap />
      </div>
    );
  }

  // Still fetching meta and/or raw data
  if (!hasAnyMeta || !hasAnyRaw) {
    return (
      <div className="w-full h-150">
        <LoadingMap />
      </div>
    );
  }

  // Data fetched, but nothing to render
  if (!hasAnyPoints) {
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
