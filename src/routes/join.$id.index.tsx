import { useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import {
  Sparkles,
  Calendar,
  MapPin,
  Loader2,
  DoorOpen,
  ArrowRight,
  Check,
  ExternalLink,
  MessageCircle,
  Compass,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getJoined, type JoinedInfo } from "@/lib/joined-events";
import { GuestEventHeader } from "@/components/GuestEventHeader";
import { SaveGuestTicketPrompt } from "@/components/SaveGuestTicketPrompt";
import { discoveryCoverUrl, discoveryCategoryLabel } from "@/lib/discovery";

export const Route = createFileRoute("/join/$id/")({
  head: () => ({ meta: [{ title: "Thông tin sự kiện — Joinly" }] }),
  component: JoinPickRoom,
});

type EventRow = {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  starts_at: string | null;
};
type Room = { id: string; name: string };
type PublicDiscovery = {
  discovery_cover_path: string | null;
  discovery_category: string;
  remaining_seats: number | null;
};

function JoinPickRoom() {
  const { id } = useParams({ from: "/join/$id/" });
  const [event, setEvent] = useState<EventRow | null>(null);
  const [publicDiscovery, setPublicDiscovery] = useState<PublicDiscovery | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [joined, setJoinedState] = useState<JoinedInfo | null>(null);

  useEffect(() => {
    setJoinedState(getJoined(id));
    (async () => {
      const [{ data: ev }, { data: rms }] = await Promise.all([
        supabase
          .from("events")
          .select("id, name, description, location, starts_at")
          .eq("id", id)
          .maybeSingle(),
        (supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> })
          .from("event_rooms_public")
          .select("id, name")
          .eq("event_id", id)
          .order("position"),
      ]);
      // Signed-in attendees do not have Owner RLS access to another event.
      // Use a narrow public summary RPC rather than exposing event billing fields.
      let publicEvent = ev as EventRow | null;
      if (!publicEvent) {
        const { data: publicRows } = await supabase.rpc("get_join_event_public" as never, {
          p_event_id: id,
        } as never);
        publicEvent = ((publicRows as EventRow[] | null)?.[0] ?? null);
      }
      setEvent(publicEvent);
      // A direct QR link can be private. Do not reveal marketing metadata
      // unless this event satisfies every current Discover visibility rule.
      const { data: discoveryRows } = await supabase.rpc("get_discoverable_event" as never, {
        p_event_id: id,
      } as never);
      const detail = ((discoveryRows as PublicDiscovery[] | null)?.[0] ?? null);
      setPublicDiscovery(detail);
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
          <a href="/" className="mt-4 inline-flex text-sm font-medium text-primary hover:underline">Về Trang chủ Joinly</a>
        </div>
      </div>
    );
  }

  // If the stored room no longer belongs to this event's room list, ignore it.
  const joinedRoomValid = joined
    ? rooms.some((r) => r.id === joined.roomId) || rooms.length === 0
    : false;
  const showJoined = joined && joinedRoomValid;

  const date = event.starts_at ? new Date(event.starts_at) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4 py-12">
      <div className="w-full max-w-2xl">
        <GuestEventHeader />
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {publicDiscovery?.discovery_cover_path && discoveryCoverUrl(publicDiscovery.discovery_cover_path) && (
            <img src={discoveryCoverUrl(publicDiscovery.discovery_cover_path)!} alt={`Ảnh bìa ${event.name}`}
              className="h-60 w-full object-cover sm:h-72" />
          )}
          <div className="p-6 sm:p-8">
          {publicDiscovery && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                {discoveryCategoryLabel(publicDiscovery.discovery_category)}
              </span>
              <Link to="/discover" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <Compass className="h-3.5 w-3.5" /> Khám phá sự kiện khác
              </Link>
            </div>
          )}
          <h1 className="font-display text-2xl font-bold leading-tight">{event.name}</h1>
          {event.description && (
            <p className="mt-2 text-sm text-muted-foreground">{event.description}</p>
          )}
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

          {publicDiscovery?.remaining_seats !== null && publicDiscovery?.remaining_seats !== undefined && (
            <p className="mt-4 flex items-center gap-2 rounded-lg bg-primary/5 p-3 text-sm text-foreground">
              <Users className="h-4 w-4 text-primary" />
              {publicDiscovery.remaining_seats > 0
                ? `Còn khoảng ${publicDiscovery.remaining_seats} suất đăng ký`
                : "Sự kiện đã đủ suất đăng ký"}
              <span className="text-xs text-muted-foreground">(số liệu tham khảo)</span>
            </p>
          )}
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
              {joined!.token && (
                <Button asChild variant="outline" className="mt-3 w-full">
                  <a href={`/qna/${id}`}>
                    <MessageCircle className="h-4 w-4" />
                    Giơ tay / Hỏi BTC
                  </a>
                </Button>
              )}
              {joined!.token && <SaveGuestTicketPrompt />}
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Nếu cần đổi phòng, vui lòng liên hệ ban tổ chức.
              </p>
            </div>
          ) : (
            <div className="mt-6">
              <h2 className="text-sm font-semibold">Chọn phòng để tham gia</h2>
              {rooms.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Sự kiện chưa có phòng nào. Vui lòng liên hệ ban tổ chức.
                </p>
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
    </div>
  );
}
