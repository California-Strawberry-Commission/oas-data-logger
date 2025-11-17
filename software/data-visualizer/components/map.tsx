"use client";

import { Icon, LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";

export type MapPoint = {
  timestampS: number;
  position: LatLngExpression;
};

const ColorIcon = Icon.extend({
  options: {
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -25],
  },
});

// @ts-expect-error Leaflet typings don't support extending Icon like this, but it works at runtime
const greenIcon = new ColorIcon({
  iconUrl: "/marker-icon-green.png",
});

// @ts-expect-error Leaflet typings don't support extending Icon like this, but it works at runtime
const redIcon = new ColorIcon({
  iconUrl: "/marker-icon-red.png",
});

// @ts-expect-error Leaflet typings don't support extending Icon like this, but it works at runtime
const blueIcon = new ColorIcon({
  iconUrl: "/marker-icon-blue.png",
});

export default function Map({ points }: { points: MapPoint[] }) {
  const sortedPoints = useMemo(
    // Create a copy of the points array before sorting in place
    () => [...points].sort((a, b) => a.timestampS - b.timestampS),
    [points]
  );

  const startTimestampS = sortedPoints[0]?.timestampS ?? 0;
  const endTimestampS =
    sortedPoints[sortedPoints.length - 1]?.timestampS ?? startTimestampS;

  const [currentTimestampS, setCurrentTimestampS] =
    useState<number>(startTimestampS);

  // Find the point whose timestamp is closest to currentTimestampS
  const currentPoint = useMemo(() => {
    if (sortedPoints.length === 0) {
      return null;
    }

    let closest = sortedPoints[0];
    let smallestDiff = Math.abs(sortedPoints[0].timestampS - currentTimestampS);

    for (let i = 1; i < sortedPoints.length; i++) {
      const diff = Math.abs(sortedPoints[i].timestampS - currentTimestampS);
      if (diff < smallestDiff) {
        smallestDiff = diff;
        closest = sortedPoints[i];
      }
    }

    return closest;
  }, [sortedPoints, currentTimestampS]);

  // Note: all hooks must be defined before early returns (Rules of Hooks)
  if (sortedPoints.length === 0 || !currentPoint) {
    return null;
  }

  const polylinePositions = sortedPoints.map((p) => p.position);

  return (
    <div className="flex h-full w-full flex-col">
      <MapContainer
        center={sortedPoints[0].position}
        zoom={18}
        scrollWheelZoom={true}
        touchZoom={true}
        doubleClickZoom={true}
        className="h-full w-full flex-1"
      >
        <TileLayer
          attribution="Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxZoom={22}
        />

        {/* Full track */}
        <Polyline positions={polylinePositions} color="blue" />

        {/* Start marker */}
        <Marker position={sortedPoints[0].position} icon={greenIcon}>
          <Popup>
            <div className="max-w-[200px] break-words text-sm">
              {`Start: ${new Date(startTimestampS * 1000).toLocaleString()}`}
            </div>
          </Popup>
        </Marker>

        {/* End marker */}
        <Marker
          position={sortedPoints[sortedPoints.length - 1].position}
          icon={redIcon}
        >
          <Popup>
            <div className="max-w-[200px] break-words text-sm">
              {`End: ${new Date(endTimestampS * 1000).toLocaleString()}`}
            </div>
          </Popup>
        </Marker>

        {/* Current (scrubbed) marker */}
        <Marker position={currentPoint.position} icon={blueIcon}>
          <Popup>
            <div className="max-w-[220px] break-words text-sm">
              {new Date(currentPoint.timestampS * 1000).toLocaleString()}
            </div>
          </Popup>
        </Marker>
      </MapContainer>

      {/* Scrubber UI */}
      <div className="mt-2 rounded-md bg-white/80 p-2 text-xs shadow">
        <input
          type="range"
          className="w-full"
          min={startTimestampS}
          max={endTimestampS}
          step={1}
          value={currentTimestampS}
          onChange={(e) => setCurrentTimestampS(Number(e.target.value))}
        />
        <div className="mt-1 flex justify-between">
          <span>{new Date(startTimestampS * 1000).toLocaleTimeString()}</span>
          <span className="font-semibold">
            {new Date(currentTimestampS * 1000).toLocaleTimeString()}
          </span>
          <span>{new Date(endTimestampS * 1000).toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  );
}
