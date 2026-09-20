import { useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, QrCode, Copy, Check, Loader2, DoorOpen, Users, Calendar, MapPin, KeyRound, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getRoomAccessCode, updateRoomAccessCode } from "@/lib/room-access.functions";


export const Route = createFileRoute("/_authenticated/event/$id")({
  head: () => ({ meta: [{ title: "Phòng sự kiện — Joinly" }] }),
  component: EventRoom,
});

type Ev = {
  name: string;
  description: string | null;
  location: string | null;
  starts_at: string | null;
  expected_attendees: number | null;
};
type Room = { id: string; name: string; has_access_code: boolean };

function RoomCard({ eventId, room, onCodeChanged }: { eventId: string; room: Room; onCodeChanged: (roomId: string, hasCode: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/join/${eventId}/${room.id}` : "";
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(joinUrl)}`;

  const readCode = useServerFn(getRoomAccessCode);
  const saveCode = useServerFn(updateRoomAccessCode);
  const [editing, setEditing] = useState(false);
  const [loadingCode, setLoadingCode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [codeInput, setCodeInput] = useState("");

  const copy = async () => {
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    toast.success(`Đã sao chép liên kết ${room.name}`);
    setTimeout(() => setCopied(false), 1500);
  };

  const openEditor = async () => {
    setEditing(true);
    setLoadingCode(true);
    try {
      const { accessCode } = await readCode({ data: { roomId: room.id } });
      setCodeInput(accessCode ?? "");
    } catch {
      toast.error("Không thể tải mã hiện tại");
      setCodeInput("");
    } finally {
      setLoadingCode(false);
    }
  };

  const save = async () => {
    const trimmed = codeInput.trim().toUpperCase();
    if (trimmed && !/^[A-Z0-9]{4,6}$/.test(trimmed)) {
      toast.error("Mã phải gồm 4–6 ký tự chữ hoa hoặc số");
      return;
    }
    setSaving(true);
    try {
      const res = await saveCode({ data: { roomId: room.id, accessCode: trimmed || null } });
      onCodeChanged(room.id, !!res.accessCode);
      toast.success(res.accessCode ? "Đã cập nhật mã tham gia" : "Đã xoá mã tham gia (phòng mở)");
      setEditing(false);
    } catch {
      toast.error("Không thể cập nhật mã. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary-soft text-primary">
          <DoorOpen className="h-4 w-4" />
        </span>
        <h3 className="font-display text-lg font-semibold">{room.name}</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Quét mã QR để tham gia phòng này</p>

      <div className="mt-4 flex justify-center">
        <div className="rounded-xl border border-border bg-white p-3">
          <img src={qrSrc} alt={`Mã QR phòng ${room.name}`} width={240} height={240} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-secondary/50 p-2">
        <code className="flex-1 truncate px-2 text-left text-xs">{joinUrl}</code>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            {room.has_access_code ? (
              <>
                <Lock className="h-3.5 w-3.5 text-primary" />
                <span className="font-medium text-foreground">Yêu cầu mã tham gia</span>
              </>
            ) : (
              <>
                <LockOpen className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Phòng mở (không cần mã)</span>
              </>
            )}
          </div>
          {!editing && (
            <Button type="button" size="sm" variant="outline" onClick={openEditor}>
              <KeyRound className="h-3.5 w-3.5" />
              {room.has_access_code ? "Đổi mã" : "Đặt mã"}
            </Button>
          )}
        </div>
        {editing && (
          <div className="mt-3 space-y-2">
            <Label htmlFor={`edit-code-${room.id}`} className="text-xs text-muted-foreground">
              Mã tham gia (4–6 ký tự chữ hoa/số). Để trống để mở phòng.
            </Label>
            <Input
              id={`edit-code-${room.id}`}
              value={codeInput}
              maxLength={6}
              disabled={loadingCode}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="VD: A1B2"
              className="uppercase"
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={save} disabled={saving || loadingCode}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Lưu
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Huỷ
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function EventRoom() {
  const { id } = useParams({ from: "/_authenticated/event/$id" });
  const [event, setEvent] = useState<Ev | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: ev }, { data: rms }] = await Promise.all([
        supabase
          .from("events")
          .select("name, description, location, starts_at, expected_attendees")
          .eq("id", id)
          .maybeSingle(),
        supabase.from("event_rooms").select("id, name, has_access_code").eq("event_id", id).order("position", { ascending: true }),
      ]);
      setEvent(ev as Ev | null);
      setRooms((rms ?? []) as Room[]);

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
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Không tìm thấy sự kiện</div>;
  }

  const date = event.starts_at ? new Date(event.starts_at) : null;

  return (
    <div className="min-h-screen bg-secondary/30 px-4 py-12">
      <div className="mx-auto max-w-5xl">
        <Link to="/my-events" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Sự kiện của tôi
        </Link>

        <div className="mt-6 rounded-2xl border border-border bg-card p-8 shadow-sm">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
            <QrCode className="h-3.5 w-3.5" /> Phòng sự kiện
          </div>
          <h1 className="mt-3 font-display text-3xl font-bold">{event.name}</h1>
          {event.description && <p className="mt-2 text-sm text-muted-foreground">{event.description}</p>}
          <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
            {date && (
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                {date.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}
              </span>
            )}
            {event.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {event.location}
              </span>
            )}
            {event.expected_attendees != null && (
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                Dự kiến {event.expected_attendees} người
              </span>
            )}
          </div>
        </div>

        <div className="mt-8">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
            <DoorOpen className="h-5 w-5 text-primary" /> Phòng tham gia ({rooms.length})
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Mỗi phòng có mã QR và liên kết riêng. Người tham gia quét mã QR sẽ được dẫn tới biểu mẫu đăng ký cho phòng đó.
          </p>

          {rooms.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
              Sự kiện này chưa có phòng nào.
            </div>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rooms.map((r) => (
                <RoomCard
                  key={r.id}
                  eventId={id}
                  room={r}
                  onCodeChanged={(roomId, hasCode) =>
                    setRooms((rs) => rs.map((x) => (x.id === roomId ? { ...x, has_access_code: hasCode } : x)))
                  }
                />

              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
