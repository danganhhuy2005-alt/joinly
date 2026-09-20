import { useEffect, useState } from "react";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Check, Calendar, MapPin, Loader2, DoorOpen, Bookmark } from "lucide-react";
import { getParticipantConfirmation } from "@/lib/confirmation.functions";

export const Route = createFileRoute("/join/$id/confirm/$token")({
  head: () => ({ meta: [{ title: "Xác nhận tham gia — Joinly" }] }),
  component: ConfirmationPage,
});

type Confirmation = Awaited<ReturnType<typeof getParticipantConfirmation>>;

function ConfirmationPage() {
  const { id, token } = useParams({ from: "/join/$id/confirm/$token" });
  const fetchConfirmation = useServerFn(getParticipantConfirmation);
  const [data, setData] = useState<Confirmation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const row = await fetchConfirmation({ data: { token } });
        if (row && row.event_id === id) setData(row);
      } catch {
        // ignore
      }
      setLoading(false);
    })();
  }, [id, token, fetchConfirmation]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4 text-center">
        <div>
          <h1 className="font-display text-2xl font-bold">Không tìm thấy xác nhận</h1>
          <p className="mt-2 text-sm text-muted-foreground">Liên kết xác nhận không hợp lệ hoặc đã thay đổi.</p>
        </div>
      </div>
    );
  }

  const date = data.event_starts_at ? new Date(data.event_starts_at) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" strokeWidth={2.5} />
          </span>
          <span className="font-display text-xl font-bold">Joinly</span>
        </div>
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-center font-display text-xl font-bold leading-tight">
            Bạn đã tham gia phòng {data.room_name}
          </h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            Sự kiện: {data.event_name}
          </p>

          <div className="mt-6 rounded-xl border border-border bg-background p-4">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-foreground">
                <DoorOpen className="h-4 w-4 text-primary" />
                <span className="font-medium">Phòng: {data.room_name}</span>
              </div>
              {date && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  {date.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}
                </div>
              )}
              {data.event_location && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  {data.event_location}
                </div>
              )}
            </div>
            {data.event_description && (
              <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
                {data.event_description}
              </p>
            )}
          </div>

          <div className="mt-6 rounded-xl border border-primary/20 bg-primary-soft p-4">
            <div className="flex items-start gap-3">
              <Bookmark className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="text-xs text-foreground">
                <p className="font-medium">Lưu lại trang này</p>
                <p className="mt-1 text-muted-foreground">
                  Đánh dấu (bookmark) hoặc chụp màn hình liên kết hiện tại để xem lại từ bất kỳ thiết bị nào.
                </p>
              </div>
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Người tham gia: {data.full_name} • {data.email}
          </p>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Nếu cần đổi phòng, vui lòng liên hệ ban tổ chức.
          </p>
        </div>
      </div>
    </div>
  );
}
