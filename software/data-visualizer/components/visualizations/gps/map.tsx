"use client";

import { Button } from "@/components/ui/button";
import {
  distanceMeters,
  findClosestIndex,
  type MapPoint,
} from "@/components/visualizations/gps/gps-processing";
import { POI_LUCIDE_ICON } from "@/components/visualizations/gps/pois/poi-icon";
import type { Poi, PoiIcon } from "@/lib/api";
import { colorForRssi, formatElapsed } from "@/lib/utils";
import L, { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Pause, Play } from "lucide-react";
import posthog from "posthog-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";

export type Track = {
  id: string;
  epochTimeS: number;
  points: MapPoint[];
  color?: string;
};

type MapLayer = "esri-rgb" | "nimbo-rgb" | "nimbo-ndvi" | "nimbo-nir";

const MAP_LAYERS: Record<
  MapLayer,
  { label: string; url: string; attribution: string; tms?: boolean }
> = {
  "esri-rgb": {
    label: "ESRI RGB",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: '&copy; <a href="https://www.esri.com">Powered by Esri</a>',
  },
  "nimbo-rgb": {
    label: "Nimbo RGB",
    url: "/api/map-tiles/nimbo/5/{z}/{x}/{y}",
    attribution: '&copy; <a href="https://nimbo.earth">Powered by Nimbo</a>',
    tms: true,
  },
  "nimbo-ndvi": {
    label: "NDVI",
    url: "/api/map-tiles/nimbo/3/{z}/{x}/{y}",
    attribution: '&copy; <a href="https://nimbo.earth">Powered by Nimbo</a>',
    tms: true,
  },
  "nimbo-nir": {
    label: "NIR",
    url: "/api/map-tiles/nimbo/2/{z}/{x}/{y}",
    attribution: '&copy; <a href="https://nimbo.earth">Powered by Nimbo</a>',
    tms: true,
  },
};

/**
 * Reduce the number of GPS points by keeping only points that are at least
 * `minDistMeters` apart from the previously kept point. This is intended to
 * be used to improve performance for map rendering.
 *
 * @param points - GPS points in traversal order.
 * @param minDistMeters - Minimum distance required to keep a point.
 * @returns Decimated GPS points.
 */
export function decimateByDistance(
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

/**
 * Pans the map when `center` changes.
 *
 * This is needed because MapContainer's `center` prop is only used for initialization. Note that
 * this component must be rendered as a child of MapContainer in order to access its map context
 * via `useMap`.
 */
function MapCenterController({ center }: { center: LatLngExpression }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center);
  }, [map, center]);
  return null;
}

/**
 * Animate the map to the target coordinates.
 *
 * Note that this component must be rendered as a child of MapContainer in order to access its
 * map context via `useMap`.
 */
function FlyToController({
  target,
}: {
  target: { lat: number; lng: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!target) {
      return;
    }
    map.flyTo([target.lat, target.lng]);
  }, [map, target]);
  return null;
}

/**
 * When enabled, set crosshair cursor and capture the next click as a POI location.
 *
 * Note that this component must be rendered as a child of MapContainer in order to access its
 * map context via `useMap`.
 */
function PoiPlacementController({
  enabled,
  onPlace,
}: {
  enabled: boolean;
  onPlace: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (!enabled) {
      map.getContainer().style.cursor = "";
      return;
    }
    map.getContainer().style.cursor = "crosshair";
    const handler = (e: L.LeafletMouseEvent) => {
      onPlace(e.latlng.lat, e.latlng.lng);
    };
    map.on("click", handler);
    return () => {
      map.off("click", handler);
      map.getContainer().style.cursor = "";
    };
  }, [enabled, map, onPlace]);
  return null;
}

