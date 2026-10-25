import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight, CalendarDays, Compass, Image as ImageIcon, Info,
  Loader2, MapPin, RefreshCw, Search, ShieldCheck, Ticket, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  DISCOVERY_CATEGORIES, discoveryCategoryLabel, discoveryCoverUrl,
} from "@/lib/discovery";

type DiscoverEvent = {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  starts_at: string | null;
  discovery_category: string;
  discovery_cover_path: string | null;
  remaining_seats: number | null;
  run_status?: "upcoming" | "live" | "ended";
};
type DateScope = "all" | "week" | "month";
const SAMPLE_EVENTS: DiscoverEvent[] = [
  {
    id: "sample-tech", name: "Workshop AI & Công nghệ — Minh họa",
    description: "Buổi trải nghiệm công nghệ dành cho cộng đồng (dữ liệu mẫu).",
    location: "TP. Hồ Chí Minh (mẫu)", starts_at: "2030-11-15T08:30:00+07:00",
    discovery_category: "technology", discovery_cover_path: null, remaining_seats: 35,
  },
  {
    id: "sample-workshop", name: "Workshop Móc len — Minh họa",
    description: "Khám phá một hoạt động sáng tạo cuối tuần (dữ liệu mẫu).",
    location: "Cần Thơ (mẫu)", starts_at: "2030-11-20T09:00:00+07:00",
    discovery_category: "workshop", discovery_cover_path: null, remaining_seats: null,
  },
];

export const Route = createFileRoute("/_authenticated/discover")({
  head: () => ({ meta: [{ title: "Khám phá sự kiện — Joinly" }] }),
  component: DiscoverPage,
});

function formatDate(value: string | null) {
  if (!value) return "Thời gian đang cập nhật";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })
    : "Thời gian đang cập nhật";
}

