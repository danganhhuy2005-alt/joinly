import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
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
  CreditCard,
  Crown,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cancelEventPayment, createPayment } from "@/lib/payment.functions";

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
  organizer_id: string;
  location: string | null;
  starts_at: string | null;
  allowlist_enabled: boolean;
  allowlist_scope: "event" | "room";
  plan_code: string;
  attendee_limit: number;
  lifecycle_status: "draft" | "active";
  requested_plan_code: string | null;
  expected_attendees: number | null;
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

  const createPaymentFn = useServerFn(createPayment);
  const cancelPaymentFn = useServerFn(cancelEventPayment);

  const [billingOpen, setBillingOpen] = useState(false);

  const [creatingPayment, setCreatingPayment] = useState(false);
  const [cancellingPayment, setCancellingPayment] = useState(false);
  const [paymentClock, setPaymentClock] = useState(() => Date.now());

  const [checkingOldOrder, setCheckingOldOrder] = useState(false);
  const [oldOrderError, setOldOrderError] = useState<string | null>(null);
  const [restoredOldOrder, setRestoredOldOrder] = useState(false);

  const [resumingPayment, setResumingPayment] = useState(false);

  const [paymentResult, setPaymentResult] = useState<{
    id: string;
    planCode: string;
    amountVnd: number;
    orderCode: string;
    eventId: string | null;
    expiresAt: string | null;
    qrUrl: string;
    bank: {
      bankCode: string;
      accountNumber: string;
      accountHolder: string;
    };
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const [
      { data: ev, error: eventError },
      { data: rms, error: roomsError },
      { data: allowed, error: allowlistError },
      {
        data: { user },
      },
    ] = await Promise.all([
      supabase
        .from("events")
        .select(
          `
            id,
            name,
            organizer_id,
            location,
            starts_at,
            allowlist_enabled,
            allowlist_scope,
            plan_code,
            attendee_limit,
            lifecycle_status,
            requested_plan_code,
            expected_attendees
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
      supabase.auth.getUser(),
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

    const loadedEvent = ev as EventRow | null;

    setEvent(loadedEvent);

    let resolvedRole: EventRole = null;

    if (loadedEvent && user) {
      // Owner xác định trực tiếp bằng organizer_id
      if (loadedEvent.organizer_id === user.id) {
        resolvedRole = "owner";
      } else {
        // Co-owner / Manager mới cần RPC
        resolvedRole = await getEventRole(id);
      }
    }

    setRole(resolvedRole);

    console.log(
      "JOINLY EVENT ACCESS:",
      JSON.stringify(
        {
          eventId: id,
          event: loadedEvent,
          currentUserId: user?.id,
          organizerId: loadedEvent?.organizer_id,
          resolvedRole,
          eventError,
        },
        null,
        2,
      ),
    );

    const loadedRooms = (rms as Room[] | null) ?? [];

    setRooms(loadedRooms);

    setAllowlist((allowed as AllowlistEntry[] | null) ?? []);

    setSelectedAllowlistRoomId((current) => current || loadedRooms[0]?.id || "");

    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Đơn đang chờ được lưu trong Supabase, không phải trong state của Dialog.
  // Khi mở lại (kể cả reload/trở lại từ trang khác), lấy đúng đơn cũ và
  // gọi createPayment cùng plan để server TÁI SỬ DỤNG order_code/số tiền.
  useEffect(() => {
    if (!billingOpen || !event || role !== "owner") return;

    let cancelled = false;
    const restoreOldOrder = async () => {
      setCheckingOldOrder(true);
      setOldOrderError(null);
      setRestoredOldOrder(false);
      setPaymentResult(null);

      try {
        const { data: pending, error } = await supabase
          .from("payments")
          .select("id, plan_code, expires_at")
          .eq("event_id", id)
          .eq("status", "pending")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        if (cancelled || !pending) return;

        const planCode = pending.plan_code;
        if (planCode !== "small" && planCode !== "standard" && planCode !== "pro") {
          throw new Error("Đơn đang chờ có gói không hợp lệ. Vui lòng liên hệ hỗ trợ.");
        }

        // Hàm server kiểm tra lại quyền Owner, giá tiền và trạng thái;
        // không tạo đơn mới nếu đơn cùng gói vẫn còn hiệu lực.
        const result = await createPayment({ data: { eventId: id, planCode } });
        if (cancelled) return;
        setPaymentResult(result);
        setRestoredOldOrder(true);
      } catch (error) {
        if (!cancelled) {
          setOldOrderError(
            error instanceof Error
              ? error.message
              : "Không kiểm tra được đơn thanh toán đang chờ. Vui lòng thử lại.",
          );
        }
      } finally {
        if (!cancelled) setCheckingOldOrder(false);
      }
    };

    void restoreOldOrder();
    return () => { cancelled = true; };
  }, [billingOpen, event?.id, id, role]);

  useEffect(() => {
    if (!billingOpen || !paymentResult?.expiresAt) return;
    setPaymentClock(Date.now());
    const timer = window.setInterval(() => setPaymentClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [billingOpen, paymentResult?.expiresAt]);

  const expiresAtMillis = paymentResult?.expiresAt
    ? new Date(paymentResult.expiresAt).getTime()
    : NaN;
  const remainingSeconds = Number.isFinite(expiresAtMillis)
    ? Math.max(0, Math.ceil((expiresAtMillis - paymentClock) / 1000))
    : 0;
  const paymentExpired = Boolean(paymentResult && remainingSeconds === 0);
  const remainingTimeLabel = `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`;

  const closeBilling = async () => {
    if (cancellingPayment) return;
    if (creatingPayment || checkingOldOrder) {
      toast.error("Đang kiểm tra/tạo đơn thanh toán, vui lòng hoàn tất thao tác này trước khi đóng.");
      return;
    }

    if (paymentResult) {
      const confirmed = window.confirm(
        "Hủy đơn thanh toán đang chờ và đóng cửa sổ?\n\nChỉ xác nhận nếu bạn CHƯA chuyển khoản. Đơn hủy sẽ không được kích hoạt tự động nếu tiền đến muộn.",
      );
      if (!confirmed) return;

      setCancellingPayment(true);
      try {
        await cancelPaymentFn({
          data: { eventId: id, paymentId: paymentResult.id },
        });
        toast.success("Đã hủy đơn đang chờ. Bạn có thể chọn gói khác.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không thể hủy đơn thanh toán.");
        return; // Keep the QR visible if cancellation failed.
      } finally {
        setCancellingPayment(false);
      }
    }

    setBillingOpen(false);
    setPaymentResult(null);
    setOldOrderError(null);
    setRestoredOldOrder(false);
  };

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

  const resumeDraftPayment = async () => {
    if (!event || resumingPayment) return;

    const planCode = event.requested_plan_code;

    if (planCode !== "small" && planCode !== "standard" && planCode !== "pro") {
      toast.error("Gói thanh toán không hợp lệ.");
      return;
    }

    setResumingPayment(true);

    try {
      await createPaymentFn({
        data: {
          planCode,
          eventId: event.id,
        },
      });

      await navigate({
        to: "/create-event",
        search: { resumeId: event.id },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể tạo mã thanh toán mới.");
    } finally {
      setResumingPayment(false);
    }
  };

  const buyPlan = async (planCode: "small" | "standard" | "pro") => {
    // Không cho mở đơn mới khi chưa kiểm tra được đơn cũ.
    if (checkingOldOrder || oldOrderError || creatingPayment) return;
    setCreatingPayment(true);

    try {
      const result = await createPaymentFn({
        data: {
          planCode,
          eventId: id,
        },
      });

      setPaymentResult(result);
      setRestoredOldOrder(false);
    } catch (error) {
      console.error(error);

      toast.error(error instanceof Error ? error.message : "Không thể tạo đơn thanh toán.");
    } finally {
      setCreatingPayment(false);
    }
  };

  const copyPaymentValue = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`Đã sao chép ${label.toLowerCase()}.`);
    } catch {
      toast.error("Không thể sao chép. Vui lòng thử lại.");
    }
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
  if (event.lifecycle_status === "draft") {
    return (
      <div className="min-h-screen bg-secondary/30 px-4 py-12">
        <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 text-center">
            <h1 className="text-2xl font-bold">Sự kiện chưa được kích hoạt</h1>

            <p className="mt-2 text-sm text-muted-foreground">
              Hoàn tất thanh toán để bắt đầu tổ chức sự kiện.
            </p>
          </div>

          <div className="space-y-3 rounded-xl bg-secondary/50 p-4">
            <div>
              <p className="text-xs text-muted-foreground">Tên sự kiện</p>
              <p className="font-semibold">{event.name}</p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">Gói đang chờ kích hoạt</p>
              <p className="font-semibold uppercase">{event.requested_plan_code ?? "Chưa chọn"}</p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">Số người dự kiến</p>
              <p className="font-semibold">{event.expected_attendees ?? 0} người</p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <Button
              type="button"
              className="w-full"
              disabled={resumingPayment}
              onClick={() => void resumeDraftPayment()}
            >
              {resumingPayment ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <QrCode className="h-4 w-4" />
              )}

              {resumingPayment ? "Đang mở thanh toán..." : "Tiếp tục thanh toán"}
            </Button>

            <Button asChild className="w-full">
              <Link to="/edit-event/$id" params={{ id: event.id }}>
                <Pencil className="h-4 w-4" />
                Chỉnh sửa bản nháp
              </Link>
            </Button>

            <Button asChild variant="outline" className="w-full">
              <Link to="/my-events">
                <ArrowLeft className="h-4 w-4" />
                Quay về sự kiện của tôi
              </Link>
            </Button>
          </div>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Bản nháp chưa được công bố và chưa thể nhận đăng ký.
          </p>
        </div>
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
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm">
              <Crown className="h-4 w-4 text-primary" />

              <span className="font-medium">Gói {event.plan_code.toUpperCase()}</span>

              <span className="text-muted-foreground">• tối đa {event.attendee_limit} người</span>
            </div>

            {role === "owner" && ["free", "small", "standard"].includes(event.plan_code) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPaymentResult(null);
                  setOldOrderError(null);
                  setCheckingOldOrder(true);
                  setBillingOpen(true);
                }}
              >
                <CreditCard className="h-4 w-4" />
                Nâng cấp gói
              </Button>
            )}
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
      <Dialog
        open={billingOpen}
        onOpenChange={(open) => {
          if (open) setBillingOpen(true);
          else void closeBilling();
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>Nâng cấp sự kiện</DialogTitle>

            <DialogDescription>
              Chọn gói phù hợp với số lượng người tham dự.
              {event?.plan_code !== "free" && " Chỉ thanh toán phần chênh lệch; số tiền chính xác sẽ hiện trên QR."}
            </DialogDescription>
          </DialogHeader>

          {checkingOldOrder ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang kiểm tra và khôi phục đơn thanh toán cũ...
            </div>
          ) : oldOrderError ? (
            <div className="space-y-3 rounded-xl border border-border p-4">
              <p className="text-sm text-destructive">{oldOrderError}</p>
              <p className="text-sm text-muted-foreground">
                Chưa tạo đơn mới để tránh thu trùng. Bạn có thể đóng và mở lại cửa sổ để thử lại.
              </p>
            </div>
          ) : !paymentResult ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {event.plan_code === "free" && <button
                type="button"
                disabled={creatingPayment}
                onClick={() => void buyPlan("small")}
                className="rounded-xl border border-border p-4 text-left transition hover:border-primary hover:bg-secondary/50"
              >
                <p className="font-semibold">Small</p>

                <p className="mt-1 text-2xl font-bold">50.000đ</p>

                <p className="mt-2 text-sm text-muted-foreground">Tối đa 100 người</p>
              </button>}

              {(event.plan_code === "free" || event.plan_code === "small") && <button
                type="button"
                disabled={creatingPayment}
                onClick={() => void buyPlan("standard")}
                className="rounded-xl border border-primary bg-primary/5 p-4 text-left transition hover:bg-primary/10"
              >
                <p className="font-semibold">Standard</p>

                <p className="mt-1 text-2xl font-bold">88.000đ</p>

                <p className="mt-2 text-sm text-muted-foreground">Tối đa 300 người</p>
              </button>}

              {(event.plan_code === "free" || event.plan_code === "small" || event.plan_code === "standard") && <button
                type="button"
                disabled={creatingPayment}
                onClick={() => void buyPlan("pro")}
                className="rounded-xl border border-border p-4 text-left transition hover:border-primary hover:bg-secondary/50"
              >
                <p className="font-semibold">Pro</p>

                <p className="mt-1 text-2xl font-bold">199.000đ</p>

                <p className="mt-2 text-sm text-muted-foreground">Tối đa 700 người</p>
              </button>}
            </div>
          ) : (
            <div className="space-y-5">
              {restoredOldOrder && (
                <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                  Đã khôi phục đơn thanh toán đang chờ. Đây là mã đơn cũ, không bị tạo đơn mới.
                </p>
              )}
              <div className="rounded-xl border border-border bg-secondary/30 p-3 text-center text-sm">
                <div className="font-medium">Thời gian thanh toán còn lại</div>
                <div className={paymentExpired ? "mt-1 text-2xl font-bold text-destructive" : "mt-1 text-2xl font-bold text-primary"}>
                  {paymentExpired ? "Đã hết hạn" : remainingTimeLabel}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Hạn thanh toán: {paymentResult.expiresAt
                    ? new Date(paymentResult.expiresAt).toLocaleString("vi-VN")
                    : "Không xác định"}
                </p>
              </div>
              {paymentExpired && (
                <p className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
                  Đơn đã hết hạn. Không chuyển tiền vào QR cũ; hãy hủy đơn và tạo lại.
                </p>
              )}
              {!paymentExpired && <div className="flex justify-center">
                <div className="rounded-2xl border border-border bg-white p-4">
                  <img
                    src={paymentResult.qrUrl}
                    alt={`QR thanh toán ${paymentResult.bank.bankCode}`}
                    className="h-72 w-72 object-contain"
                  />
                </div>
              </div>}

              {!paymentExpired && (
              <div className="rounded-xl border border-border bg-secondary/30 p-4">
                <div className="space-y-3 text-sm">
                  {[
                    { label: "Ngân hàng", display: paymentResult.bank.bankCode, copy: paymentResult.bank.bankCode },
                    { label: "Số tài khoản", display: paymentResult.bank.accountNumber, copy: paymentResult.bank.accountNumber },
                    ...(paymentResult.bank.accountHolder ? [{ label: "Chủ tài khoản", display: paymentResult.bank.accountHolder, copy: paymentResult.bank.accountHolder }] : []),
                    { label: "Số tiền", display: `${paymentResult.amountVnd.toLocaleString("vi-VN")}đ`, copy: String(paymentResult.amountVnd) },
                    { label: "Nội dung", display: paymentResult.orderCode, copy: paymentResult.orderCode },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3">
                      <span className="shrink-0 text-muted-foreground">{item.label}</span>
                      <div className="flex min-w-0 items-center gap-2">
                        <strong className="break-all text-right">{item.display}</strong>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8 shrink-0"
                          aria-label={`Sao chép ${item.label}`}
                          title={`Sao chép ${item.label}`}
                          onClick={() => void copyPaymentValue(item.label, item.copy)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-4 w-full"
                  onClick={() => void copyPaymentValue("toàn bộ thông tin", [
                    `Ngân hàng: ${paymentResult.bank.bankCode}`,
                    `Số tài khoản: ${paymentResult.bank.accountNumber}`,
                    ...(paymentResult.bank.accountHolder ? [`Chủ tài khoản: ${paymentResult.bank.accountHolder}`] : []),
                    `Số tiền: ${paymentResult.amountVnd}`,
                    `Nội dung: ${paymentResult.orderCode}`,
                  ].join("\n"))}
                >
                  <Copy className="h-4 w-4" />
                  Sao chép tất cả
                </Button>
              </div>
              )}

              {!paymentExpired && (
                <p className="text-center text-sm text-muted-foreground">
                  Chỉ chuyển khoản khi đơn còn hạn. Sau khi SePay xác nhận, Joinly sẽ tự động nâng cấp sự kiện.
                </p>
              )}
              <Button
                type="button"
                variant="destructive"
                className="w-full"
                disabled={cancellingPayment || creatingPayment || checkingOldOrder}
                onClick={() => void closeBilling()}
              >
                {cancellingPayment ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Hủy đơn và đóng
              </Button>
            </div>
          )}

          {creatingPayment && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang tạo mã thanh toán...
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
