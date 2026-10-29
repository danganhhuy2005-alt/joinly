import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// The platform tables are introduced by a separate migration, so they aren't in
// the previously generated src/integrations/supabase/types.ts yet.
export const platformDb = supabase as unknown as SupabaseClient;
export const BUG_IMAGE_BUCKET = "joinly-platform-bug-images";

export type PlatformReview = {
  user_id: string;
  website_rating: number;
  ui_rating: number | null;
  performance_rating: number | null;
  features_rating: number | null;
  comment: string;
  created_at: string;
  updated_at: string;
};

export type BugStatus = "new" | "in_progress" | "resolved" | "closed";
export type BugReport = {
  id: string;
  user_id: string;
  title: string;
  area: string;
  description: string;
  steps_to_reproduce: string | null;
  screenshot_path: string | null;
  screenshot_paths: string[] | null;
  status: BugStatus;
  admin_response: string | null;
  created_at: string;
  updated_at: string;
};

// Keep backwards compatibility with reports saved before multi-image support.
export function getBugScreenshotPaths(report: BugReport): string[] {
  const paths = Array.isArray(report.screenshot_paths) ? report.screenshot_paths : [];
  return paths.length ? paths : report.screenshot_path ? [report.screenshot_path] : [];
}

export const BUG_AREAS = [
  { value: "event_creation", label: "Tạo / sửa sự kiện" },
  { value: "event_management", label: "Quản lý sự kiện" },
  { value: "qr", label: "QR / Check-in" },
  { value: "quiz", label: "Live Quiz / Self-paced" },
  { value: "payment", label: "Thanh toán" },
  { value: "dashboard", label: "Dashboard / Thống kê" },
  { value: "other", label: "Khác" },
] as const;

export const BUG_STATUS_LABELS: Record<BugStatus, string> = {
  new: "Đã tiếp nhận",
  in_progress: "Đang xử lý",
  resolved: "Đã sửa",
  closed: "Đã đóng",
};

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data, error } = await platformDb
    .from("joinly_platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.user_id);
}

export async function openBugScreenshot(path: string): Promise<string> {
  // Private bucket: each read is authorized by Storage RLS.
  const { data, error } = await supabase.storage
    .from(BUG_IMAGE_BUCKET)
    .createSignedUrl(path, 90);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Không thể xem ảnh đính kèm.");
  }
  return data.signedUrl;
}
