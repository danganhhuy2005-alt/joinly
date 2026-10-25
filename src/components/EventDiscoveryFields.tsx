import { useEffect, useState } from "react";
import { Compass, ImagePlus } from "lucide-react";
import { DISCOVERY_CATEGORIES, discoveryCoverUrl } from "@/lib/discovery";

export type DiscoveryFormValue = {
  category: string;
  coverPath: string | null;
  coverFile: File | null;
  removeCover: boolean;
  showSlots: boolean;
  enabled: boolean;
};

export const emptyDiscoveryForm: DiscoveryFormValue = {
  category: "other", coverPath: null, coverFile: null,
  removeCover: false, showSlots: false, enabled: false,
};

export function EventDiscoveryFields({ value, onChange, disabled = false, isDraft = false }: {
  value: DiscoveryFormValue;
  onChange: (next: DiscoveryFormValue) => void;
  disabled?: boolean;
  isDraft?: boolean;
}) {
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!value.coverFile) { setLocalPreview(null); return; }
    const objectUrl = URL.createObjectURL(value.coverFile);
    setLocalPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [value.coverFile]);
  const preview = localPreview ?? (!value.removeCover ? discoveryCoverUrl(value.coverPath) : null);
  const patch = (update: Partial<DiscoveryFormValue>) => onChange({ ...value, ...update });
  return (
    <section className="min-w-0 space-y-4 overflow-hidden rounded-xl border border-border p-3 sm:p-4">
      <div>
        <h3 className="flex items-center gap-2 font-semibold"><Compass className="h-4 w-4 text-primary" /> Thông tin Khám phá</h3>
        <p className="mt-1 text-xs text-muted-foreground">Chỉ người tham gia sử dụng trang Khám phá. BTC chuẩn bị ảnh và chủ đề ở đây.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="discovery-topic" className="text-sm font-medium">Chủ đề sự kiện</label>
        <select id="discovery-topic" className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
          value={value.category} disabled={disabled} onChange={(e) => patch({ category: e.target.value })}>
          {DISCOVERY_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        <label htmlFor="discovery-cover" className="text-sm font-medium">Ảnh bìa (JPG/PNG/WebP; ảnh lớn tự tối ưu xuống 5 MB)</label>
        {preview ? <img alt="Xem trước ảnh bìa sự kiện" src={preview} className="h-40 w-full rounded-xl border object-cover" />
          : <div className="flex h-32 items-center justify-center rounded-xl border border-dashed text-muted-foreground"><ImagePlus className="h-8 w-8" /></div>}
        <input id="discovery-cover" type="file" accept="image/jpeg,image/png,image/webp"
          disabled={disabled} className="block w-full min-w-0 max-w-full text-xs sm:text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            if (file && (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size < 1 || file.size > 50 * 1024 * 1024)) {
              e.target.value = "";
              window.alert("Chọn ảnh JPG, PNG hoặc WebP, tối đa 50 MB. Ảnh lớn sẽ được tối ưu khi bấm Lưu.");
              return;
            }
            patch({ coverFile: file, removeCover: false });
          }}/>
        {(value.coverPath || value.coverFile) && <button type="button" disabled={disabled}
          className="text-xs text-destructive hover:underline" onClick={() => patch({ coverFile: null, removeCover: true })}>Gỡ ảnh bìa</button>}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={value.showSlots} disabled={disabled}
          onChange={(e) => patch({ showSlots: e.target.checked })} /> Hiển thị số suất còn lại trên trang Khám phá
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={value.enabled} disabled={disabled}
          onChange={(e) => patch({ enabled: e.target.checked })} />
        <span><strong>Cho phép hiển thị trên Khám phá</strong><span className="mt-1 block text-xs text-muted-foreground">
          Mặc định ẩn. Chỉ sự kiện đã thanh toán/kích hoạt, không phải demo, không bật Allow-list và chưa kết thúc mới được xuất hiện.
        </span></span>
      </label>
      {isDraft && value.enabled && <p className="text-xs text-amber-700 dark:text-amber-300">Sự kiện đang chờ thanh toán: hệ thống lưu lựa chọn này nhưng chưa công khai.</p>}
    </section>
  );
}
