"use client";

import { Button } from "@/components/ui/button";
import { distanceMeters } from "@/components/visualizations/gps/gps-visualization";
import { colorForRun } from "@/lib/utils";
import { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Pane,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";

export type MapPoint = {
  elapsedS: number;
  position: LatLngExpression;
  numSatellites: number;
};

export type Track = {
  id: string;
  epochTimeS: number;
  points: MapPoint[];
};

function formatElapsed(seconds: number): string {
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
 * Find the index of the point whose elapsedS is closest to targetElapsedS.
 * Uses binary search and assumes the input array is already sorted by
 * `elapsedS` in ascending order.
 *
 * @param points Time-sorted GPS points.
 * @param targetElapsedS Target elapsedS in seconds.
 * @returns Index of the closest point, or -1 if targetElapsedS lies outside of points.
 */
function findClosestIndex(points: MapPoint[], targetElapsedS: number): number {
  if (
    points.length === 0 ||
    targetElapsedS < points[0].elapsedS ||
    targetElapsedS > points[points.length - 1].elapsedS
  ) {
    return -1;
  }

  let lo = 0;
  let hi = points.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].elapsedS < targetElapsedS) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  if (lo === 0) {
    return 0;
  }
  const prev = lo - 1;

  const d0 = Math.abs(points[lo].elapsedS - targetElapsedS);
  const d1 = Math.abs(points[prev].elapsedS - targetElapsedS);
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

export default function Map({
  tracks,
  playbackDurationS = 10,
  selectedElapsedS, // for controlled use
  onSelectedElapsedChange, // for controlled use
}: {
  tracks: Track[];
  playbackDurationS?: number;
  selectedElapsedS?: number;
  onSelectedElapsedChange?: (elapsedS: number) => void;
}) {
  // Decimate points (per-track) to improve performance
  const renderedTracks: Track[] = useMemo(() => {
    return tracks
      .map((track) => {
        const pts = [...(track.points ?? [])].sort(
          (a, b) => a.elapsedS - b.elapsedS,
        );
        const decimated = pts.length > 1000 ? decimateByDistance(pts, 3) : pts;
        return {
          id: track.id,
          epochTimeS: track.epochTimeS,
          points: decimated,
        };
      })
      .filter((t) => t.points.length > 0);
  }, [tracks]);

  // Calculate the max elapsedS across all tracks
  const maxElapsedS = useMemo(() => {
    let max = 0;
    for (const track of renderedTracks) {
      const last = track.points[track.points.length - 1];
      if (last && last.elapsedS > max) {
        max = last.elapsedS;
      }
    }
    return Math.max(0, Math.floor(max));
  }, [renderedTracks]);

  // Current position of the scrubber
  const [uncontrolledElapsedS, setUncontrolledElapsedS] = useState<number>(0);
  const currentElapsedS = selectedElapsedS ?? uncontrolledElapsedS;

  const setCurrentElapsedS = (elapsedS: number) => {
    const clamped = Math.max(0, Math.min(maxElapsedS, Math.round(elapsedS)));
    if (onSelectedElapsedChange) {
      onSelectedElapsedChange(clamped);
    } else {
      setUncontrolledElapsedS(clamped);
    }
  };

  // Reset scrubber when tracks change
  useEffect(() => {
    setCurrentElapsedS(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedTracks, maxElapsedS]);

  // Whether the scrubber playback animation is active
  const [isPlaying, setIsPlaying] = useState(false);
  // Request ID of the requestAnimationFrame call
  const playRafRef = useRef<number | null>(null);
  // Epoch time (ms) of animation start
  const playStartMsRef = useRef<number | null>(null);
  // elapsedS of run data that animation should start at
  const playStartElapsedSRef = useRef<number>(0);

  // Stop playback if range changes mid-play
  useEffect(() => {
    playStartElapsedSRef.current = 0;
    if (isPlaying) {
      setIsPlaying(false);
    }
  }, [maxElapsedS]);

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
    if (maxElapsedS <= 0) {
      setIsPlaying(false);
      return;
    }

    const tick = (nowMs: number) => {
      if (playStartMsRef.current == null) {
        playStartMsRef.current = nowMs;
        playStartElapsedSRef.current = currentElapsedS;
      }

      // Calculate the next animation position
      const remainingS = maxElapsedS - playStartElapsedSRef.current;
      const durationMs =
        (remainingS / Math.max(1, maxElapsedS)) * playbackDurationS * 1000;

      const elapsedMs = nowMs - playStartMsRef.current;
      const t = Math.min(1, elapsedMs / Math.max(1, durationMs));

      const startS = playStartElapsedSRef.current;
      const targetS = startS + t * (maxElapsedS - startS);
      const nextS = Math.min(maxElapsedS, Math.max(0, Math.round(targetS)));

      setCurrentElapsedS(nextS);

      if (t >= 1 || nextS >= maxElapsedS) {
        // We've reached the end of playback
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
  }, [isPlaying, maxElapsedS, playbackDurationS]);

  // Map center is the first point of first track
  const center = renderedTracks[0]?.points[0]?.position;

  // Per-track polylines
  const polylines = useMemo(() => {
    return renderedTracks.map((t) => ({
      id: t.id,
      positions: t.points.map((p) => p.position),
    }));
  }, [renderedTracks]);

  // Per-track current point markers
  const currentPoints = useMemo(() => {
    return renderedTracks
      .map((track) => {
        const idx = findClosestIndex(track.points, currentElapsedS);
        if (idx < 0) {
          return null;
        }

        const p = track.points[idx];
        return p
          ? {
              id: track.id,
              point: p,
              timestampS: track.epochTimeS + p.elapsedS,
            }
          : null;
      })
      .filter(
        (x): x is { id: string; point: MapPoint; timestampS: number } =>
          x !== null,
      );
  }, [renderedTracks, currentElapsedS]);

  if (!center || renderedTracks.length === 0) {
    return null;
  }

  return (
    <div className="flex h-full w-full flex-col">
      {/* Map + overlay container */}
      <div className="relative h-full w-full flex-1">
        <MapContainer
          preferCanvas={false}
          center={center}
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

          {/* One polyline per run */}
          <Pane name="tracks" style={{ zIndex: 400 }}>
            {polylines.map((polyline) => (
              <Polyline
                key={polyline.id}
                positions={polyline.positions}
                color={colorForRun(polyline.id)}
              />
            ))}
          </Pane>

          {/* One marker per run at the current elapsed position */}
          <Pane name="markers" style={{ zIndex: 600 }}>
            {currentPoints.map(({ id, point, timestampS }) => (
              <CircleMarker
                key={id}
                center={point.position}
                radius={6}
                pathOptions={{
                  fillColor: colorForRun(id),
                  fillOpacity: 1,
                  weight: 3,
                  className: "gps-marker gps-pulse",
                }}
              >
                <Popup>
                  <div className="max-w-[220px] break-words text-sm">
                    <div className="font-semibold">Run</div>
                    <div>{id}</div>
                    <div className="mt-2 font-semibold">Time</div>
                    <div>{`${new Date(timestampS * 1000).toLocaleString()}`}</div>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </Pane>
        </MapContainer>
      </div>

      {/* Controls */}
      <div className="bg-white/80 p-2 text-xs">
        {/* Scrubber */}
        <input
          type="range"
          className="w-full"
          min={0}
          max={maxElapsedS}
          step={1}
          value={Math.max(
            0,
            Math.min(maxElapsedS, Math.round(currentElapsedS)),
          )}
          onChange={(e) => {
            // Stop playback when manually scrubbing
            setIsPlaying(false);
            setCurrentElapsedS(Number(e.target.value));
          }}
        />
        <div className="grid grid-cols-3 items-center text-xs">
          <span className="text-left tabular-nums">{formatElapsed(0)}</span>
          <span className="text-center font-semibold tabular-nums">
            {formatElapsed(Math.round(currentElapsedS))}
          </span>
          <span className="text-right tabular-nums">
            {formatElapsed(maxElapsedS)}
          </span>
        </div>

        {/* Scrubber playback button */}
        <div className="m-2 flex items-center justify-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              // If at end, restart from beginning when hitting play
              if (!isPlaying && currentElapsedS >= maxElapsedS) {
                setCurrentElapsedS(0);
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
      </div>
    </div>
  );
}
