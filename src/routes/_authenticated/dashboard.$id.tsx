import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Users, QrCode, Loader2, Download, CheckCircle2, DoorOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";


export const Route = createFileRoute("/_authenticated/dashboard/$id")({
  head: () => ({ meta: [{ title: "Dashboard sự kiện — Joinly" }] }),
  component: Dashboard,
});

type EventRow = { id: string; name: string };
type Room = { id: string; name: string };
type Participant = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  student_id: string | null;
  room_id: string;
  created_at: string;
};



function Dashboard() {
  const { id } = useParams({ from: "/_authenticated/dashboard/$id" });
  const [event, setEvent] = useState<EventRow | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);


  const load = useCallback(async () => {
    const [{ data: ev }, { data: rms }, { data: ps }] = await Promise.all([
      supabase.from("events").select("id, name").eq("id", id).maybeSingle(),
      supabase.from("event_rooms").select("id, name").eq("event_id", id).order("position"),
      supabase.from("participants").select("id, full_name, email, phone, student_id, room_id, created_at").eq("event_id", id).order("created_at", { ascending: false }),
    ]);
    setEvent(ev as EventRow | null);
    setRooms((rms as Room[]) ?? []);
    setParticipants((ps as Participant[]) ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const roomName = (rid: string) => rooms.find((r) => r.id === rid)?.name ?? "—";
  const total = participants.length;
  const breakdown = rooms.map((r) => ({
    room: r,
    count: participants.filter((p) => p.room_id === r.id).length,
  }));

  const exportCsv = () => {
    const header = ["Họ tên", "Email", "Số điện thoại", "MSSV", "Phòng", "Thời gian"];
    const rows = participants.map((p) => [
      p.full_name, p.email, p.phone ?? "", p.student_id ?? "",
      roomName(p.room_id),
      new Date(p.created_at).toLocaleString("vi-VN"),
    ]);
    const safeCsvCell = (v: string) => {
      const stripped = v ?? "";
      const safe = /^[=+\-@\t\r|%]/.test(stripped) ? `'${stripped}` : stripped;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const csv = "\uFEFF" + [header, ...rows].map((r) => r.map(safeCsvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `participants-${event?.name ?? id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };



  if (loading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!event) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Không tìm thấy sự kiện</div>;

  return (
    <div className="min-h-screen bg-secondary/30 px-4 py-12">
      <div className="mx-auto max-w-5xl">
        <Link to="/my-events" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Sự kiện của tôi
        </Link>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold">{event.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Dashboard quản lý sự kiện.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={total === 0}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>

            <Button asChild>
              <Link to="/event/$id" params={{ id }}><QrCode className="h-4 w-4" /> Mở phòng QR</Link>
            </Button>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <StatCard icon={<Users className="h-5 w-5" />} label="Tổng số người đã tham gia" value={String(total)} />
          <StatCard icon={<DoorOpen className="h-5 w-5" />} label="Số phòng" value={String(rooms.length)} />
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-card p-6">
          <h2 className="font-display text-lg font-semibold">Theo phòng</h2>
          {breakdown.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Sự kiện chưa có phòng.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {breakdown.map(({ room, count }) => {
                const pct = total === 0 ? 0 : Math.round((count / total) * 100);
                return (
                  <div key={room.id}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{room.name}</span>
                      <span className="text-muted-foreground">{count} người</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="font-display text-lg font-semibold">Danh sách người tham gia</h2>
          </div>
          {participants.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              Chưa có người đăng ký. Bấm <span className="font-medium">Tạo dữ liệu demo</span> để xem thử dashboard.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-medium">Họ tên</th>
                    <th className="px-6 py-3 font-medium">Email</th>
                    <th className="px-6 py-3 font-medium">Phòng</th>
                    <th className="px-6 py-3 font-medium">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-6 py-3 font-medium">{p.full_name}</td>
                      <td className="px-6 py-3 text-muted-foreground">{p.email}</td>
                      <td className="px-6 py-3">{roomName(p.room_id)}</td>
                      <td className="px-6 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
                          <CheckCircle2 className="h-3 w-3" /> Đã tham gia
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">{icon}</div>
      <div className="mt-3 text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-3xl font-bold">{value}</div>
    </div>
  );
}
