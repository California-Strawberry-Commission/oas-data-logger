"use client";

import { Button } from "@/components/ui/button";
import {
  distanceMeters,
  toLatLng,
} from "@/components/visualizations/gps-visualization";
import HeatmapLayer, {
  HeatmapPoint,
} from "@/components/visualizations/heatmap-layer";
import { Icon, LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";

const DWELL_RADIUS_METERS = 10; // consider any points that lie within X meters of another point to be dwelling at the same point

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

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

export default function Map({
  points,
  playbackDurationS = 10,
}: {
  points: MapPoint[];
  playbackDurationS?: number;
}) {
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);

  // Create data for heatmap rendering
  const heatmapPoints: HeatmapPoint[] = useMemo(() => {
    const numPoints = points.length;
    if (numPoints === 0) {
      return [];
    }

    // Calculate time deltas between each point in displayPoints
    const dts: number[] = new Array(numPoints).fill(0);
    for (let i = 0; i < numPoints - 1; i++) {
      const dt = points[i + 1].timestampS - points[i].timestampS;
      dts[i] = Math.max(0, Math.min(dt, 60)); // clamp to avoid outliers ruining the visualization
    }
    // Set the dt of the last point to be the same as the second-to-last point
    if (numPoints > 1) {
      dts[numPoints - 1] = dts[numPoints - 2];
    }

    const maxDt =
      dts.reduce((prev, curr) => (curr > prev ? curr : prev), 0) || 1;

    return points.map((p, idx) => {
      const { lat, lng } = toLatLng(p.position);
      // Set the heatmap weight for each point to be dt normalized to [0, 1]
      const weight = dts[idx] / maxDt;
      return [lat, lng, weight] as HeatmapPoint;
    });
  }, [points]);

  // Calculate min and max dwell times
  const { minDwellS, maxDwellS } = useMemo(() => {
    const numPoints = points.length;
    if (numPoints < 2) {
      return { minDwellS: 0, maxDwellS: 0 };
    }

    // Compute min/max dwell using a sliding anchor. Any points following an anchor point that is
    // less than DWELL_RADIUS_METERS to the anchor point is considered to be dwelling at the
    // anchor point.
    let anchorIdx = 0;
    let dwellS = 0;
    let minDwellS = Infinity;
    let maxDwellS = 0;
    for (let i = 0; i < numPoints - 1; i++) {
      const dt = points[i + 1].timestampS - points[i].timestampS;
      const dist = distanceMeters(
        points[anchorIdx].position,
        points[i + 1].position,
      );
      if (dist <= DWELL_RADIUS_METERS) {
        // We're still dwelling at the anchor point
        dwellS += dt;
      } else {
        // We're no longer dwelling at the anchor point.
        // Update min/max dwell times and update the anchor point.
        minDwellS = Math.min(minDwellS, dwellS);
        maxDwellS = Math.max(maxDwellS, dwellS);
        anchorIdx = i + 1;
        dwellS = 0;
      }
    }

    minDwellS = Math.min(minDwellS, dwellS);
    maxDwellS = Math.max(maxDwellS, dwellS);

    if (minDwellS === Infinity) {
      minDwellS = 0;
    }

    return { minDwellS, maxDwellS };
  }, [points]);

  const startTimestampS = points[0]?.timestampS ?? 0;
  const endTimestampS =
    points[points.length - 1]?.timestampS ?? startTimestampS;

  // Current timestamp of the scrubber
  const [currentTimestampS, setCurrentTimestampS] =
    useState<number>(startTimestampS);

  // When the points change, reset scrubber to start
  useEffect(() => {
    if (points.length > 0) {
      setCurrentTimestampS(points[0].timestampS);
    }
  }, [points]);

  // Find the point whose timestamp is closest to currentTimestampS
  const currentPoint = useMemo(() => {
    if (points.length === 0) {
      return null;
    }

    let closest = points[0];
    let smallestDiff = Math.abs(points[0].timestampS - currentTimestampS);

    for (let i = 1; i < points.length; i++) {
      const diff = Math.abs(points[i].timestampS - currentTimestampS);
      if (diff < smallestDiff) {
        smallestDiff = diff;
        closest = points[i];
      }
    }

    return closest;
  }, [points, currentTimestampS]);

  // Whether the scrubber playback animation is active
  const [isPlaying, setIsPlaying] = useState(false);
  // Request ID of the requestAnimationFrame call
  const playRafRef = useRef<number | null>(null);
  // Epoch time (ms) of animation start
  const playStartMsRef = useRef<number | null>(null);
  // Timestamp (s) of run data that animation should start at
  const playStartTimestampSRef = useRef<number>(startTimestampS);

  // Keep refs in sync when the range changes
  useEffect(() => {
    playStartTimestampSRef.current = startTimestampS;
    if (isPlaying) {
      // If range changed mid-play, stop to avoid jumps
      setIsPlaying(false);
    }
  }, [startTimestampS, endTimestampS]);

  // Scrubber playback animation
  useEffect(() => {
    // If playback is stopped, cancel animation frame and clean up state
    if (!isPlaying) {
      if (playRafRef.current) {
        cancelAnimationFrame(playRafRef.current);
      }
      playRafRef.current = null;
      playStartMsRef.current = null;
      return;
    }

    // Invalid playback timeline
    if (endTimestampS <= startTimestampS) {
      setIsPlaying(false);
      return;
    }

    const tick = (nowMs: number) => {
      if (playStartMsRef.current == null) {
        playStartMsRef.current = nowMs;
        playStartTimestampSRef.current = currentTimestampS;
      }

      const durationMs =
        ((endTimestampS - playStartTimestampSRef.current) /
          (endTimestampS - startTimestampS)) *
        playbackDurationS *
        1000;
      const elapsedMs = nowMs - playStartMsRef.current;
      const t = Math.min(1, elapsedMs / durationMs);

      const startS = playStartTimestampSRef.current;
      const targetS = startS + t * (endTimestampS - startS);
      const nextS = Math.min(
        endTimestampS,
        Math.max(startTimestampS, Math.round(targetS)),
      );
      setCurrentTimestampS(nextS);

      if (t >= 1 || nextS >= endTimestampS) {
        setIsPlaying(false);
        return;
      }

      playRafRef.current = requestAnimationFrame(tick);
    };

    playRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (playRafRef.current) {
        cancelAnimationFrame(playRafRef.current);
      }
      playRafRef.current = null;
      playStartMsRef.current = null;
    };
  }, [isPlaying, startTimestampS, endTimestampS, playbackDurationS]);

  // Note: all hooks must be defined before early returns (Rules of Hooks)
  if (points.length === 0 || !currentPoint) {
    return null;
  }

  const polylinePositions = points.map((p) => p.position);

  return (
    <div className="flex h-full w-full flex-col">
      {/* Map + overlay container */}
      <div className="relative h-full w-full flex-1">
        <MapContainer
          center={points[0].position}
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

          {/* Dwell-time heatmap overlay */}
          {heatmapEnabled && (
            <HeatmapLayer
              points={heatmapPoints}
              radius={10}
              blur={20}
              maxIntensity={1}
            />
          )}

          {/* Full track */}
          <Polyline positions={polylinePositions} color="blue" />

          {/* Start marker */}
          <Marker position={points[0].position} icon={greenIcon}>
            <Popup>
              <div className="max-w-[200px] break-words text-sm">
                {`Start: ${new Date(startTimestampS * 1000).toLocaleString()}`}
              </div>
            </Popup>
          </Marker>

          {/* End marker */}
          <Marker position={points[points.length - 1].position} icon={redIcon}>
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

        {/* Dwell time overlay */}
        {heatmapEnabled && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-[1000] -translate-x-1/2">
            <div className="rounded-md bg-white/80 px-3 py-1 text-xs shadow">
              <span className="font-semibold">Max dwell time:</span>{" "}
              <span className="tabular-nums">{formatDuration(maxDwellS)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Map controls */}
      <div className="bg-white/80 p-2 text-xs">
        {/* Scrubber */}
        <input
          type="range"
          className="w-full"
          min={startTimestampS}
          max={endTimestampS}
          step={1}
          value={currentTimestampS}
          onChange={(e) => {
            // Stop playback when manually scrubbing
            setIsPlaying(false);
            setCurrentTimestampS(Number(e.target.value));
          }}
        />
        <div className="flex justify-between">
          <span>{new Date(startTimestampS * 1000).toLocaleTimeString()}</span>
          <span className="font-semibold">
            {new Date(currentTimestampS * 1000).toLocaleTimeString()}
          </span>
          <span>{new Date(endTimestampS * 1000).toLocaleTimeString()}</span>
        </div>

        {/* Scrubber playback button */}
        <div className="m-2 flex items-center justify-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              // If at end, restart from beginning when hitting play
              if (!isPlaying && currentTimestampS >= endTimestampS) {
                setCurrentTimestampS(startTimestampS);
              }
              setIsPlaying((v) => !v);
            }}
          >
            {isPlaying ? (
              <>
                <Pause className="h-4 w-4" />
                Pause
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Play
              </>
            )}
          </Button>
        </div>

        {/* Heatmap toggle */}
        <div className="mt-2 flex items-center justify-center gap-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={heatmapEnabled}
              onChange={(e) => setHeatmapEnabled(e.target.checked)}
            />
            Show dwell time heatmap
          </label>
        </div>
      </div>
    </div>
  );
}
