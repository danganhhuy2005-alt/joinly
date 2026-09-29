import { useEffect, useRef } from "react";
import type { Map as LeafletMap, CircleMarker } from "leaflet";

import "leaflet/dist/leaflet.css";

type EventLocationPickerProps = {
  latitude: number | null;
  longitude: number | null;
  onChange: (latitude: number, longitude: number) => void;
};

export function EventLocationPicker({ latitude, longitude, onChange }: EventLocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<CircleMarker | null>(null);

  useEffect(() => {
    let cancelled = false;

    const initMap = async () => {
      const L = await import("leaflet");

      if (cancelled || !containerRef.current || mapRef.current) {
        return;
      }

      const hasLocation = latitude !== null && longitude !== null;

      const startPosition: [number, number] = hasLocation
        ? [latitude, longitude]
        : [16.047079, 108.20623];

      const map = L.map(containerRef.current).setView(startPosition, hasLocation ? 16 : 6);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      if (hasLocation) {
        markerRef.current = L.circleMarker(startPosition, {
          radius: 9,
        }).addTo(map);
      }

      map.on("click", (event) => {
        const { lat, lng } = event.latlng;

        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          markerRef.current = L.circleMarker([lat, lng], {
            radius: 9,
          }).addTo(map);
        }

        onChange(lat, lng);
      });

      mapRef.current = map;

      setTimeout(() => {
        map.invalidateSize();
      }, 0);
    };

    initMap();

    return () => {
      cancelled = true;

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="h-[350px] w-full overflow-hidden rounded-lg border" />

      <p className="text-xs text-muted-foreground">
        Nhấn vào bản đồ để chọn chính xác vị trí tổ chức sự kiện.
      </p>

      {latitude !== null && longitude !== null && (
        <p className="text-xs text-green-600">✓ Đã chọn vị trí sự kiện</p>
      )}
    </div>
  );
}