function DiscoverPage() {
  const [events, setEvents] = useState<DiscoverEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<DateScope>("all");
  const [category, setCategory] = useState("all");
  const [preview, setPreview] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(false);
    const { data, error: rpcError } = await supabase.rpc("list_discoverable_events" as never);
    if (rpcError) {
      setError(true);
      setEvents([]);
    } else {
      setEvents((data ?? []) as DiscoverEvent[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadEvents(); }, [loadEvents]);

  const source = preview ? SAMPLE_EVENTS : events;
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("vi-VN");
    const now = Date.now();
    const end = scope === "week" ? now + 7 * 86400000 : now + 31 * 86400000;
    return source.filter((item) => {
      if (category !== "all" && item.discovery_category !== category) return false;
      if (keyword) {
        const searchable = [item.name, item.description, item.location,
          discoveryCategoryLabel(item.discovery_category)]
          .filter(Boolean).join(" ").toLocaleLowerCase("vi-VN");
        if (!searchable.includes(keyword)) return false;
      }
      if (scope !== "all") {
        const time = item.starts_at ? new Date(item.starts_at).getTime() : NaN;
        if (!Number.isFinite(time) || (time < now && item.run_status !== "live") || time > end) return false;
      }
      return true;
    });
  }, [source, category, query, scope]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-secondary/30">
      <main className="mx-auto w-full min-w-0 max-w-6xl px-3 py-5 sm:px-6 sm:py-10">
        <section className="overflow-hidden rounded-3xl border border-border bg-card">
          <div className="bg-linear-to-br from-primary/15 via-primary/5 to-card p-4 sm:p-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Compass className="h-3.5 w-3.5" /> Sự kiện công khai trên Joinly
            </div>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl">Khám phá sự kiện</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Tìm workshop, hội thảo và hoạt động phù hợp. Chỉ sự kiện được BTC chủ động công khai mới xuất hiện tại đây.
            </p>
            <div className="mt-5 flex flex-col gap-2 min-[360px]:flex-row min-[360px]:flex-wrap">
              <Button asChild variant="outline" className="w-full min-[360px]:w-auto"><Link to="/my-participations"><Ticket className="h-4 w-4" /> Vé của tôi</Link></Button>
              <Button variant="secondary" className="w-full min-[360px]:w-auto" onClick={() => {
                setPreview((value) => !value); setQuery(""); setCategory("all"); setScope("all");
              }}><Info className="h-4 w-4" /> {preview ? "Tắt dữ liệu mẫu" : "Xem dữ liệu mẫu"}</Button>
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 border-t border-border p-3 sm:grid-cols-[minmax(0,1fr)_170px_150px_auto] sm:p-5">
            <div className="relative min-w-0">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="w-full min-w-0 pl-9" value={query} onChange={(event) => setQuery(event.target.value)}
                placeholder="Tên, chủ đề, địa điểm..." aria-label="Tìm sự kiện" />
            </div>
            <select value={category} onChange={(event) => setCategory(event.target.value)}
              aria-label="Lọc chủ đề" className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground">
              <option value="all">Mọi chủ đề</option>
              {DISCOVERY_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select value={scope} onChange={(event) => setScope(event.target.value as DateScope)}
              aria-label="Lọc ngày" className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground">
              <option value="all">Tất cả ngày</option>
              <option value="week">7 ngày tới</option>
              <option value="month">31 ngày tới</option>
            </select>
            <Button className="w-full sm:w-auto" variant="outline" disabled={loading} onClick={() => void loadEvents()}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Làm mới
            </Button>
          </div>
        </section>

        {preview && <div className="mt-5 rounded-2xl border border-amber-300/50 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <Info className="mr-2 inline h-4 w-4" /> Đây là sự kiện minh họa, không thể đăng ký.
        </div>}
        <div className="mt-8 flex items-end justify-between">
          <div><h2 className="font-display text-xl font-bold">Sự kiện đang & sắp diễn ra</h2>
            <p className="mt-1 text-sm text-muted-foreground">{filtered.length} sự kiện phù hợp</p></div>
        </div>
        {!preview && loading ? (
          <div className="mt-8 flex justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Đang tải sự kiện...</div>
        ) : !preview && error ? (
          <div className="mt-5 rounded-2xl border border-destructive/30 bg-card p-6 text-sm">
            <p className="font-semibold">Chưa thể tải dữ liệu Khám phá</p>
            <p className="mt-2 text-muted-foreground">Cần chạy migration Khám phá giai đoạn 1 trên Supabase.</p>
            <Button className="mt-4" variant="outline" onClick={() => void loadEvents()}>Thử lại</Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-border bg-card p-10 text-center">
            <Compass className="mx-auto h-9 w-9 text-primary" />
            <h3 className="mt-3 font-semibold">Chưa có sự kiện phù hợp</h3>
            <p className="mt-2 text-sm text-muted-foreground">Bạn có thể bỏ bộ lọc hoặc thử lại sau khi BTC công khai sự kiện.</p>
          </div>
        ) : (
          <div className="mt-5 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => {
              const coverUrl = preview ? null : discoveryCoverUrl(item.discovery_cover_path);
              return (
                <article key={item.id} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
                  <div className="relative flex h-44 items-end overflow-hidden bg-linear-to-br from-primary/25 via-primary/10 to-secondary">
                    {coverUrl ? <img src={coverUrl} alt={`Ảnh bìa ${item.name}`} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                      : <ImageIcon className="absolute right-5 top-5 h-16 w-16 text-primary/20" />}
                    <span className="relative m-4 rounded-full bg-background/95 px-3 py-1 text-xs font-semibold text-foreground">
                      {discoveryCategoryLabel(item.discovery_category)}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    {item.run_status === "live" && <span className="mb-2 w-fit rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-700 dark:text-green-300">Đang diễn ra</span>}
                    <h3 className="break-words font-display text-lg font-bold leading-6">{item.name}</h3>
                    <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{item.description?.trim() || "BTC chưa thêm giới thiệu."}</p>
                    <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                      <p className="flex items-start gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0" /> {formatDate(item.starts_at)}</p>
                      <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {item.location || "Địa điểm đang cập nhật"}</p>
                      {item.remaining_seats !== null && <p className="flex items-center gap-2"><Users className="h-4 w-4 shrink-0" /> {item.remaining_seats > 0 ? `Khoảng ${item.remaining_seats} suất còn lại` : "Đã đủ suất"}</p>}
                    </div>
                    <div className="mt-auto pt-5">
                      {preview ? <Button className="w-full" variant="outline" disabled>Dữ liệu mẫu</Button>
                        : <Button asChild className="w-full"><Link to="/join/$id" params={{ id: item.id }}>
                            Xem chi tiết & đăng ký <ArrowRight className="h-4 w-4" />
                          </Link></Button>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <aside className="mt-8 flex gap-3 rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p>Sự kiện công khai do BTC chủ động đăng. Đăng ký tiếp tục qua hệ thống phòng, vé QR và giới hạn người tham gia hiện có của Joinly.</p>
        </aside>
      </main>
    </div>
  );
}
