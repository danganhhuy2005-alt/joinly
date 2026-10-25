import { supabase } from "@/integrations/supabase/client";
import type { DiscoveryFormValue } from "@/components/EventDiscoveryFields";

const BUCKET = "joinly-discovery-covers";
const MAX_UPLOAD = 5 * 1024 * 1024;
const MAX_INPUT = 50 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Keep the Supabase bucket at 5 MB; large originals are resized in-browser. */
async function optimizeCover(original: File): Promise<File> {
  if (!IMAGE_TYPES.includes(original.type) || original.size === 0 || original.size > MAX_INPUT) {
    throw new Error("Ảnh phải là JPG/PNG/WebP, dung lượng gốc tối đa 50 MB.");
  }
  if (original.size <= MAX_UPLOAD) return original;

  const imageURL = URL.createObjectURL(original);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Trình duyệt không đọc được ảnh. Hãy thử xuất thành JPG hoặc PNG."));
      img.src = imageURL;
    });
    const originalWidth = img.naturalWidth;
    const originalHeight = img.naturalHeight;
    if (!originalWidth || !originalHeight) {
      throw new Error("Ảnh bìa không hợp lệ.");
    }

    for (const longestEdge of [1920, 1600, 1280, 1024]) {
      const scale = Math.min(1, longestEdge / Math.max(originalWidth, originalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(originalWidth * scale));
      canvas.height = Math.max(1, Math.round(originalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh.");
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.72, 0.58]) {
        const blob = await new Promise<Blob | null>(resolve =>
          canvas.toBlob(resolve, "image/webp", quality),
        );
        if (blob && blob.type === "image/webp" && blob.size > 0 && blob.size <= MAX_UPLOAD) {
          return new File([blob], "joinly-cover.webp", { type: "image/webp" });
        }
      }
    }
    throw new Error("Không thể tối ưu ảnh dưới 5 MB. Hãy chọn ảnh nhỏ hơn.");
  } finally {
    URL.revokeObjectURL(imageURL);
  }
}

/** Surface Storage errors, not just the generic 'configuration not saved' toast. */
function uploadErrorDetails(error: unknown): Error {
  const value = error as { message?: string; statusCode?: number | string; status?: number | string } | null;
  const status = value?.statusCode ?? value?.status;
  const reason = value?.message ?? "Không xác định";
  const suffix = status ? ` (HTTP ${status})` : "";
  const suggestion = /row.level security|unauthorized|permission|403|401/i.test(String(reason) + suffix)
    ? " Kiểm tra quyền Owner và Storage policy của bucket joinly-discovery-covers."
    : /bucket not found|not found|404/i.test(String(reason) + suffix)
    ? " Bucket joinly-discovery-covers chưa được tạo trên Supabase đúng project."
    : "";
  return new Error(`Tải ảnh bìa thất bại${suffix}: ${reason}.${suggestion}`);
}

export async function saveEventDiscovery(eventId: string, value: DiscoveryFormValue): Promise<string | null> {
  let path = value.removeCover ? null : value.coverPath;
  let uploaded: string | null = null;
  if (value.coverFile) {
    const file = await optimizeCover(value.coverFile);
    const extensions: Record<string, string> = {
      "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    };
    const extension = extensions[file.type];
    if (!extension || file.size === 0 || file.size > MAX_UPLOAD) {
      throw new Error("Ảnh bìa sau xử lý phải là JPG, PNG hoặc WebP, tối đa 5 MB.");
    }
    uploaded = `${eventId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from(BUCKET).upload(uploaded, file, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw uploadErrorDetails(error);
    path = uploaded;
  }

  try {
    const { error } = await supabase.rpc("save_event_discovery_config" as never, {
      p_event_id: eventId,
      p_category: value.category,
      p_cover_path: path,
      p_show_slots: value.showSlots,
      p_enabled: value.enabled,
    } as never);
    if (error) {
      throw new Error(`Không lưu được cấu hình Khám phá: ${error.message} (${error.code ?? "RPC"})`);
    }
    if (value.coverPath && value.coverPath !== path) {
      void supabase.storage.from(BUCKET).remove([value.coverPath]);
    }
    return path;
  } catch (error) {
    if (uploaded) void supabase.storage.from(BUCKET).remove([uploaded]);
    throw error;
  }
}
