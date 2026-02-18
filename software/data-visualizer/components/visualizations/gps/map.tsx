"use client";

import { Button } from "@/components/ui/button";
import {
  distanceMeters,
  toLatLng,
} from "@/components/visualizations/gps/gps-visualization";
import HeatmapLayer, {
  HeatmapPoint,
} from "@/components/visualizations/gps/heatmap-layer";
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

export type MapPoint = {
  timestampS: number;
  position: LatLngExpression;
  numSatellites: number;
};

const DWELL_RADIUS_METERS = 10; // consider any points that lie within X meters of another point to be dwelling at the same point

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

/**
 * Find the index of the point whose timestamp is closest to a target timestamp.
 * Uses binary search and assumes the input array is already sorted by
 * `timestampS` in ascending order.
 *
 * @param points Time-sorted GPS points.
 * @param timestampS Target timestamp in seconds.
 * @returns Index of the closest point.
 */
function findClosestIndexByTimestamp(
  points: MapPoint[],
  timestampS: number,
): number {
  let lo = 0;
  let hi = points.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].timestampS < timestampS) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  // lo is first index with timestamp >= t
  if (lo === 0) {
    return 0;
  }
  const prev = lo - 1;

  const d0 = Math.abs(points[lo].timestampS - timestampS);
  const d1 = Math.abs(points[prev].timestampS - timestampS);
  return d1 <= d0 ? prev : lo;
}

/**
 * Reduce the number of GPS points by keeping only points that are at least
 * `minDistMeters` apart from the previously kept point. This is intended to
 * be used to improve performance for map rendering.
 *
 * @param points GPS points in traversal order.
 * @param minDistMeters Minimum distance required to keep a point.
 * @returns Decimated GPS points.
 */
function decimateByDistance(
  points: MapPoint[],
  minDistMeters: number = 3,
): MapPoint[] {
  if (points.length === 0) {
    return [];
  }

  const result: MapPoint[] = [points[0]];
  let lastKept = points[0];
  for (let i = 1; i < points.length; i++) {
    if (
      distanceMeters(lastKept.position, points[i].position) >= minDistMeters
    ) {
      result.push(points[i]);
      lastKept = points[i];
    }
  }

  // Always keep the last point
  const lastPoint = points[points.length - 1];
  if (result[result.length - 1] !== lastPoint) {
    result.push(lastPoint);
  }

  return result;
}

function toHeatmapPoints(points: MapPoint[]): HeatmapPoint[] {
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

  const maxDt = dts.reduce((prev, curr) => (curr > prev ? curr : prev), 0) || 1;

  return points.map((p, idx) => {
    const { lat, lng } = toLatLng(p.position);
    // Set the heatmap weight for each point to be dt normalized to [0, 1]
    const weight = dts[idx] / maxDt;
    return [lat, lng, weight] as HeatmapPoint;
  });
}

function calculateDwellMinMax(points: MapPoint[]): {
  minS: number;
  maxS: number;
} {
  const numPoints = points.length;
  if (numPoints < 2) {
    return { minS: 0, maxS: 0 };
  }

  // Compute min/max dwell using a sliding anchor. Any points following an anchor point that is
  // less than DWELL_RADIUS_METERS to the anchor point is considered to be dwelling at the
  // anchor point.
  let anchorIdx = 0;
  let currentDwellS = 0;
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
      currentDwellS += dt;
    } else {
      // We're no longer dwelling at the anchor point.
      // Update min/max dwell times and update the anchor point.
      minDwellS = Math.min(minDwellS, currentDwellS);
      maxDwellS = Math.max(maxDwellS, currentDwellS);
      anchorIdx = i + 1;
      currentDwellS = 0;
    }
  }

  minDwellS = Math.min(minDwellS, currentDwellS);
  maxDwellS = Math.max(maxDwellS, currentDwellS);

  if (minDwellS === Infinity) {
    minDwellS = 0;
  }

  return { minS: minDwellS, maxS: maxDwellS };
}

export default function Map({
  points,
  playbackDurationS = 10,
  selectedTimestampS, // for controlled use
  onSelectedTimestampChange, // for controlled use
}: {
  points: MapPoint[];
  playbackDurationS?: number;
  selectedTimestampS?: number;
  onSelectedTimestampChange?: (timestampS: number) => void;
}) {
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);

  // Decimate points to improve performance
  const renderedPoints = useMemo(() => {
    if (points.length > 1000) {
      return decimateByDistance(points, 3);
    }
    return points;
  }, [points]);

  // Create data for heatmap rendering
  const heatmapPoints: HeatmapPoint[] = useMemo(
    () => toHeatmapPoints(renderedPoints),
    [renderedPoints],
  );

  // Calculate min and max dwell times
  const { minS: minDwellS, maxS: maxDwellS } = useMemo(
    () => calculateDwellMinMax(renderedPoints),
    [renderedPoints],
  );

  const startTimestampS = renderedPoints[0]?.timestampS ?? 0;
  const endTimestampS =
    renderedPoints[renderedPoints.length - 1]?.timestampS ?? startTimestampS;

  // Current timestamp of the scrubber
  const [uncontrolledTimestampS, setUncontrolledTimestampS] =
    useState<number>(startTimestampS);
  const currentTimestampS = selectedTimestampS ?? uncontrolledTimestampS;

  const setCurrentTimestampS = (timestampS: number) => {
    if (onSelectedTimestampChange) {
      onSelectedTimestampChange(timestampS);
    } else {
      setUncontrolledTimestampS(timestampS);
    }
  };

  // When the points change, reset scrubber to start
  useEffect(() => {
    if (renderedPoints.length > 0) {
      setCurrentTimestampS(renderedPoints[0].timestampS);
    }
  }, [renderedPoints]);

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

  // Positions to be drawn as line segments on the map
  const polylinePositions = useMemo(
    () => renderedPoints.map((p) => p.position),
    [renderedPoints],
  );

  // Find the point whose timestamp is closest to currentTimestampS, used to
  // render the current position marker on the map
  const currentPoint = useMemo(() => {
    if (renderedPoints.length === 0) {
      return null;
    }
    const currentPointIdx = findClosestIndexByTimestamp(
      renderedPoints,
      currentTimestampS,
    );
    return currentPointIdx >= 0 ? renderedPoints[currentPointIdx] : null;
  }, [renderedPoints, currentTimestampS]);

  // Note: all hooks must be defined before this early return (Rules of Hooks)
  if (renderedPoints.length === 0 || !currentPoint) {
    return null;
  }

  return (
    <div className="flex h-full w-full flex-col">
      {/* Map + overlay container */}
      <div className="relative h-full w-full flex-1">
        <MapContainer
          preferCanvas={true}
          center={renderedPoints[0].position}
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
          <Marker position={renderedPoints[0].position} icon={greenIcon}>
            <Popup>
              <div className="max-w-[200px] break-words text-sm">
                {`Start: ${new Date(startTimestampS * 1000).toLocaleString()}`}
              </div>
            </Popup>
          </Marker>

          {/* End marker */}
          <Marker
            position={renderedPoints[renderedPoints.length - 1].position}
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
