"use client";

import type { MapPoint } from "@/components/visualizations/map";
import { LatLngExpression } from "leaflet";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

// Lazy load Map
const MapComponent = dynamic(() => import("./map"), {
  ssr: false,
  loading: () => <LoadingMap />,
});

export const STREAM_ID_SATELLITES = "gpsData.satellites";
export const STREAM_ID_LATITUDE = "gpsData.lat";
export const STREAM_ID_LONGITUDE = "gpsData.lng";
export const STREAM_ID_ALTITUDE = "gpsData.alt";

const MIN_NUM_SATELLITES = 1; // filter out GPS points that were logged with less than X satellites
const MAX_JUMP_METERS = 100; // filter out GPS points that jump more than X meters from the previous point

type DataPoint = {
  streamId: string;
  tick: number;
  data: number;
};

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

// Calculates haversine distance between two points
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

function LoadingMap() {
  return (
    <div className="flex items-center justify-center h-full bg-gray-200">
      <span className="text-gray-500 animate-pulse">Loading...</span>
    </div>
  );
}

function NoData() {
  return (
    <div className="flex items-center justify-center h-full bg-gray-200">
      <span className="text-gray-500">No data</span>
    </div>
  );
}

function toMapPoints(
  dataPoints: DataPoint[],
  epochTimeS: bigint,
  tickBaseUs: bigint,
): MapPoint[] {
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

    const timestampS = Number(epochTimeS) + Number(tickBaseUs) * 1e-6 * tick;
    const position: LatLngExpression =
      alt !== undefined ? [lat, lng, alt] : [lat, lng];

    mapPoints.push({ position, timestampS, numSatellites });
  }

  return mapPoints;
}

export default function GpsVisualization({
  runUuid,
  epochTimeS,
  tickBaseUs,
}: {
  runUuid: string;
  epochTimeS: bigint;
  tickBaseUs: bigint;
}) {
  const [mapPoints, setMapPoints] = useState<MapPoint[] | null>(null);
  // TODO: Be able to toggle filter through UI
  const [filterEnabled, setFilterEnabled] = useState(true);

  useEffect(() => {
    if (!runUuid) {
      return;
    }
    fetch(
      `/api/runs/${runUuid}/streams?stream_ids=${STREAM_ID_SATELLITES},${STREAM_ID_LATITUDE},${STREAM_ID_LONGITUDE},${STREAM_ID_ALTITUDE}`,
    )
      .then((res) => res.json())
      .then((data) => {
        const dataPoints: DataPoint[] = data.map((p: any) => {
          return {
            streamId: p.streamId,
            tick: Number(p.tick),
            data: Number(p.data),
          };
        });
        const mapPoints = toMapPoints(dataPoints, epochTimeS, tickBaseUs);
        mapPoints.sort((a, b) => a.timestampS - b.timestampS);
        setMapPoints(mapPoints);
      });
  }, [runUuid, epochTimeS, tickBaseUs]);

  const filteredPoints: MapPoint[] | null = useMemo(() => {
    if (!filterEnabled || mapPoints === null || mapPoints.length === 0) {
      return mapPoints;
    }

    const result: MapPoint[] = [];
    let lastKept: MapPoint | null = null;
    for (const p of mapPoints) {
      // Filter out GPS points that were logged with less than X satellites
      if (p.numSatellites < MIN_NUM_SATELLITES) {
        continue;
      }

      // Filter out GPS points that jump more than X meters from the previous point
      if (lastKept) {
        const jump = distanceMeters(lastKept.position, p.position);
        if (jump > MAX_JUMP_METERS) {
          continue;
        }
      }

      result.push(p);
      lastKept = p;
    }

    return result;
  }, [mapPoints, filterEnabled]);

  if (filteredPoints === null) {
    return (
      <div className="w-full h-150">
        <LoadingMap />
      </div>
    );
  } else if (filteredPoints.length === 0) {
    return (
      <div className="w-full h-150">
        <NoData />
      </div>
    );
  } else {
    return (
      <div className="w-full h-150 border rounded-md overflow-hidden">
        <MapComponent points={filteredPoints} />
      </div>
    );
  }
}
