import { CalendarClock } from "lucide-react";
export type StartMode = "manual" | "automatic";
export function EventStartModeFields({ value, onChange, disabled = false }: {
  value: StartMode; onChange: (mode: StartMode) => void; disabled?: boolean;
}) {
  return <section className="min-w-0 space-y-3 rounded-xl border border-border p-3 sm:p-4">
    <h3 className="flex items-center gap-2 font-semibold"><CalendarClock className="h-4 w-4 text-primary" /> Bắt đầu sự kiện</h3>
    <label className="flex items-start gap-2 text-sm"><input type="radio" className="mt-1" name="event-start-mode" value="manual"
      checked={value === "manual"} disabled={disabled} onChange={() => onChange("manual")} />
      <span className="min-w-0"><strong>BTC bắt đầu thủ công (mặc định)</strong><span className="block text-xs text-muted-foreground">Nhấn Bắt đầu sự kiện trong trang Quản lý khi sẵn sàng.</span></span></label>
    <label className="flex items-start gap-2 text-sm"><input type="radio" className="mt-1" name="event-start-mode" value="automatic"
      checked={value === "automatic"} disabled={disabled} onChange={() => onChange("automatic")} />
      <span className="min-w-0"><strong>Tự động theo lịch</strong><span className="block text-xs text-muted-foreground">Tự chuyển Đang diễn ra tại ngày & giờ sự kiện đã chọn ở phía trên. Không tự khởi chạy Quiz/Q&A hay đóng đăng ký.</span></span></label>
  </section>;
}
