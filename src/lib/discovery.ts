import { supabase } from "@/integrations/supabase/client";

/** Public event categories. Keep slugs synchronized with the SQL CHECK. */
export const DISCOVERY_CATEGORIES = [
  { value: "technology", label: "Công nghệ" },
  { value: "education", label: "Giáo dục" },
  { value: "workshop", label: "Workshop" },
  { value: "conference", label: "Hội thảo" },
  { value: "business", label: "Kinh doanh" },
  { value: "arts", label: "Nghệ thuật" },
  { value: "other", label: "Khác" },
] as const;

export type DiscoveryCategory = (typeof DISCOVERY_CATEGORIES)[number]["value"];

export function discoveryCategoryLabel(value: string | null | undefined) {
  return DISCOVERY_CATEGORIES.find((item) => item.value === value)?.label ?? "Sự kiện";
}

export function discoveryCoverUrl(path: string | null | undefined) {
  if (!path) return null;
  // Only bucket-owned relative paths from the database are accepted.
  if (!/^[0-9a-f-]{36}\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/i.test(path)) return null;
  return supabase.storage.from("joinly-discovery-covers").getPublicUrl(path).data.publicUrl;
}
