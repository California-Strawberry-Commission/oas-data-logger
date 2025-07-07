"use client";

import { LatLngExpression } from "leaflet";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

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

type GpsPoints = {
  latLngs: LatLngExpression[];
  minTick: number;
  maxTick: number;
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

export function toGpsPoints(dataPoints: DataPoint[]): GpsPoints {
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

  // Combine lat, lng, and alt based on tick
  const combined: { tick: number; lat: number; lng: number; alt?: number }[] =
    [];
  for (const [tick, satellites] of satellitesMap.entries()) {
    const lat = latMap.get(tick);
    const lng = lngMap.get(tick);
    const alt = altMap.get(tick);

    if (satellites === 0 || lat === undefined || lng === undefined) {
      continue;
    }

    combined.push({ tick, lat, lng, alt });
  }

  // Sort by ascending tick
  combined.sort((a, b) => a.tick - b.tick);

  const latLngs: LatLngExpression[] = combined.map((p) =>
    p.alt !== undefined ? [p.lat, p.lng, p.alt] : [p.lat, p.lng]
  );
  const minTick = combined.length > 0 ? combined[0].tick : 0;
  const maxTick = combined.length > 0 ? combined[combined.length - 1].tick : 0;

  return { latLngs, minTick, maxTick };
}

export default function GpsPositionVisualization({
  runUuid,
  epochTimeS,
  tickBaseUs,
}: {
  runUuid: string;
  epochTimeS?: number;
  tickBaseUs?: number;
}) {
  const [gpsPoints, setGpsPoints] = useState<GpsPoints>();

  useEffect(() => {
    if (!runUuid) {
      return;
    }
    fetch(
      `/api/runs/${runUuid}/streams?stream_ids=${STREAM_ID_SATELLITES},${STREAM_ID_LATITUDE},${STREAM_ID_LONGITUDE},${STREAM_ID_ALTITUDE}`
    )
      .then((res) => res.json())
      .then((data) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dataPoints: DataPoint[] = data.map((p: any) => {
          return {
            streamId: p.streamId,
            tick: Number(p.tick),
            data: Number(p.data),
          };
        });
        setGpsPoints(toGpsPoints(dataPoints));
      });
  }, [runUuid]);

  const startTimestampS =
    epochTimeS && tickBaseUs && gpsPoints
      ? epochTimeS + tickBaseUs * 1e-6 * gpsPoints.minTick
      : undefined;

  const endTimestampS =
    epochTimeS && tickBaseUs && gpsPoints
      ? epochTimeS + tickBaseUs * 1e-6 * gpsPoints.maxTick
      : undefined;

  return (
    <div className="w-full h-[60vh] max-h-[600px] sm:h-[500px] sm:max-w-[800px] mx-auto">
      {!gpsPoints ? (
        <LoadingMap />
      ) : gpsPoints.latLngs.length > 0 ? (
        <MapComponent
          points={gpsPoints.latLngs}
          startTimestampS={startTimestampS}
          endTimestampS={endTimestampS}
        />
      ) : (
        <NoData />
      )}
    </div>
  );
}
