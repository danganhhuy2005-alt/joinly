import { useCallback, useEffect, useRef, useState } from "react";

import { Loader2, MapPin, Search } from "lucide-react";

import vietmapgl from "@vietmap/vietmap-gl-js/dist/vietmap-gl";
import "@vietmap/vietmap-gl-js/dist/vietmap-gl.css";

import {
  getVietMapPlace,
  reverseVietMapLocation,
  searchVietMapPlaces,
} from "@/lib/vietmap.functions";

type EventLocationPickerProps = {
  latitude: number | null;
  longitude: number | null;
  address: string;

  onChange: (latitude: number, longitude: number, address?: string) => void;
};

type VietMapSuggestion = {
  refId: string;
  name: string;
  address: string;
  display: string;
};

type VietMapMap = InstanceType<typeof vietmapgl.Map>;

type VietMapMarker = InstanceType<typeof vietmapgl.Marker>;

const DEFAULT_CENTER: [number, number] = [106.700981, 10.776889];

export function EventLocationPicker({
  latitude,
  longitude,
  address,
  onChange,
}: EventLocationPickerProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  const mapRef = useRef<VietMapMap | null>(null);

  const markerRef = useRef<VietMapMarker | null>(null);

  const onChangeRef = useRef(onChange);

  const initialLatitudeRef = useRef(latitude);

  const initialLongitudeRef = useRef(longitude);

  const skipNextSearchRef = useRef(false);

  const searchRequestRef = useRef(0);

  const [searchText, setSearchText] = useState(address);

  const [suggestions, setSuggestions] = useState<VietMapSuggestion[]>([]);

  const [searching, setSearching] = useState(false);

  const [selecting, setSelecting] = useState(false);

  const [error, setError] = useState<string | null>(null);

  onChangeRef.current = onChange;

  // ========================================
  // REVERSE GEOCODE
  // ========================================

  const reverseCoordinates = useCallback(async (lat: number, lng: number) => {
    try {
      const result = await reverseVietMapLocation({
        data: {
          latitude: lat,
          longitude: lng,
        },
      });

      const newAddress = result?.address;

      if (newAddress) {
        skipNextSearchRef.current = true;

        setSearchText(newAddress);
      }

      onChangeRef.current(lat, lng, newAddress);

      setError(null);
    } catch (reverseError) {
      console.error("VietMap reverse error:", reverseError);

      onChangeRef.current(lat, lng);

      setError("Đã chọn vị trí nhưng chưa lấy được địa chỉ.");
    }
  }, []);

  // ========================================
  // TẠO / DI CHUYỂN MARKER
  // ========================================

  const setMarkerPosition = useCallback(
    (lng: number, lat: number) => {
      const map = mapRef.current;

      if (!map) {
        return;
      }

      if (markerRef.current) {
        markerRef.current.setLngLat([lng, lat]);

        return;
      }

      const marker = new vietmapgl.Marker({
        draggable: true,
      })
        .setLngLat([lng, lat])
        .addTo(map);

      marker.on("dragend", () => {
        const position = marker.getLngLat();

        void reverseCoordinates(position.lat, position.lng);
      });

      markerRef.current = marker;
    },
    [reverseCoordinates],
  );

  // ========================================
  // KHỞI TẠO MAP
  // ========================================

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const tileKey = import.meta.env.VITE_VIETMAP_TILE_KEY?.trim();

    if (!tileKey) {
      setError("Chưa cấu hình VITE_VIETMAP_TILE_KEY.");

      return;
    }

    const initialLatitude = initialLatitudeRef.current;

    const initialLongitude = initialLongitudeRef.current;

    const hasLocation = initialLatitude !== null && initialLongitude !== null;

    const center: [number, number] = hasLocation
      ? [initialLongitude, initialLatitude]
      : DEFAULT_CENTER;

    const map = new vietmapgl.Map({
      container: mapContainerRef.current,

      style:
        "https://maps.vietmap.vn/maps/styles/tm/style.json" +
        `?apikey=${encodeURIComponent(tileKey)}`,

      center,

      zoom: hasLocation ? 16 : 5,
    });

    mapRef.current = map;

    if (hasLocation) {
      setMarkerPosition(initialLongitude, initialLatitude);
    }

    const handleMapClick = (event: {
      lngLat: {
        lat: number;
        lng: number;
      };
    }) => {
      const { lat, lng } = event.lngLat;

      setMarkerPosition(lng, lat);

      void reverseCoordinates(lat, lng);
    };

    map.on("click", handleMapClick);

    return () => {
      map.off("click", handleMapClick);

      markerRef.current?.remove();

      markerRef.current = null;

      map.remove();

      mapRef.current = null;
    };
  }, [reverseCoordinates, setMarkerPosition]);

  // ========================================
  // KHI LAT/LNG THAY ĐỔI TỪ BÊN NGOÀI
  // ========================================

  useEffect(() => {
    if (latitude === null || longitude === null || !mapRef.current) {
      return;
    }

    setMarkerPosition(longitude, latitude);
  }, [latitude, longitude, setMarkerPosition]);

  // ========================================
  // ĐỒNG BỘ ADDRESS TỪ FORM
  // ========================================

  useEffect(() => {
    if (!address) {
      return;
    }

    skipNextSearchRef.current = true;

    setSearchText(address);
  }, [address]);

  // ========================================
  // AUTOCOMPLETE
  // ========================================

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;

      return;
    }

    const keyword = searchText.trim();

    if (keyword.length < 2) {
      setSuggestions([]);
      setSearching(false);

      return;
    }

    const requestId = ++searchRequestRef.current;

    const timer = window.setTimeout(async () => {
      try {
        setSearching(true);

        const result = await searchVietMapPlaces({
          data: {
            text: keyword,
          },
        });

        if (requestId !== searchRequestRef.current) {
          return;
        }

        setSuggestions(result);

        setError(null);
      } catch (searchError) {
        console.error("VietMap autocomplete error:", searchError);

        if (requestId === searchRequestRef.current) {
          setSuggestions([]);

          setError("Không tìm được địa điểm từ VietMap.");
        }
      } finally {
        if (requestId === searchRequestRef.current) {
          setSearching(false);
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchText]);

  // ========================================
  // CHỌN ĐỊA ĐIỂM
  // ========================================

  const selectSuggestion = async (suggestion: VietMapSuggestion) => {
    try {
      setSelecting(true);

      setSuggestions([]);

      const place = await getVietMapPlace({
        data: {
          refId: suggestion.refId,
        },
      });

      skipNextSearchRef.current = true;

      setSearchText(place.address);

      setMarkerPosition(place.longitude, place.latitude);

      mapRef.current?.flyTo({
        center: [place.longitude, place.latitude],

        zoom: 17,
      });

      onChangeRef.current(place.latitude, place.longitude, place.address);

      setError(null);
    } catch (placeError) {
      console.error("VietMap place error:", placeError);

      setError("Không thể lấy thông tin địa điểm đã chọn.");
    } finally {
      setSelecting(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* SEARCH */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MapPin className="h-4 w-4 text-primary" />
          Tìm địa điểm
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

          <input
            type="text"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Nhập tên địa điểm hoặc địa chỉ..."
            autoComplete="off"
            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-10 text-sm outline-none focus:ring-2 focus:ring-ring"
          />

          {(searching || selecting) && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}

          {suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.refId}
                  type="button"
                  onClick={() => void selectSuggestion(suggestion)}
                  className="flex w-full gap-3 border-b border-border px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-accent"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />

                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {suggestion.name || suggestion.display}
                    </p>

                    <p className="mt-0.5 text-xs text-muted-foreground">{suggestion.display}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Nhập ít nhất 2 ký tự rồi chọn một địa điểm được VietMap đề xuất.
        </p>
      </div>

      {/* ADDRESS ĐÃ CHỌN */}
      {address && (
        <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground">Địa chỉ đã chọn</p>

          <p className="mt-1 text-sm">{address}</p>
        </div>
      )}

      {/* MAP */}
      <div className="relative overflow-hidden rounded-lg border border-border">
        <div ref={mapContainerRef} className="h-[350px] w-full" />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!error && latitude !== null && longitude !== null && (
        <p className="text-xs text-green-600">
          ✓ Đã xác định vị trí sự kiện. Bạn có thể bấm trên bản đồ hoặc kéo ghim để chỉnh chính xác.
        </p>
      )}
    </div>
  );
}