function createPoiDivIcon(icon: PoiIcon, color: string): L.DivIcon {
  const Icon = POI_LUCIDE_ICON[icon] ?? POI_LUCIDE_ICON["pin"];
  const svg = renderToStaticMarkup(
    <Icon size={16} strokeWidth={2} color={color} />,
  );
  return L.divIcon({
    className: "",
    html: `<div style="width:26px;height:26px;background:white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.35)">${svg}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -16],
  });
}

export default function Map({
  tracks,
  playbackDurationS = 10,
  selectedElapsedS, // for controlled use
  onSelectedElapsedChange, // for controlled use
  pois,
  placingPoi,
  onPoiPlaced,
  flyTo,
}: {
  tracks: Track[];
  playbackDurationS?: number;
  selectedElapsedS?: number;
  onSelectedElapsedChange?: (elapsedS: number) => void;
  pois?: Poi[];
  placingPoi?: boolean;
  onPoiPlaced?: (lat: number, lng: number) => void;
  flyTo?: { lat: number; lng: number } | null;
}) {
  const [mapLayer, setMapLayer] = useState<MapLayer>("esri-rgb");
  const [showRssiOverlay, setShowRssiOverlay] = useState(false);
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
          color: track.color,
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
    return renderedTracks.map((track) => ({
      id: track.id,
      positions: track.points.map((point) => point.position),
      color: track.color,
    }));
  }, [renderedTracks]);

  const hasRssiData = useMemo(
    () =>
      renderedTracks.some((track) =>
        track.points.some((p) => p.wifiRssi !== undefined),
      ),
    [renderedTracks],
  );

  // Makes sure showRssiOverlay is reset when we switch to tracks without RSSI data
  useEffect(() => {
    if (!hasRssiData) {
      setShowRssiOverlay(false);
    }
  }, [hasRssiData]);

  const rssiCircles = useMemo(() => {
    if (!showRssiOverlay) {
      return [];
    }
    return renderedTracks.flatMap((track) =>
      track.points
        .filter((p) => p.wifiRssi !== undefined)
        .map((p) => ({
          key: `${track.id}-${p.elapsedS}`,
          position: p.position,
          rssi: p.wifiRssi as number,
          color: colorForRssi(p.wifiRssi as number),
        })),
    );
  }, [renderedTracks, showRssiOverlay]);

  // Per-track current point markers
  const currentPoints = useMemo(() => {
    return renderedTracks
      .map((track) => {
        const idx = findClosestIndex(track.points, currentElapsedS);
        if (idx < 0) {
          return null;
        }

        const point = track.points[idx];
        return point
          ? {
              id: track.id,
              point: point,
              timestampS: track.epochTimeS + point.elapsedS,
              color: track.color,
            }
          : null;
      })
      .filter(
        (
          x,
        ): x is {
          id: string;
          point: MapPoint;
          timestampS: number;
          color: string | undefined;
        } => x !== null,
      );
  }, [renderedTracks, currentElapsedS]);

  if (!center || renderedTracks.length === 0) {
    return null;
  }

  const activeLayer = MAP_LAYERS[mapLayer];

  return (
    <div className="flex h-full w-full flex-col">
      {/* Map + overlay container */}
      <div className="relative h-full w-full flex-1">
        <MapContainer
          preferCanvas={false}
          center={center}
          zoom={15}
          scrollWheelZoom={true}
          touchZoom={true}
          doubleClickZoom={true}
          className="h-full w-full flex-1"
        >
          <MapCenterController center={center} />
          <FlyToController target={flyTo ?? null} />
          <TileLayer
            key={mapLayer}
            attribution={activeLayer.attribution}
            url={activeLayer.url}
            tms={activeLayer.tms}
            minZoom={12}
            maxZoom={18}
          />

          {/* One polyline per run */}
          <Pane name="tracks" style={{ zIndex: 400 }}>
            {polylines.map((polyline) => (
              <Polyline
                key={polyline.id}
                positions={polyline.positions}
                color={polyline.color}
              />
            ))}
          </Pane>

          {/* WiFi RSSI overlay */}
          {showRssiOverlay && (
            <Pane name="rssi-overlay" style={{ zIndex: 500 }}>
              {rssiCircles.map(({ key, position, rssi, color }) => (
                <CircleMarker
                  key={key}
                  center={position}
                  radius={5}
                  color={color}
                  fillColor={color}
                  fillOpacity={0.8}
                  weight={0}
                />
              ))}
            </Pane>
          )}

          {/* POI markers */}
          <Pane name="poi-markers" style={{ zIndex: 550 }}>
            {(pois ?? []).map((poi) => (
              <Marker
                key={poi.id}
                position={[poi.lat, poi.lng]}
                icon={createPoiDivIcon(poi.icon, poi.color)}
              >
                <Popup>
                  <div className="text-sm">
                    <div className="font-semibold">{poi.name}</div>
                    {poi.description && (
                      <div className="mt-1">{poi.description}</div>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </Pane>

          <PoiPlacementController
            enabled={placingPoi ?? false}
            onPlace={onPoiPlaced ?? (() => {})}
          />

          {/* One marker per run at the current elapsed position */}
          <Pane name="markers" style={{ zIndex: 600 }}>
            {currentPoints.map(({ id, point, timestampS, color }) => (
              <CircleMarker
                key={id}
                center={point.position}
                radius={6}
                color="white"
                fillColor={color}
                fillOpacity={1}
                weight={2}
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

        {/* Bottom-left overlays */}
        <div className="absolute bottom-2 left-2 z-1000 flex flex-row items-end gap-2">
          {/* Layer picker */}
          <div className="flex divide-x divide-gray-300 overflow-hidden rounded bg-white/90 text-xs shadow">
            {(
              Object.entries(MAP_LAYERS) as [
                MapLayer,
                (typeof MAP_LAYERS)[MapLayer],
              ][]
            ).map(([id, layer]) => (
              <button
                key={id}
                className={`px-2 py-1.5 font-medium transition-colors ${
                  mapLayer === id
                    ? "bg-gray-800 text-white"
                    : "hover:bg-gray-100"
                }`}
                onClick={() => setMapLayer(id)}
              >
                {layer.label}
              </button>
            ))}
          </div>

          {/* WiFi RSSI toggle + legend */}
          {hasRssiData && (
            <div className="rounded bg-white/90 px-2 py-1.5 text-xs shadow">
              <label className="flex cursor-pointer items-center gap-1.5 font-semibold">
                <input
                  type="checkbox"
                  checked={showRssiOverlay}
                  onChange={(e) => {
                    posthog.capture("visualization:wifi_rssi_overlay_toggled", {
                      action: e.target.checked ? "show" : "hide",
                    });
                    setShowRssiOverlay(e.target.checked);
                  }}
                  className="h-3 w-3"
                />
                WiFi signal strength
              </label>
              {showRssiOverlay && (
                <div className="mt-2">
                  <div
                    className="h-3 w-full rounded"
                    style={{
                      background:
                        "linear-gradient(to right, hsl(0,100%,45%), hsl(60,100%,45%), hsl(120,100%,45%))",
                    }}
                  />
                  <div className="mt-0.5 flex justify-between">
                    <span>Weak</span>
                    <span>Strong</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
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
            variant="secondary"
            size="sm"
            onClick={() => {
              const nextPlaying = !isPlaying;
              posthog.capture("visualization:map_playback_toggled", {
                action: nextPlaying ? "play" : "pause",
              });
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
