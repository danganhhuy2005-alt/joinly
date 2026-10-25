import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EventLocationPicker } from "@/components/EventLocationPicker";
import { EventDiscoveryFields, emptyDiscoveryForm, type DiscoveryFormValue } from "@/components/EventDiscoveryFields";
import { EventStartModeFields, type StartMode } from "@/components/EventStartModeFields";
import { saveEventDiscovery } from "@/lib/event-discovery-save";

import { supabase } from "@/integrations/supabase/client";
import { getEventRole, type EventRole } from "@/lib/event-role";

export const Route = createFileRoute("/_authenticated/edit-event/$id")({
  head: () => ({
    meta: [
      {
        title: "Sửa sự kiện — Joinly",
      },
    ],
  }),
  component: EditEvent,
});

type EventRow = {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  starts_at: string | null;
  expected_attendees: number | null;

  latitude: number | null;
  longitude: number | null;
  checkin_radius: number;
};

type SavedDiscoveryState = Pick<DiscoveryFormValue, "category" | "coverPath" | "showSlots" | "enabled">;

function getSaveErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "Lỗi không xác định.";
  const payload = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
  const message = typeof payload.message === "string" ? payload.message : "Lỗi không xác định.";
  const code = typeof payload.code === "string" && payload.code ? ` (mã ${payload.code})` : "";
  const hint = typeof payload.hint === "string" && payload.hint ? ` — ${payload.hint}` : "";
  return `${message}${code}${hint}`;
}

