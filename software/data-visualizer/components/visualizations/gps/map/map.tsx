"use client";

import { Button } from "@/components/ui/button";
import {
  decimateByDistance,
  findClosestIndex,
  type MapPoint,
} from "@/components/visualizations/gps/gps-processing";
import {
  POI_LUCIDE_ICON,
  TRACK_LUCIDE_ICON,
} from "@/components/visualizations/gps/map/map-icons";
import RunMarkerPopup from "@/components/visualizations/gps/map/run-marker-popup";
import type { Poi } from "@/lib/api";
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
  isLive?: boolean;
  icon?: string | null;
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

function createPoiDivIcon(
  iconKey: string,
  color: string,
  size: number = 26,
): L.DivIcon {
  const Icon = POI_LUCIDE_ICON[iconKey] ?? POI_LUCIDE_ICON["pin"];
  const iconSize = Math.round(size * (16 / 26));
  const anchor = size / 2;
  const svg = renderToStaticMarkup(
    <Icon size={iconSize} strokeWidth={2} color={color} />,
  );
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;background:white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.35)">${svg}</div>`,
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
    popupAnchor: [0, -anchor],
  });
}

function createTrackDivIcon(
  iconKey: string | null | undefined,
  color: string,
  size: number = 26,
  pulse: boolean = false,
): L.DivIcon {
  const Icon = iconKey ? TRACK_LUCIDE_ICON[iconKey] : null;
  const iconSize = Math.round(size * (16 / 26));
  const anchor = size / 2;
  const svg = Icon
    ? renderToStaticMarkup(
        <Icon size={iconSize} strokeWidth={2} color="white" />,
      )
    : "";
  const pulseHtml = pulse
    ? `<span class="animate-ping absolute inline-flex rounded-full" style="width:${size}px;height:${size}px;background:white"></span>`
    : "";
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:${size}px;height:${size}px">
        ${pulseHtml}
        <div style="position:relative;width:${size}px;height:${size}px;background:${color};border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.35);border:2px solid white">${svg}</div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
    popupAnchor: [0, -anchor],
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
          isLive: track.isLive,
          icon: track.icon,
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

  // Current position of the scrubber. We allow both uncontrolled (internally managed state)
  // and controlled (passed into this component via props).
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

  // Live-follow mode (always show the latest point of live tracks). Note that live-follow mode
  // overrides scrubber behavior.
  const [liveFollow, setLiveFollow] = useState(false);
  const hasLiveTrack = renderedTracks.some((track) => track.isLive);
  const following = liveFollow && hasLiveTrack;

  // Identifies the current set of selected runs. We use this to ensure that we do not reset the
  // scrubber state if the selected runs don't change (which happens if new data comes in for a
  // live track).
  const trackIdsKey = useMemo(
    () => renderedTracks.map((track) => track.id).join("|"),
    [renderedTracks],
  );

  // Reset scrubber when the selected runs change, and default into live-follow mode whenever any
  // newly-selected run is live.
  useEffect(() => {
    setLiveFollow(hasLiveTrack);
    setCurrentElapsedS(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackIdsKey]);

  // If we are in live-follow mode and all live tracks end, set the scrubber at the final position.
  const prevHasLiveTrackRef = useRef(hasLiveTrack);
  useEffect(() => {
    if (prevHasLiveTrackRef.current && !hasLiveTrack && liveFollow) {
      setCurrentElapsedS(maxElapsedS);
    }
    prevHasLiveTrackRef.current = hasLiveTrack;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLiveTrack, liveFollow, maxElapsedS]);

  // Whether the scrubber playback animation is active
  const [isPlaying, setIsPlaying] = useState(false);
  // Request ID of the requestAnimationFrame call
  const playRafRef = useRef<number | null>(null);
  // Epoch time (ms) of animation start
  const playStartMsRef = useRef<number | null>(null);
  // elapsedS of run data that animation should start at
  const playStartElapsedSRef = useRef<number>(0);

  // Stop playback if the selected runs change mid-play
  useEffect(() => {
    playStartElapsedSRef.current = 0;
    if (isPlaying) {
      setIsPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackIdsKey]);

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

  // Map center is the first point of first track. We memoize by trackIdsKey so it keeps a
  // stable reference across live-data refreshes of the same run selection.
  const center = useMemo(
    () => renderedTracks[0]?.points[0]?.position,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackIdsKey],
  );

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

  // Per-track current point markers.
  // In scrub mode, show the positions associated with the selected time for each track.
  // In live-follow mode, only show the latest points of live tracks.
  const currentPoints = useMemo(() => {
    return renderedTracks
      .filter((track) => !following || track.isLive)
      .map((track) => {
        const point = following
          ? track.points[track.points.length - 1]
          : track.points[findClosestIndex(track.points, currentElapsedS)];
        return point
          ? {
              id: track.id,
              point,
              timestampS: track.epochTimeS + point.elapsedS,
              color: track.color,
              isLive: track.isLive,
              icon: track.icon,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [renderedTracks, currentElapsedS, following]);

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
            {currentPoints.map(
              ({ id, point, timestampS, color, icon, isLive }) => (
                <Marker
                  key={id}
                  position={point.position}
                  icon={createTrackDivIcon(
                    icon,
                    color ?? "#000000",
                    icon ? 26 : 14,
                    isLive,
                  )}
                >
                  <Popup>
                    <RunMarkerPopup
                      runUuid={id}
                      timestampS={timestampS}
                      icon={icon}
                    />
                  </Popup>
                </Marker>
              ),
            )}
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
                onClick={() => {
                  posthog.capture("visualization:map_layer_changed", {
                    layer: id,
                  });
                  setMapLayer(id);
                }}
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
          value={
            following
              ? maxElapsedS
              : Math.max(0, Math.min(maxElapsedS, Math.round(currentElapsedS)))
          }
          onChange={(e) => {
            setIsPlaying(false);
            // Dragging disables live-follow mode and goes into scrub mode
            setLiveFollow(false);
            setCurrentElapsedS(Number(e.target.value));
          }}
        />
        <div className="grid grid-cols-3 items-center text-xs">
          <span className="text-left tabular-nums">{formatElapsed(0)}</span>
          <span className="text-center font-semibold tabular-nums">
            {following ? "LIVE" : formatElapsed(Math.round(currentElapsedS))}
          </span>
          <span className="text-right tabular-nums">
            {formatElapsed(maxElapsedS)}
          </span>
        </div>

        {/* Scrubber playback button + live mode affordances */}
        <div className="m-2 flex items-center justify-center gap-2">
          {following ? (
            <div className="flex items-center gap-1.5 font-semibold text-red-600">
              <span className="h-2 w-2 rounded-full bg-red-600 animate-pulse" />
              LIVE
            </div>
          ) : (
            <>
              {/* Scrubber playback button */}
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
              {/* Live mode button */}
              {hasLiveTrack && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    posthog.capture("visualization:map_go_live_clicked");
                    setIsPlaying(false);
                    setLiveFollow(true);
                  }}
                >
                  <span className="h-2 w-2 rounded-full bg-red-600" />
                  Go live
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
