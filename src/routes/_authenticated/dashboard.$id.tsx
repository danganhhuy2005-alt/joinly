import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  Users,
  Loader2,
  Download,
  CheckCircle2,
  DoorOpen,
  Eye,
  EyeOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getEventRole, type EventRole } from "@/lib/event-role";

export const Route = createFileRoute("/_authenticated/dashboard/$id")({
  head: () => ({
    meta: [
      {
        title: "Dashboard sự kiện — Joinly",
      },
    ],
  }),
  component: Dashboard,
});

type EventRow = {
  id: string;
  name: string;
};

type Room = {
  id: string;
  name: string;
};

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
  const { id } = useParams({
    from: "/_authenticated/dashboard/$id",
  });

  const [event, setEvent] = useState<EventRow | null>(null);

  const [rooms, setRooms] = useState<Room[]>([]);

  const [participants, setParticipants] = useState<Participant[]>([]);

  const [loading, setLoading] = useState(true);

  const [role, setRole] = useState<EventRole>(null);

  const [showEmail, setShowEmail] = useState(true);

  const [showPhone, setShowPhone] = useState(true);

  const [showStudentId, setShowStudentId] = useState(true);

  const [selectedParticipantRoomId, setSelectedParticipantRoomId] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);

    const [
      { data: ev, error: eventError },
      { data: rms, error: roomsError },
      { data: ps, error: participantsError },
      currentRole,
    ] = await Promise.all([
      supabase.from("events").select("id, name").eq("id", id).maybeSingle(),

      supabase.from("event_rooms").select("id, name").eq("event_id", id).order("position"),

      supabase
        .from("participants")
        .select(
          `
            id,
            full_name,
            email,
            phone,
            student_id,
            room_id,
            created_at
          `,
        )
        .eq("event_id", id)
        .order("created_at", {
          ascending: false,
        }),

      getEventRole(id),
    ]);

    if (eventError) {
      console.error("Load event error:", eventError);
    }

    if (roomsError) {
      console.error("Load rooms error:", roomsError);
    }

    if (participantsError) {
      console.error("Load participants error:", participantsError);
    }

    setEvent(ev as EventRow | null);

    setRole(currentRole);

    setRooms((rms as Room[] | null) ?? []);

    setParticipants((ps as Participant[] | null) ?? []);

    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const roomName = (roomId: string) => rooms.find((room) => room.id === roomId)?.name ?? "—";

  const total = participants.length;

  const breakdown = rooms.map((room) => ({
    room,

    count: participants.filter((participant) => participant.room_id === room.id).length,
  }));

  const filteredParticipants =
    selectedParticipantRoomId === "all"
      ? participants
      : participants.filter((participant) => participant.room_id === selectedParticipantRoomId);

  const exportCsv = () => {
    const header = ["Họ tên", "Email", "Số điện thoại", "MSSV", "Phòng", "Thời gian đăng ký"];

    const rows = participants.map((participant) => [
      participant.full_name,
      participant.email,
      participant.phone ?? "",
      participant.student_id ?? "",
      roomName(participant.room_id),

      new Date(participant.created_at).toLocaleString("vi-VN"),
    ]);

    const safeCsvCell = (value: string) => {
      const stripped = value ?? "";

      const safe = /^[=+\-@\t\r|%]/.test(stripped) ? `'${stripped}` : stripped;

      return `"${safe.replace(/"/g, '""')}"`;
    };

    const csv =
      "\uFEFF" + [header, ...rows].map((row) => row.map(safeCsvCell).join(",")).join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;

    link.download = `participants-${event?.name ?? id}.csv`;

    link.click();

    URL.revokeObjectURL(url);
  };

  const roleLabel =
    role === "owner"
      ? "Owner"
      : role === "co_owner"
        ? "Co-owner"
        : role === "manager"
          ? "Manager"
          : "";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Không tìm thấy sự kiện
      </div>
    );
  }

  if (!role) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="font-display text-xl font-semibold">
            Bạn không có quyền quản lý sự kiện này
          </h1>

          <Button variant="outline" asChild className="mt-4">
            <Link to="/my-events">Quay lại sự kiện của tôi</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-secondary/30 px-4 py-12">
      <div className="mx-auto max-w-6xl">
        {/* QUAY LẠI */}
        <Link
          to="/manage-event/$id"
          params={{ id }}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Quay lại sự kiện
        </Link>

        {/* HEADER */}
        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl font-bold">Dashboard</h1>

              {roleLabel && (
                <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium">
                  {roleLabel}
                </span>
              )}
            </div>

            <p className="mt-1 text-sm text-muted-foreground">{event.name}</p>
          </div>

          <Button variant="outline" onClick={exportCsv} disabled={total === 0}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>

        {/* STAT CARDS */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <StatCard
            icon={<Users className="h-5 w-5" />}
            label="Tổng số người đã tham gia"
            value={String(total)}
          />

          <StatCard
            icon={<DoorOpen className="h-5 w-5" />}
            label="Số phòng"
            value={String(rooms.length)}
          />
        </div>

        {/* THEO PHÒNG */}
        <div className="mt-6 rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-semibold">Theo phòng</h2>

            <span className="text-sm text-muted-foreground">{total} người</span>
          </div>

          {/* BỘ LỌC */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={selectedParticipantRoomId === "all" ? "default" : "outline"}
              onClick={() => setSelectedParticipantRoomId("all")}
            >
              Tất cả ({total})
            </Button>

            {breakdown.map(({ room, count }) => (
              <Button
                key={room.id}
                type="button"
                size="sm"
                variant={selectedParticipantRoomId === room.id ? "default" : "outline"}
                onClick={() => setSelectedParticipantRoomId(room.id)}
              >
                {room.name} ({count})
              </Button>
            ))}
          </div>

          {/* THANH THỐNG KÊ */}
          {breakdown.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Sự kiện chưa có phòng.</p>
          ) : (
            <div className="mt-6 space-y-4">
              {breakdown.map(({ room, count }) => {
                const percentage = total === 0 ? 0 : Math.round((count / total) * 100);

                return (
                  <div key={room.id}>
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="font-medium">{room.name}</span>

                      <span className="text-muted-foreground">{count} người</span>
                    </div>

                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{
                          width: `${percentage}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* DANH SÁCH NGƯỜI THAM GIA */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold">Danh sách người tham gia</h2>

                <p className="mt-1 text-sm text-muted-foreground">
                  Thông tin đăng ký của người tham gia sự kiện.
                </p>
              </div>
            </div>
          </div>

          {filteredParticipants.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              Chưa có người đăng ký trong phạm vi đang chọn.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">Họ tên</th>

                    <th className="px-5 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <span>Email</span>

                        <button
                          type="button"
                          onClick={() => setShowEmail((current) => !current)}
                          className="text-muted-foreground hover:text-foreground"
                          title={showEmail ? "Ẩn Email" : "Hiện Email"}
                        >
                          {showEmail ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </th>

                    <th className="px-5 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <span>SĐT</span>

                        <button
                          type="button"
                          onClick={() => setShowPhone((current) => !current)}
                          className="text-muted-foreground hover:text-foreground"
                          title={showPhone ? "Ẩn SĐT" : "Hiện SĐT"}
                        >
                          {showPhone ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </th>

                    <th className="px-5 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <span>MSSV</span>

                        <button
                          type="button"
                          onClick={() => setShowStudentId((current) => !current)}
                          className="text-muted-foreground hover:text-foreground"
                          title={showStudentId ? "Ẩn MSSV" : "Hiện MSSV"}
                        >
                          {showStudentId ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </th>

                    <th className="px-5 py-3 font-medium">Phòng</th>

                    <th className="px-5 py-3 font-medium">Trạng thái</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredParticipants.map((participant) => (
                    <tr key={participant.id} className="border-t border-border">
                      <td className="px-5 py-3 font-medium">{participant.full_name}</td>

                      <td className="px-5 py-3 text-muted-foreground">
                        {showEmail ? participant.email : "••••••••••"}
                      </td>

                      <td className="px-5 py-3 text-muted-foreground">
                        {showPhone ? participant.phone || "—" : "••••••••••"}
                      </td>

                      <td className="px-5 py-3 text-muted-foreground">
                        {showStudentId ? participant.student_id || "—" : "••••••••"}
                      </td>

                      <td className="px-5 py-3">{roomName(participant.room_id)}</td>

                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
                          <CheckCircle2 className="h-3 w-3" />
                          Đã tham gia
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
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
        {icon}
      </div>

      <div className="mt-3 text-sm text-muted-foreground">{label}</div>

      <div className="mt-1 font-display text-3xl font-bold">{value}</div>
    </div>
  );
}
