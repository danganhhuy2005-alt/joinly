import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Compass,
  Info,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Ticket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Participation = {
  participant_id: string;
  event_id: string;
  event_name: string;
  event_location: string | null;
  event_starts_at: string | null;
  room_name: string;
  attendee_name: string;
  checked_in: boolean;
  checked_out_at: string | null;
  confirmation_token: string;
};

type Filter = "all" | "upcoming" | "started";

// UI-only preview records. Never returned as real tickets and never saved to Supabase.
const previewRecords: Participation[] = [
  {
    participant_id: "demo-1",
    event_id: "demo-event-1",
    event_name: "Workshop Công nghệ và AI",
    event_location: "Hội trường A — Minh họa",
    event_starts_at: "2030-11-15T08:30:00+07:00",
    room_name: "Phòng chính",
    attendee_name: "Người tham gia mẫu",
    checked_in: false,
    checked_out_at: null,
    confirmation_token: "",
  },
  {
    participant_id: "demo-2",
    event_id: "demo-event-2",
    event_name: "Ngày hội giao lưu sinh viên",
    event_location: "Trung tâm sinh hoạt — Minh họa",
    event_starts_at: "2025-07-18T09:00:00+07:00",
    room_name: "Khu A",
    attendee_name: "Người tham gia mẫu",
    checked_in: true,
    checked_out_at: null,
    confirmation_token: "",
  },
];

export const Route = createFileRoute("/_authenticated/my-participations")({
  head: () => ({ meta: [{ title: "Sự kiện tôi tham gia — Joinly" }] }),
  component: MyParticipations,
});

function dateLabel(raw: string | null) {
  if (!raw) return "Chưa có thời gian";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "Chưa có thời gian";
  return date.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" });
}

function isStarted(row: Participation) {
  if (!row.event_starts_at) return false;
  const timestamp = new Date(row.event_starts_at).getTime();
  return Number.isFinite(timestamp) && timestamp < Date.now();
}

