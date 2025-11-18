"use client";

import type { MapPoint } from "@/components/map";
import { LatLngExpression } from "leaflet";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Lazy load Map
const MapComponent = dynamic(() => import("./map"), {
  ssr: false,
  loading: () => <LoadingMap />,
});

const STREAM_ID_SATELLITES = "gpsData.satellites";
const STREAM_ID_LATITUDE = "gpsData.lat";
const STREAM_ID_LONGITUDE = "gpsData.lng";
const STREAM_ID_ALTITUDE = "gpsData.alt";
const MIN_NUM_SATELLITES = 1; // filter out GPS points that were logged with less than X satellites
const MAX_JUMP_METERS = 100; // filter out GPS points that jump more than X meters from the previous point

type DataPoint = {
  streamId: string;
  tick: number;
  data: number;
};

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

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function toMapPoints(
  dataPoints: DataPoint[],
  epochTimeS: bigint,
  tickBaseUs: bigint
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

    // Filter out lat/lng where num satellites is below min threshold
    if (!numSatellites || numSatellites < MIN_NUM_SATELLITES) {
      continue;
    }

    // Filter out lat/lng that jump too far from last accepted point
    if (mapPoints.length > 0) {
      const last = mapPoints[mapPoints.length - 1];
      const [lastLat, lastLng] = last.position as [number, number];
      const jump = haversineMeters(lastLat, lastLng, lat, lng);
      if (jump > MAX_JUMP_METERS) {
        continue;
      }
    }

    const timestampS = Number(epochTimeS) + Number(tickBaseUs) * 1e-6 * tick;
    const position: LatLngExpression =
      alt !== undefined ? [lat, lng, alt] : [lat, lng];

    mapPoints.push({ position, timestampS, numSatellites });
  }

  return mapPoints;
}

export default function GpsPositionVisualization({
  runUuid,
  epochTimeS,
  tickBaseUs,
}: {
  runUuid: string;
  epochTimeS: bigint;
  tickBaseUs: bigint;
}) {
  const [mapPoints, setMapPoints] = useState<MapPoint[]>();

  useEffect(() => {
    if (!runUuid) {
      return;
    }
    fetch(
      `/api/runs/${runUuid}/streams?stream_ids=${STREAM_ID_SATELLITES},${STREAM_ID_LATITUDE},${STREAM_ID_LONGITUDE},${STREAM_ID_ALTITUDE}`
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
        setMapPoints(toMapPoints(dataPoints, epochTimeS, tickBaseUs));
      });
  }, [runUuid, epochTimeS, tickBaseUs]);

  let content = null;
  if (!mapPoints) {
    content = <LoadingMap />;
  } else if (mapPoints.length > 0) {
    content = <MapComponent points={mapPoints} />;
  } else {
    content = <NoData />;
  }

  return (
    <div className="w-full h-[60vh] max-h-[600px] sm:h-[500px] sm:max-w-[800px] mx-auto">
      {content}
    </div>
  );
}
