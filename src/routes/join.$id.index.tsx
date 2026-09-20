import { useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { Sparkles, Calendar, MapPin, Loader2, DoorOpen, ArrowRight, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getJoined, type JoinedInfo } from "@/lib/joined-events";

export const Route = createFileRoute("/join/$id/")({
  head: () => ({ meta: [{ title: "Thông tin sự kiện — Joinly" }] }),
  component: JoinPickRoom,
});

type EventRow = { id: string; name: string; description: string | null; location: string | null; starts_at: string | null };
type Room = { id: string; name: string };

function JoinPickRoom() {
  const { id } = useParams({ from: "/join/$id/" });
  const [event, setEvent] = useState<EventRow | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [joined, setJoinedState] = useState<JoinedInfo | null>(null);

  useEffect(() => {
    setJoinedState(getJoined(id));
    (async () => {
      const [{ data: ev }, { data: rms }] = await Promise.all([
        supabase.from("events").select("id, name, description, location, starts_at").eq("id", id).maybeSingle(),
        (supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> })
          .from("event_rooms_public")
          .select("id, name")
          .eq("event_id", id)
          .order("position"),
      ]);
      setEvent(ev as EventRow | null);
      setRooms((rms as Room[]) ?? []);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!event) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4 text-center">
        <div>
          <h1 className="font-display text-2xl font-bold">Không tìm thấy sự kiện</h1>
          <p className="mt-2 text-sm text-muted-foreground">Liên kết có thể đã hết hạn.</p>
        </div>
      </div>
    );
  }

  // If the stored room no longer belongs to this event's room list, ignore it.
  const joinedRoomValid = joined ? rooms.some((r) => r.id === joined.roomId) || rooms.length === 0 : false;
  const showJoined = joined && joinedRoomValid;

  const date = event.starts_at ? new Date(event.starts_at) : null;

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
          <h1 className="font-display text-2xl font-bold leading-tight">{event.name}</h1>
          {event.description && <p className="mt-2 text-sm text-muted-foreground">{event.description}</p>}
          <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
            {date && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {date.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}
              </div>
            )}
            {event.location && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                {event.location}
              </div>
            )}
          </div>

          {showJoined ? (
            <div className="mt-6">
              <div className="rounded-xl border border-primary/20 bg-primary-soft p-5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="font-display text-sm font-semibold text-foreground">
                      Bạn đã tham gia phòng: {joined!.roomName}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">Hẹn gặp bạn tại sự kiện.</p>
                  </div>
                </div>
              </div>
              {joined!.token && (
                <Button asChild variant="outline" className="mt-4 w-full">
                  <Link to="/join/$id/confirm/$token" params={{ id, token: joined!.token! }}>
                    <ExternalLink className="h-4 w-4" />
                    Xem lại xác nhận tham gia
                  </Link>
                </Button>
              )}
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Nếu cần đổi phòng, vui lòng liên hệ ban tổ chức.
              </p>
            </div>
          ) : (
            <div className="mt-6">
              <h2 className="text-sm font-semibold">Chọn phòng để tham gia</h2>
              {rooms.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Sự kiện chưa có phòng nào. Vui lòng liên hệ ban tổ chức.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {rooms.map((r) => (
                    <li key={r.id}>
                      <Link
                        to="/join/$id/$roomId"
                        params={{ id, roomId: r.id }}
                        className="group flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium transition-colors hover:border-primary hover:bg-primary-soft"
                      >
                        <span className="flex items-center gap-2">
                          <DoorOpen className="h-4 w-4 text-primary" />
                          {r.name}
                        </span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
