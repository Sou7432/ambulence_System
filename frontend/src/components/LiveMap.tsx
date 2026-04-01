import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

/** Fix default marker assets with Vite bundling. */
function useFixLeafletIcons() {
  useEffect(() => {
    delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
      iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
      shadowUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
    });
  }, []);
}

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color?: "red" | "blue" | "teal";
};

type Props = {
  center: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  className?: string;
  onMapClick?: (lat: number, lng: number) => void;
};

export function LiveMap({
  center,
  zoom = 13,
  markers = [],
  className = "",
  onMapClick,
}: Props) {
  useFixLeafletIcons();

  return (
    <div className={`relative z-0 min-h-[220px] w-full overflow-hidden rounded-xl border border-slate-300 dark:border-slate-700 ${className}`}>
      <MapContainer
        center={center}
        zoom={zoom}
        className="h-[280px] w-full"
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Recenter lat={center[0]} lng={center[1]} />
        {markers.map((m) => (
          <Marker key={m.id} position={[m.lat, m.lng]}>
            <Popup>{m.label}</Popup>
          </Marker>
        ))}
        {onMapClick ? <ClickCapture onMapClick={onMapClick} /> : null}
      </MapContainer>
    </div>
  );
}

function ClickCapture({
  onMapClick,
}: {
  onMapClick: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const fn = (e: L.LeafletMouseEvent) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    };
    map.on("click", fn);
    return () => {
      map.off("click", fn);
    };
  }, [map, onMapClick]);
  return null;
}
