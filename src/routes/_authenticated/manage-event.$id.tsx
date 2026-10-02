import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  DoorOpen,
  Loader2,
  MapPin,
  Pencil,
  QrCode,
  Shield,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { getEventRole, type EventRole } from "@/lib/event-role";

export const Route = createFileRoute("/_authenticated/manage-event/$id")({
  head: () => ({
    meta: [
      {
        title: "Quản lý sự kiện — Joinly",
      },
    ],
  }),
  component: ManageEvent,
});

type EventRow = {
  id: string;
  name: string;
  location: string | null;
  starts_at: string | null;
  allowlist_enabled: boolean;
  allowlist_scope: "event" | "room";
};

type Room = {
  id: string;
  name: string;
};

type AllowlistEntry = {
  id: string;
  full_name: string | null;
  email: string | null;
  student_id: string | null;
  room_id: string | null;
};

function ManageEvent() {
  const { id } = useParams({
    from: "/_authenticated/manage-event/$id",
  });

  const navigate = useNavigate();

  const [event, setEvent] = useState<EventRow | null>(null);

  const [role, setRole] = useState<EventRole>(null);

  const [rooms, setRooms] = useState<Room[]>([]);

  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);

  const [selectedAllowlistRoomId, setSelectedAllowlistRoomId] = useState("");

  const [loading, setLoading] = useState(true);

  const [updatingAllowlist, setUpdatingAllowlist] = useState(false);

  const [deletingEvent, setDeletingEvent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    const [
      { data: ev, error: eventError },
      { data: rms, error: roomsError },
      { data: allowed, error: allowlistError },
      currentRole,
    ] = await Promise.all([
      supabase
        .from("events")
        .select(
          `
            id,
            name,
            location,
            starts_at,
            allowlist_enabled,
            allowlist_scope
          `,
        )
        .eq("id", id)
        .maybeSingle(),

      supabase.from("event_rooms").select("id, name").eq("event_id", id).order("position"),

      supabase
        .from("event_allowlist")
        .select(
          `
            id,
            full_name,
            email,
            student_id,
            room_id
          `,
        )
        .eq("event_id", id)
        .order("created_at", {
          ascending: false,
        }),

      getEventRole(id),
    ]);

    if (eventError) {
      console.error(eventError);
    }

    if (roomsError) {
      console.error(roomsError);
    }

    if (allowlistError) {
      console.error(allowlistError);
    }

    setEvent(ev as EventRow | null);
    setRole(currentRole);

    const loadedRooms = (rms as Room[] | null) ?? [];

    setRooms(loadedRooms);

    setAllowlist((allowed as AllowlistEntry[] | null) ?? []);

    setSelectedAllowlistRoomId((current) => current || loadedRooms[0]?.id || "");

    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleAllowlist = async (enabled: boolean) => {
    if (!event) return;

    if (enabled && allowlist.length === 0) {
      toast.error("Hãy thêm người vào Allow-list trước khi bật.");

      return;
    }

    setUpdatingAllowlist(true);

    const { error } = await supabase.rpc("update_event_allowlist_settings", {
      _event_id: id,
      _enabled: enabled,
      _scope: null,
    });

    setUpdatingAllowlist(false);

    if (error) {
      console.error(error);

      toast.error("Không thể cập nhật Allow-list.");

      return;
    }

    setEvent((current) =>
      current
        ? {
            ...current,
            allowlist_enabled: enabled,
          }
        : current,
    );

    toast.success(enabled ? "Đã bật Allow-list." : "Đã tắt Allow-list.");
  };

  const changeAllowlistScope = async (scope: "event" | "room") => {
    if (!event) return;

    if (scope === "room" && rooms.length === 0) {
      toast.error("Sự kiện chưa có phòng.");

      return;
    }

    const { error } = await supabase.rpc("update_event_allowlist_settings", {
      _event_id: id,
      _enabled: null,
      _scope: scope,
    });

    if (error) {
      console.error(error);

      toast.error("Không thể thay đổi phạm vi Allow-list.");

      return;
    }

    setEvent((current) =>
      current
        ? {
            ...current,
            allowlist_scope: scope,
          }
        : current,
    );

    toast.success(
      scope === "event"
        ? "Allow-list áp dụng cho toàn sự kiện."
        : "Allow-list áp dụng theo từng phòng.",
    );
  };

  const deleteEvent = async () => {
    if (!event) return;

    if (role !== "owner") {
      toast.error("Chỉ Owner mới có thể xóa sự kiện.");

      return;
    }

    const confirmed = window.confirm(
      `Bạn có chắc muốn xóa sự kiện "${event.name}"?\n\nHành động này không thể hoàn tác.`,
    );

    if (!confirmed) return;

    setDeletingEvent(true);

    const { error } = await supabase.from("events").delete().eq("id", id);

    setDeletingEvent(false);

    if (error) {
      console.error(error);

      toast.error("Không thể xóa sự kiện.");

      return;
    }

    toast.success("Đã xóa sự kiện.");

    navigate({
      to: "/my-events",
    });
  };

  const visibleAllowlist = allowlist.filter((person) => {
    // Toàn sự kiện:
    // hiển thị tất cả người, kể cả người thuộc từng phòng
    if (event?.allowlist_scope === "event") {
      return true;
    }

    // Theo từng phòng:
    // hiển thị người chung toàn sự kiện
    // + người của phòng đang chọn
    return person.room_id === null || person.room_id === selectedAllowlistRoomId;
  });

  const allowlistPreview = visibleAllowlist.slice(0, 2);

  const remainingAllowlistCount = Math.max(visibleAllowlist.length - allowlistPreview.length, 0);

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
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!event || !role) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Bạn không có quyền quản lý sự kiện này.
      </div>
    );
  }

  const eventDate = event.starts_at ? new Date(event.starts_at) : null;

  return (
    <div className="min-h-screen bg-secondary/30 px-4 py-12">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/my-events"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Sự kiện của tôi
        </Link>

        {/* THÔNG TIN SỰ KIỆN */}
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold">{event.name}</h1>

            <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium">
              {roleLabel}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {eventDate && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />

                {eventDate.toLocaleString("vi-VN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </div>
            )}

            {event.location && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                {event.location}
              </div>
            )}

            <div className="flex items-center gap-2">
              <DoorOpen className="h-4 w-4" />
              {rooms.length} phòng
            </div>
          </div>
        </div>

        {/* NÚT QUẢN LÝ */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          {/* BÊN TRÁI */}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/dashboard/$id" params={{ id }}>
                <BarChart3 className="h-4 w-4" />
                Dashboard
              </Link>
            </Button>

            <Button variant="outline" asChild>
              <Link to="/check-in/$id" params={{ id }}>
                Check-in / Check-out
              </Link>
            </Button>

            <Button asChild>
              <Link to="/event/$id" params={{ id }}>
                <QrCode className="h-4 w-4" />
                Mở phòng QR
              </Link>
            </Button>
          </div>

          {/* BÊN PHẢI */}
          <div className="flex flex-wrap gap-2">
            {(role === "owner" || role === "co_owner") && (
              <Button variant="outline" asChild>
                <Link to="/edit-event/$id" params={{ id }}>
                  <Pencil className="h-4 w-4" />
                  Sửa sự kiện
                </Link>
              </Button>
            )}

            {(role === "owner" || role === "co_owner") && (
              <Button variant="outline" asChild>
                <Link to="/dashboard/$id/members" params={{ id }}>
                  <Shield className="h-4 w-4" />
                  Đội ngũ quản lý
                </Link>
              </Button>
            )}

            {role === "owner" && (
              <Button variant="destructive" onClick={deleteEvent} disabled={deletingEvent}>
                {deletingEvent ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Xóa sự kiện
              </Button>
            )}
          </div>
        </div>

        {/* ALLOW-LIST */}
        <div className="mt-8 rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-col gap-5">
            {/* TITLE */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-semibold">Danh sách được phép tham gia</h2>

                <p className="mt-1 text-sm text-muted-foreground">
                  Khi bật, chỉ người có Email hoặc MSSV trong Allow-list mới được phép vào sự kiện
                  hoặc phòng được phân.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">
                  {event.allowlist_enabled ? "Đang bật" : "Đang tắt"}
                </span>

                <Switch
                  checked={event.allowlist_enabled}
                  disabled={updatingAllowlist}
                  onCheckedChange={toggleAllowlist}
                />
              </div>
            </div>

            {/* SCOPE */}
            <div className="flex flex-wrap items-end justify-between gap-4 border-t border-border pt-5">
              <div>
                <p className="text-sm font-medium">Phạm vi áp dụng</p>

                <div className="mt-3 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant={event.allowlist_scope === "event" ? "default" : "outline"}
                    onClick={() => changeAllowlistScope("event")}
                  >
                    Toàn sự kiện
                  </Button>

                  <Button
                    type="button"
                    variant={event.allowlist_scope === "room" ? "default" : "outline"}
                    onClick={() => changeAllowlistScope("room")}
                  >
                    Theo từng phòng
                  </Button>
                </div>

                {event.allowlist_scope === "room" && (
                  <div className="mt-4">
                    <label className="mb-2 block text-sm font-medium">Chọn phòng</label>

                    <select
                      value={selectedAllowlistRoomId}
                      onChange={(e) => setSelectedAllowlistRoomId(e.target.value)}
                      className="h-10 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {rooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <Button variant="outline" asChild>
                <Link to="/dashboard/$id/allowlist/tsx" params={{ id }}>
                  <Users className="h-4 w-4" />
                  Quản lý Allow-list
                </Link>
              </Button>
            </div>

            {/* PREVIEW */}
            <div className="overflow-hidden rounded-xl border border-border">
              {visibleAllowlist.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  Chưa có người nào trong Allow-list.
                </div>
              ) : (
                <>
                  <div className="divide-y divide-border">
                    {allowlistPreview.map((person) => (
                      <div key={person.id} className="grid gap-2 px-4 py-3 sm:grid-cols-3">
                        <div className="font-medium">{person.full_name || "—"}</div>

                        <div className="text-sm text-muted-foreground">{person.email || "—"}</div>

                        <div className="text-sm text-muted-foreground">
                          {person.student_id || "—"}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
                    {remainingAllowlistCount > 0
                      ? `+ ${remainingAllowlistCount} người khác`
                      : `Tổng ${visibleAllowlist.length} người`}
                  </div>
                </>
              )}
            </div>

            {event.allowlist_enabled && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Allow-list đang bật. Người không có trong danh sách sẽ không được phép vào sự kiện
                hoặc phòng được phân.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
