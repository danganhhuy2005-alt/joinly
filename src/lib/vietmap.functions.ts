import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const autocompleteSchema = z.object({
  text: z.string().trim().min(2).max(200),
});

const placeSchema = z.object({
  refId: z.string().trim().min(1).max(3000),
});

const reverseSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

type VietMapAutocompleteItem = {
  ref_id: string;
  name: string;
  address: string;
  display: string;
};

type VietMapPlaceResponse = {
  display: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

type VietMapReverseItem = {
  lat: number;
  lng: number;
  ref_id: string;
  name: string;
  address: string;
  display: string;
};

function getServiceKey() {
  const apiKey = process.env.VIETMAP_SERVICE_KEY;

  if (!apiKey) {
    throw new Error("Chưa cấu hình VIETMAP_SERVICE_KEY.");
  }

  return apiKey;
}

// ================================
// AUTOCOMPLETE
// ================================

export const searchVietMapPlaces = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => autocompleteSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = getServiceKey();

    const params = new URLSearchParams({
      apikey: apiKey,
      text: data.text,
      display_type: "5",
    });

    const response = await fetch(
      `https://maps.vietmap.vn/api/autocomplete/v4?${params.toString()}`,
    );

    if (!response.ok) {
      throw new Error(`VietMap Autocomplete lỗi: ${response.status}`);
    }

    const result = (await response.json()) as VietMapAutocompleteItem[];

    return result.map((item) => ({
      refId: item.ref_id,
      name: item.name,
      address: item.address,
      display: item.display,
    }));
  });

// ================================
// PLACE DETAIL
// ================================

export const getVietMapPlace = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => placeSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = getServiceKey();

    const params = new URLSearchParams({
      apikey: apiKey,
      refid: data.refId,
    });

    const response = await fetch(`https://maps.vietmap.vn/api/place/v4?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`VietMap Place lỗi: ${response.status}`);
    }

    const place = (await response.json()) as VietMapPlaceResponse;

    return {
      latitude: place.lat,
      longitude: place.lng,
      address: place.display || place.address || place.name,
    };
  });

// ================================
// REVERSE GEOCODING
// ================================

export const reverseVietMapLocation = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => reverseSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = getServiceKey();

    const params = new URLSearchParams({
      apikey: apiKey,
      lat: String(data.latitude),
      lng: String(data.longitude),
      display_type: "5",
    });

    const response = await fetch(`https://maps.vietmap.vn/api/reverse/v4?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`VietMap Reverse lỗi: ${response.status}`);
    }

    const result = (await response.json()) as VietMapReverseItem[];

    const first = result[0];

    if (!first) {
      return null;
    }

    return {
      latitude: first.lat,
      longitude: first.lng,
      address: first.display || `${first.name} ${first.address}`.trim(),
    };
  });
