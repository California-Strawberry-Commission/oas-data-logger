"use client";

import { Icon, LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";

const MIN_NUM_SATELLITES = 1; // filter out GPS points that were logged with less than X satellites
const MAX_JUMP_METERS = 100; // filter out GPS points that jump more than X meters from the previous point

export type MapPoint = {
  timestampS: number;
  position: LatLngExpression;
  numSatellites: number;
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

function toLatLng(position: LatLngExpression): { lat: number; lng: number } {
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
function distanceMeters(a: LatLngExpression, b: LatLngExpression): number {
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

export default function Map({ points }: { points: MapPoint[] }) {
  const [filterEnabled, setFilterEnabled] = useState(true);

  const sortedPoints = useMemo(
    // Create a copy of the points array before sorting in place
    () => [...points].sort((a, b) => a.timestampS - b.timestampS),
    [points]
  );

  // Filtered view when toggle is on
  const displayPoints = useMemo(() => {
    if (!filterEnabled) {
      return sortedPoints;
    }

    if (sortedPoints.length === 0) {
      return [];
    }

    const result: MapPoint[] = [];
    let lastKept: MapPoint | null = null;
    for (const p of sortedPoints) {
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
  }, [sortedPoints, filterEnabled]);

  const startTimestampS = displayPoints[0]?.timestampS ?? 0;
  const endTimestampS =
    displayPoints[displayPoints.length - 1]?.timestampS ?? startTimestampS;

  const [currentTimestampS, setCurrentTimestampS] =
    useState<number>(startTimestampS);

  // When the displayPoints set changes, reset scrubber to start
  useEffect(() => {
    if (displayPoints.length > 0) {
      setCurrentTimestampS(displayPoints[0].timestampS);
    }
  }, [displayPoints]);

  // Find the point whose timestamp is closest to currentTimestampS
  const currentPoint = useMemo(() => {
    if (displayPoints.length === 0) {
      return null;
    }

    let closest = displayPoints[0];
    let smallestDiff = Math.abs(
      displayPoints[0].timestampS - currentTimestampS
    );

    for (let i = 1; i < displayPoints.length; i++) {
      const diff = Math.abs(displayPoints[i].timestampS - currentTimestampS);
      if (diff < smallestDiff) {
        smallestDiff = diff;
        closest = displayPoints[i];
      }
    }

    return closest;
  }, [displayPoints, currentTimestampS]);

  // Note: all hooks must be defined before early returns (Rules of Hooks)
  if (displayPoints.length === 0 || !currentPoint) {
    return null;
  }

  const polylinePositions = displayPoints.map((p) => p.position);

  return (
    <div className="flex h-full w-full flex-col">
      <MapContainer
        center={displayPoints[0].position}
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
        <Marker position={displayPoints[0].position} icon={greenIcon}>
          <Popup>
            <div className="max-w-[200px] break-words text-sm">
              {`Start: ${new Date(startTimestampS * 1000).toLocaleString()}`}
            </div>
          </Popup>
        </Marker>

        {/* End marker */}
        <Marker
          position={displayPoints[displayPoints.length - 1].position}
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

      <div className="rounded-md bg-white/80 p-2 text-xs shadow">
        {/* Scrubber */}
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

        {/* Filter toggle */}
        <div className="mt-2 flex items-center justify-center gap-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={filterEnabled}
              onChange={(e) => setFilterEnabled(e.target.checked)}
            />
            Filter outliers
          </label>
        </div>
      </div>
    </div>
  );
}
