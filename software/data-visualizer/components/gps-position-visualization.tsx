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

export function toMapPoints(
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
    let satellites: number | undefined = undefined;
    while (satIdx + 1 < satTicks.length && satTicks[satIdx + 1] <= tick) {
      satIdx++;
    }
    if (satIdx >= 0) {
      const satTick = satTicks[satIdx];
      satellites = satellitesMap.get(satTick);
    }

    // Filter out lat/lng where num satellites is 0
    if (!satellites || satellites === 0) {
      continue;
    }

    const timestampS = Number(epochTimeS) + Number(tickBaseUs) * 1e-6 * tick;
    const position: LatLngExpression =
      alt !== undefined ? [lat, lng, alt] : [lat, lng];

    mapPoints.push({ position, timestampS });
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
