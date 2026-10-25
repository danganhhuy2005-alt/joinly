import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { EventRole } from "@/lib/event-role";

type RunState = { status: "upcoming" | "live" | "ended"; mode: "manual" | "automatic";
  scheduled_at: string | null; started_at: string | null; ended_at: string | null; is_active: boolean };
const LABELS: Record<RunState["status"], string> = {
  upcoming: "Sắp diễn ra", live: "Đang diễn ra", ended: "Đã kết thúc",
};
export function EventRunStatusPanel({ eventId, role, readonly = false }: {
  eventId: string; role: EventRole; readonly?: boolean;
}) {
  const [current, setCurrent] = useState<RunState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_event_run_state" as never, { p_event_id: eventId } as never);
    if (!error) {
      setCurrent((data as RunState[] | null)?.[0] ?? null);
      setLoadError(null);
    } else setLoadError("Không thể tải trạng thái. Hãy kiểm tra migration hoặc quyền sự kiện.");
  }, [eventId]);
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => { void reload(); }, 10000);
    return () => window.clearInterval(timer);
  }, [reload]);
  const transition = async (action: "start" | "end") => {
    if (busy) return;
    if (!window.confirm(action === "start" ? "Bắt đầu sự kiện ngay bây giờ?" : "Kết thúc sự kiện? Không thể bắt đầu lại sau khi kết thúc.")) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("transition_event_run" as never,
        { p_event_id: eventId, p_action: action } as never);
      if (error) throw error;
      toast.success(action === "start" ? "Sự kiện đang diễn ra." : "Đã kết thúc sự kiện.");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không cập nhật được trạng thái.");
    } finally { setBusy(false); }
  };
  if (!current) return <div className="rounded-xl border p-4 text-sm text-muted-foreground">{loadError ?? "Đang tải trạng thái sự kiện..."}</div>;
  const canOperate = !readonly && (role === "owner" || role === "co_owner" || role === "manager");
  return <section className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="flex items-center gap-2 font-semibold"><CalendarClock className="h-5 w-5 text-primary"/>Trạng thái sự kiện</h2>
        <p className="mt-1 break-words text-sm text-muted-foreground">{current.mode === "automatic" ? "Tự động theo lịch" : "BTC bắt đầu thủ công"}{current.scheduled_at ? ` · ${new Date(current.scheduled_at).toLocaleString("vi-VN")}` : ""}</p>
      </div><span className={`rounded-full px-3 py-1 text-sm font-semibold ${current.status === "live" ? "bg-green-500/10 text-green-700 dark:text-green-300" : current.status === "ended" ? "bg-muted text-muted-foreground" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{LABELS[current.status]}</span>
    </div>
    {!current.is_active && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Cần kích hoạt hoặc thanh toán sự kiện trước khi bắt đầu.</p>}
    {canOperate && current.is_active && current.status === "upcoming" && <Button className="mt-4 w-full sm:w-auto" onClick={() => void transition("start")} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin"/> : <Play className="h-4 w-4"/>} Bắt đầu sự kiện</Button>}
    {canOperate && current.is_active && current.status === "live" && <Button className="mt-4 w-full sm:w-auto" variant="destructive" onClick={() => void transition("end")} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin"/> : <Square className="h-4 w-4"/>} Kết thúc sự kiện</Button>}
    {current.status === "ended" && <p className="mt-3 text-xs text-muted-foreground">Bạn vẫn có thể xem Dashboard, xuất danh sách và sử dụng Feedback.</p>}
    {current.status === "upcoming" && current.mode === "automatic" && <p className="mt-3 text-xs text-muted-foreground">Trạng thái sẽ tự động đổi khi đến giờ, kể cả khi không mở trang này.</p>}
  </section>;
}
