import L from "leaflet";
import "leaflet.heat";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";

export type HeatmapPoint = [number, number, number?]; // [lat, lng, intensity]

export default function HeatmapLayer({
  points,
  radius = 25,
  blur = 15,
  maxZoom = 18,
  maxIntensity = 1.0,
  minOpacity = 0.05,
}: {
  points: HeatmapPoint[];
  radius?: number;
  blur?: number;
  maxZoom?: number;
  maxIntensity?: number;
  minOpacity?: number;
}) {
  const map = useMap();
  const layerRef = useRef<any>(null);

  // Sometimes leaflet.heat will still try to redraw after the layer is no
  // longer associated with a map. So, we patch leaflet.heat so that _redraw
  // no-ops when there is no map.
  const anyL = L as any;
  if (
    anyL.HeatLayer &&
    anyL.HeatLayer.prototype &&
    !anyL.HeatLayer.prototype.__redrawPatched
  ) {
    const origRedraw = anyL.HeatLayer.prototype._redraw;
    anyL.HeatLayer.prototype._redraw = function patchedRedraw() {
      if (!this._map) {
        return;
      }
      return origRedraw.call(this);
    };
    anyL.HeatLayer.prototype.__redrawPatched = true;
  }

  // Create heatmap layer only once when the map is ready, and
  // remove the layer on unmount
  useEffect(() => {
    if (!map) {
      return;
    }

    // leaflet.heat attaches itself to L.heatLayer. Types are missing,
    // so just use `any`.
    const heatLayer = (L as any).heatLayer(points, {
      radius,
      blur,
      maxZoom,
      max: maxIntensity,
      minOpacity,
    });
    heatLayer.addTo(map);
    layerRef.current = heatLayer;

    return () => {
      if (map && heatLayer) {
        map.removeLayer(heatLayer);
      }
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Update points and options when props change
  useEffect(() => {
    if (!layerRef.current) {
      return;
    }

    layerRef.current.setLatLngs(points);
    layerRef.current.setOptions({
      radius,
      blur,
      maxZoom,
      max: maxIntensity,
      minOpacity,
    });
  }, [points, radius, blur, maxZoom, maxIntensity, minOpacity]);

  return null;
}
