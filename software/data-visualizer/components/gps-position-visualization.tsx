"use client";

import { LatLngExpression } from "leaflet";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const MapComponent = dynamic(() => import("./map"), {
  ssr: false,
});

const STREAM_ID_LATITUDE = "pos.lat";
const STREAM_ID_LONGITUDE = "pos.lng";
const STREAM_ID_ALTITUDE = "pos.alt";

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

export function toGpsPoints(dataPoints: DataPoint[]): GpsPoints {
  // Split out datapoints into lat, lng, and alt
  const latMap = new Map<number, number>();
  const lngMap = new Map<number, number>();
  const altMap = new Map<number, number>();
  for (const dp of dataPoints) {
    switch (dp.streamId) {
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
  for (const [tick, lat] of latMap.entries()) {
    const lng = lngMap.get(tick);
    if (lng !== undefined) {
      const alt = altMap.get(tick);
      combined.push({ tick, lat, lng, alt });
    }
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
      `/api/runs/${runUuid}/streams?stream_ids=${STREAM_ID_LATITUDE},${STREAM_ID_LONGITUDE},${STREAM_ID_ALTITUDE}`
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
    <div className="w-[800px] h-[600px]">
      {gpsPoints && (
        <MapComponent
          points={gpsPoints.latLngs}
          startTimestampS={startTimestampS}
          endTimestampS={endTimestampS}
        />
      )}
    </div>
  );
}