function MyParticipations() {
  const [records, setRecords] = useState<Participation[]>([]);
  const [accountEmail, setAccountEmail] = useState("");
  const [isVerified, setIsVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"rpc_missing" | "other" | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [preview, setPreview] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw authError ?? new Error("No user");

      const user = authData.user;
      setAccountEmail(user.email ?? "");
      const verified = Boolean(user.email && user.email_confirmed_at);
      setIsVerified(verified);

      if (!verified) {
        setRecords([]);
        return;
      }

      // SECURITY: This RPC is authenticated-only and compares the verified
      // email of auth.uid() on the database. Never query all participants
      // from the browser or accept a client-provided email for ticket lookup.
      const { data, error: rpcError } = await supabase.rpc("get_my_participations" as never);
      if (rpcError) {
        setError(rpcError.code === "PGRST202" || rpcError.code === "42883" ? "rpc_missing" : "other");
        setRecords([]);
        return;
      }
      setRecords((data ?? []) as Participation[]);
    } catch {
      setError("other");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const displayed = preview ? previewRecords : records;
  const upcomingCount = displayed.filter((record) => !isStarted(record)).length;
  const checkedInCount = displayed.filter((record) => record.checked_in).length;
  const visible = displayed.filter((record) => {
    if (filter === "upcoming") return !isStarted(record);
    if (filter === "started") return isStarted(record);
    return true;
  });

  return (
    <div className="min-h-screen bg-secondary/30">
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="overflow-hidden rounded-3xl border border-border bg-card">
          <div className="flex flex-col gap-5 bg-linear-to-br from-primary/12 via-primary/5 to-transparent p-6 sm:p-9 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Ticket className="h-3.5 w-3.5" /> Không gian người tham gia
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                Sự kiện tôi tham gia
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Một tài khoản Joinly cho cả việc tổ chức lẫn tham dự sự kiện. Vé và lịch sử
                được đồng bộ theo email đã xác minh của bạn.
              </p>
              {accountEmail && (
                <div className="mt-4 inline-flex max-w-full items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">Tài khoản: {accountEmail}</span>
                </div>
              )}
            </div>
            <div className="flex gap-2 md:flex-col">
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Làm mới
              </Button>
              <Button variant="secondary" onClick={() => { setPreview((value) => !value); setFilter("all"); }}>
                <Compass className="h-4 w-4" />
                {preview ? "Tắt xem thử" : "Xem giao diện mẫu"}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-border p-4 sm:gap-5 sm:p-6">
            {[
              { label: "Sự kiện đăng ký", value: displayed.length, icon: Ticket },
              { label: "Chưa đến ngày", value: upcomingCount, icon: Clock3 },
              { label: "Đã check-in", value: checkedInCount, icon: CheckCircle2 },
            ].map((item) => (
              <div className="rounded-2xl bg-secondary/60 px-3 py-4 sm:px-5" key={item.label}>
                <item.icon className="mb-2 h-5 w-5 text-primary" />
                <p className="font-display text-2xl font-bold tabular-nums">{item.value}</p>
                <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{item.label}</p>
              </div>
            ))}
          </div>
        </div>

        {preview && (
          <div className="mt-5 flex gap-2 rounded-2xl border border-amber-300/50 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            Đang xem dữ liệu minh họa. Các sự kiện này không tồn tại trên hệ thống, không có vé QR và không liên quan tài khoản của bạn.
          </div>
        )}

        {!preview && !loading && !isVerified && (
          <div className="mt-5 rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
            Email của tài khoản chưa được xác minh. Vui lòng xác minh email trước khi xem vé và lịch sử tham gia.
          </div>
        )}

        {!preview && !loading && isVerified && error && (
          <div className="mt-5 rounded-2xl border border-destructive/30 bg-card p-5">
            <p className="font-semibold">Chưa thể đồng bộ danh sách tham gia</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {error === "rpc_missing"
                ? "Supabase chưa có RPC get_my_participations. Cần triển khai migration đi kèm ZIP trước khi sử dụng vé đồng bộ."
                : "Có lỗi khi tải danh sách. Vui lòng thử lại; hệ thống không tự ý hiển thị vé của tài khoản khác."}
            </p>
            <Button variant="outline" className="mt-3" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Thử lại
            </Button>
          </div>
        )}

        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-bold">Danh sách của tôi</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Các sự kiện bạn đã đăng ký bằng email tài khoản Joinly
              </p>
            </div>
            <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
              {([
                ["all", "Tất cả"],
                ["upcoming", "Sắp tới"],
                ["started", "Đã đến ngày"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition sm:text-sm ${
                    filter === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading && !preview ? (
            <div className="mt-5 flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-12 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Đang tải vé của bạn...
            </div>
          ) : visible.length === 0 ? (
            <div className="mt-5 flex flex-col items-center rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10">
                <Ticket className="h-7 w-7 text-primary" />
              </div>
              <h3 className="mt-4 font-display text-lg font-bold">
                {filter === "all" ? "Chưa có sự kiện trong danh sách" : "Không có sự kiện ở mục này"}
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Tham gia sự kiện qua đường dẫn hoặc QR của BTC và nhập đúng email tài khoản đã xác minh. Khi đồng bộ được bật, vé sẽ xuất hiện ở đây trên mọi thiết bị.
              </p>
              {!preview && (
                <Button variant="outline" className="mt-5" onClick={() => { setPreview(true); setFilter("all"); }}>
                  Xem thử giao diện <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {visible.map((record) => (
                <article key={record.participant_id} className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md sm:p-6">
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                      {record.checked_out_at ? "Đã check-out" : record.checked_in ? "Đã check-in" : "Đã đăng ký"}
                    </span>
                    {preview && <span className="text-xs text-amber-700 dark:text-amber-300">Mẫu</span>}
                  </div>
                  <h3 className="mt-4 font-display text-xl font-bold leading-tight">{record.event_name}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{record.attendee_name} · {record.room_name}</p>
                  <div className="mt-5 space-y-2 text-sm text-muted-foreground">
                    <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 shrink-0" /> {dateLabel(record.event_starts_at)}</p>
                    {record.event_location && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0" /> {record.event_location}</p>}
                  </div>
                  <div className="mt-auto border-t border-border pt-5" style={{ marginTop: "1.5rem" }}>
                    {preview ? (
                      <Button variant="outline" disabled className="w-full">Vé QR không có trong dữ liệu mẫu</Button>
                    ) : (
                      <Button asChild className="w-full">
                        <Link to="/join/$id/confirm/$token" params={{ id: record.event_id, token: record.confirmation_token }}>
                          <Ticket className="h-4 w-4" /> Xem vé QR của tôi <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="mt-8 flex gap-3 rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-semibold text-foreground">Bảo mật và phân quyền</p>
            <p className="mt-1 leading-6">
              Chuyển chế độ không cấp thêm quyền quản lý. Người tổ chức vẫn được xác thực theo vai trò riêng ở từng sự kiện. Khách không đăng nhập vẫn có thể dùng QR của BTC như trước.
            </p>
            <p className="mt-1 leading-6">Nếu đã đăng ký bằng email khác, vé sẽ không tự động liên kết với tài khoản này.</p>
          </div>
        </aside>
      </main>
    </div>
  );
}
