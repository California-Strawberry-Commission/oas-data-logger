"use client";

import "leaflet/dist/leaflet.css";
import { LatLngExpression, Icon } from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";

const ColorIcon = Icon.extend({
  options: {
    shadowUrl: "/marker-shadow.png",
    iconSize: [25, 41],
    shadowSize: [41, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
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

export default function Map({
  points,
  startTimestampS,
  endTimestampS,
}: {
  points: LatLngExpression[];
  startTimestampS?: number;
  endTimestampS?: number;
}) {
  const center = points[0];
  const startMarkerText = startTimestampS
    ? `Start: ${new Date(startTimestampS * 1000).toLocaleString()}`
    : "Start";
  const endMarkerText = endTimestampS
    ? `End: ${new Date(endTimestampS * 1000).toLocaleString()}`
    : "End";

  return (
    <MapContainer
      center={center}
      zoom={18} // Zoom level increased from 13 to 16
      scrollWheelZoom={true}
      touchZoom={true}
      doubleClickZoom={true}
      className="h-full w-full"
    >
      {/* Switched to a satellite tile layer */}
      <TileLayer
        attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxZoom={22}
      />
      <Polyline positions={points} color="blue" />
      <Marker position={points[0]} icon={greenIcon}>
        <Popup>
          <div className="max-w-[200px] break-words text-sm">
            {startMarkerText}
          </div>
        </Popup>
      </Marker>
      <Marker position={points[points.length - 1]} icon={redIcon}>
        <Popup>
          <div className="max-w-[200px] break-words text-sm">
            {endMarkerText}
          </div>
        </Popup>
      </Marker>
    </MapContainer>
  );
}