function toDateTimeLocal(value: string | null) {
  if (!value) return "";

  const date = new Date(value);

  const offset = date.getTimezoneOffset() * 60_000;

  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function EditEvent() {
  const { id } = useParams({
    from: "/_authenticated/edit-event/$id",
  });

  const navigate = useNavigate();

  const [role, setRole] = useState<EventRole>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [discoveryReady, setDiscoveryReady] = useState(true);
  const [runReady, setRunReady] = useState(true);
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [configSaveErrors, setConfigSaveErrors] = useState<string[]>([]);
  const originalStartMode = useRef<StartMode>("manual");
  const originalDiscovery = useRef<SavedDiscoveryState | null>(null);

  const [name, setName] = useState("");

  const [description, setDescription] = useState("");

  const [location, setLocation] = useState("");

  const [startsAt, setStartsAt] = useState("");
  const startsAtOriginal = useRef<string | null>(null);
  const [startMode, setStartMode] = useState<StartMode>("manual");
  const [eventRunStatus, setEventRunStatus] = useState<"upcoming" | "live" | "ended">("upcoming");
  const [discovery, setDiscovery] = useState<DiscoveryFormValue>({ ...emptyDiscoveryForm });

  const [expected, setExpected] = useState("");

  const [latitude, setLatitude] = useState<number | null>(null);

  const [longitude, setLongitude] = useState<number | null>(null);

  const [checkinRadius, setCheckinRadius] = useState("200");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      setLoadWarnings([]);
      setConfigSaveErrors([]);
      originalDiscovery.current = null;
      setDiscoveryReady(true);
      setRunReady(true);

      // Luôn tải thông tin cốt lõi trước. Các cột Khám phá là tính năng bổ sung,
      // không được làm form sửa sự kiện cũ thất bại.
      const currentRole = await getEventRole(id);
      if (cancelled) return;
      setRole(currentRole);
      if (currentRole !== "owner" && currentRole !== "co_owner") {
        setLoading(false);
        return;
      }

      const { data: event, error } = await supabase
        .from("events")
        .select(`
          id, name, description, location, starts_at, expected_attendees,
          latitude, longitude, checkin_radius
        `)
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;

      if (error || !event) {
        console.error("Load event basic fields error:", error);
        setLoadError(error
          ? `${error.message} (mã: ${error.code ?? "không xác định"})`
          : "Không tìm thấy sự kiện, hoặc tài khoản hiện tại không có quyền đọc sự kiện này.");
        toast.error("Không thể tải thông tin sự kiện.");
        setLoading(false);
        return;
      }

      const ev = event as unknown as EventRow;
      setName(ev.name);
      setDescription(ev.description ?? "");
      setLocation(ev.location ?? "");
      setStartsAt(toDateTimeLocal(ev.starts_at));
      startsAtOriginal.current = ev.starts_at;
      setExpected(ev.expected_attendees ? String(ev.expected_attendees) : "");
      setLatitude(ev.latitude);
      setLongitude(ev.longitude);
      setCheckinRadius(String(ev.checkin_radius ?? 200));

      // Tải cấu hình Khám phá tách riêng để cột SQL chưa được cập nhật
      // cũng không chặn người dùng sửa tên, mô tả, địa điểm của sự kiện cũ.
      const { data: discoveryData, error: discoveryError } = await supabase
        .from("events")
        .select("discovery_enabled, discovery_category, discovery_cover_path, discovery_show_slots")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      const warnings: string[] = [];
      if (discoveryError || !discoveryData) {
        console.error("Load event discovery fields error:", discoveryError);
        setDiscoveryReady(false);
        warnings.push("Không tải được cấu hình Khám phá. Kiểm tra migration 20261025030000; phần thông tin cơ bản vẫn sửa được.");
      } else {
        const details = discoveryData as unknown as {
          discovery_enabled: boolean | null;
          discovery_category: string | null;
          discovery_cover_path: string | null;
          discovery_show_slots: boolean | null;
        };
        const savedDiscovery: SavedDiscoveryState = {
          category: details.discovery_category || "other",
          coverPath: details.discovery_cover_path ?? null,
          showSlots: Boolean(details.discovery_show_slots),
          enabled: Boolean(details.discovery_enabled),
        };
        originalDiscovery.current = savedDiscovery;
        setDiscovery({ ...savedDiscovery, coverFile: null, removeCover: false });
      }

      // Trạng thái vận hành cũng là chức năng mới, không làm mất quyền sửa
      // thông tin cũ nếu RPC chưa có. Không cho đổi lịch khi không xác minh
      // được trạng thái sự kiện để tránh làm sai thời gian sự kiện đã diễn ra.
      const { data: stateRows, error: stateError } = await supabase.rpc(
        "get_event_run_state" as never, { p_event_id: id } as never,
      );
      if (cancelled) return;
      if (stateError) {
        console.error("Load event run state error:", stateError);
        setRunReady(false);
        warnings.push("Không tải được trạng thái Bắt đầu/Kết thúc. Hãy kiểm tra migration 20261025040000; tạm khóa thay đổi thời gian.");
      } else {
        const state = (stateRows as { status: "upcoming" | "live" | "ended"; mode: StartMode }[] | null)?.[0];
        if (state) {
          setStartMode(state.mode);
          originalStartMode.current = state.mode;
          setEventRunStatus(state.status);
        } else {
          setRunReady(false);
          warnings.push("Không nhận được trạng thái vận hành của sự kiện; tạm khóa thay đổi thời gian.");
        }
      }
      setLoadWarnings(warnings);
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [id]);

  const saveEvent = async (e: React.FormEvent) => {
    e.preventDefault();

    if (role !== "owner" && role !== "co_owner") {
      toast.error("Bạn không có quyền sửa sự kiện.");
      return;
    }

    if (!name.trim()) {
      toast.error("Vui lòng nhập tên sự kiện.");
      return;
    }

    if ((!runReady || eventRunStatus !== "upcoming") && toDateTimeLocal(startsAtOriginal.current) !== startsAt) {
      toast.error("Không thể đổi thời gian khi sự kiện đã bắt đầu.");
      return;
    }
    if (!startsAt) {
      toast.error("Vui lòng chọn ngày và giờ.");
      return;
    }

    if (runReady && eventRunStatus === "upcoming" && startMode === "automatic" &&
        new Date(startsAt).getTime() <= Date.now()) {
      toast.error("Chế độ tự động yêu cầu thời gian bắt đầu ở tương lai.");
      return;
    }

    if (!expected.trim()) {
      toast.error("Vui lòng nhập số người dự kiến.");
      return;
    }

    const expectedNumber = Number(expected);

    if (!Number.isInteger(expectedNumber) || expectedNumber < 1 || expectedNumber > 100000) {
      toast.error("Số người dự kiến không hợp lệ.");
      return;
    }

    const radius = Number(checkinRadius);

    if (!radius || radius < 20 || radius > 5000) {
      toast.error("Bán kính check-in phải từ 20m đến 5000m.");
      return;
    }

    setSaving(true);
    setConfigSaveErrors([]);

    const { error } = await supabase
      .from("events")
      .update({
        name: name.trim(),

        description: description.trim() || null,

        location: location.trim() || null,

        starts_at: new Date(startsAt).toISOString(),

        expected_attendees: expectedNumber,

        latitude,
        longitude,

        checkin_radius: radius,
      })
      .eq("id", id);

    if (error) {
      setSaving(false);
      console.error("Update event error:", error);

      toast.error("Không thể cập nhật sự kiện.");

      return;
    }

    // Không gọi RPC cấu hình khi người dùng chỉ sửa tên/mô tả/địa điểm.
    // Cấu hình bắt đầu và Khám phá được lưu riêng, với lỗi thực tế riêng.
    const failedParts: string[] = [];

    if (runReady && eventRunStatus === "upcoming" && startMode !== originalStartMode.current) {
      try {
        const { error: runError } = await supabase.rpc("configure_event_run_mode" as never,
          { p_event_id: id, p_mode: startMode } as never);
        if (runError) throw runError;
        originalStartMode.current = startMode;
      } catch (runError) {
        console.error("Save event start mode error:", runError);
        failedParts.push(`Chế độ bắt đầu: ${getSaveErrorText(runError)}`);
      }
    }

    if (role === "owner" && discoveryReady) {
      const saved = originalDiscovery.current;
      const discoveryChanged = discovery.coverFile !== null || discovery.removeCover || !saved ||
        discovery.category !== saved.category ||
        discovery.coverPath !== saved.coverPath ||
        discovery.showSlots !== saved.showSlots ||
        discovery.enabled !== saved.enabled;
      if (discoveryChanged) {
        try {
          const newCoverPath = await saveEventDiscovery(id, discovery);
          const savedNext: SavedDiscoveryState = {
            category: discovery.category,
            coverPath: newCoverPath,
            showSlots: discovery.showSlots,
            enabled: discovery.enabled,
          };
          originalDiscovery.current = savedNext;
          setDiscovery({ ...savedNext, coverFile: null, removeCover: false });
        } catch (discoveryError) {
          console.error("Save event discovery error:", discoveryError);
          failedParts.push(`Khám phá: ${getSaveErrorText(discoveryError)}`);
        }
      }
    }

    setSaving(false);
    if (failedParts.length > 0) {
      setConfigSaveErrors(failedParts);
      toast.error("Thông tin cơ bản đã lưu. Có cấu hình chưa lưu; xem lỗi ngay trong form.");
      return;
    }
    if (!runReady || (role === "owner" && !discoveryReady)) {
      toast.warning("Đã lưu thông tin cơ bản; cấu hình Khám phá/Bắt đầu tạm thời không khả dụng.");
    } else {
      toast.success("Đã cập nhật sự kiện.");
    }

    navigate({
      to: "/manage-event/$id",
      params: { id },
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (loadError && (role === "owner" || role === "co_owner")) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-xl border border-destructive/30 bg-card p-5 space-y-3">
          <h1 className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-5 w-5 text-destructive" /> Không thể tải sự kiện</h1>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <p className="text-xs text-muted-foreground">Nếu lỗi còn xảy ra, hãy gửi lại nội dung lỗi ở đây để kiểm tra RLS hoặc schema Supabase.</p>
          <Button type="button" onClick={() => window.location.reload()}>Tải lại trang</Button>
        </div>
      </div>
    );
  }

  if (role !== "owner" && role !== "co_owner") {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Không có quyền truy cập</h1>

        <p className="mt-2 text-sm text-muted-foreground">
          Chỉ Owner hoặc Co-owner mới có thể sửa sự kiện.
        </p>

        <Button className="mt-6" asChild>
          <Link to="/manage-event/$id" params={{ id }}>
            Quay lại sự kiện
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-secondary/30 px-3 py-5 sm:px-4 sm:py-12">
      <div className="mx-auto w-full min-w-0 max-w-2xl">
        <Link
          to="/manage-event/$id"
          params={{ id }}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Quay lại sự kiện
        </Link>

        <div className="mt-5 min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm sm:mt-6 sm:p-8">
          <h1 className="font-display text-2xl font-bold">Sửa sự kiện</h1>

          <p className="mt-1 text-sm text-muted-foreground">Cập nhật thông tin của sự kiện.</p>

          {loadWarnings.length > 0 && (
            <div className="mt-5 space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              {loadWarnings.map((message) => <p key={message} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{message}</p>)}
            </div>
          )}
          {configSaveErrors.length > 0 && (
            <div role="alert" className="mt-5 space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <p className="font-semibold">Thông tin cơ bản đã được lưu, nhưng cấu hình sau chưa thành công:</p>
              {configSaveErrors.map((message, index) => <p key={index} className="break-words">• {message}</p>)}
              <p className="text-xs text-muted-foreground">Bạn có thể sửa phần bị lỗi rồi bấm Lưu lại; không cần nhập lại tên hay mô tả.</p>
            </div>
          )}
          <form onSubmit={saveEvent} className="mt-6 min-w-0 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="name">Tên sự kiện *</Label>

              <Input
                id="name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Mô tả</Label>

              <Textarea
                id="description"
                rows={4}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="startsAt">Ngày & giờ *</Label>

              <Input
                id="startsAt"
                type="datetime-local"
                className="block w-full min-w-0 max-w-full"
                value={startsAt}
                disabled={!runReady || eventRunStatus !== "upcoming"}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>

            {runReady && eventRunStatus === "upcoming" ? <EventStartModeFields value={startMode} onChange={setStartMode} /> : (
              <p className="rounded-lg bg-secondary p-3 text-sm text-muted-foreground">Trạng thái sự kiện không cho phép sửa thời gian hoặc chế độ bắt đầu.</p>
            )}
            <div className="space-y-3 rounded-lg border p-4">
              <div>
                <Label>Địa điểm tổ chức</Label>

                <p className="text-xs text-muted-foreground">
                  Tìm địa điểm bằng Google. Bạn cũng có thể kéo ghim hoặc bấm trên bản đồ để chỉnh
                  lại vị trí.
                </p>
              </div>

              <EventLocationPicker
                latitude={latitude}
                longitude={longitude}
                address={location}
                onChange={(lat, lng, newAddress) => {
                  setLatitude(lat);
                  setLongitude(lng);

                  if (newAddress) {
                    setLocation(newAddress);
                  }
                }}
              />

              <div className="space-y-1.5">
                <Label htmlFor="radius">Bán kính check-in</Label>

                <div className="flex items-center gap-2">
                  <Input
                    id="radius"
                    type="number"
                    min={20}
                    max={5000}
                    value={checkinRadius}
                    onChange={(e) => setCheckinRadius(e.target.value)}
                  />

                  <span className="text-sm text-muted-foreground">mét</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expected">Số người dự kiến *</Label>

              <Input
                id="expected"
                type="number"
                required
                min={1}
                max={100000}
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
              />
            </div>

            {role === "owner" && discoveryReady ? <EventDiscoveryFields value={discovery} onChange={setDiscovery} disabled={saving} /> :
              <p className="text-xs text-muted-foreground">{role !== "owner" ? "Chỉ Owner được chỉnh thông tin Khám phá." : "Cấu hình Khám phá tạm thời không khả dụng; vẫn có thể lưu thông tin cơ bản."}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Lưu thay đổi
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
