import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Bug, ExternalLink, Loader2, RefreshCcw, Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BUG_AREAS, BUG_STATUS_LABELS, getBugScreenshotPaths, isPlatformAdmin, openBugScreenshot, platformDb, type BugReport, type BugStatus, type PlatformReview } from "@/lib/platform-support";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/platform-support-admin")({
  head: () => ({ meta: [{ title: "Tiếp nhận phản hồi — Joinly Admin" }] }),
  component: PlatformSupportAdminPage,
});

const STATUSES: BugStatus[] = ["new", "in_progress", "resolved", "closed"];

function PlatformSupportAdminPage() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"bugs" | "reviews">("bugs");
  const [bugs, setBugs] = useState<BugReport[]>([]);
  const [reviews, setReviews] = useState<PlatformReview[]>([]);
  const [message, setMessage] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { status: BugStatus; admin_response: string }>>({});

  const reload = async () => {
    const [bugsResult, reviewsResult] = await Promise.all([
      platformDb.from("platform_bug_reports")
        .select("id,user_id,title,area,description,steps_to_reproduce,screenshot_path,screenshot_paths,status,admin_response,created_at,updated_at")
        .order("created_at", { ascending: false }).limit(200),
      platformDb.from("platform_reviews")
        .select("user_id,website_rating,ui_rating,performance_rating,features_rating,comment,created_at,updated_at")
        .order("updated_at", { ascending: false }).limit(200),
    ]);
    if (bugsResult.error || reviewsResult.error) throw new Error(bugsResult.error?.message || reviewsResult.error?.message || "Không tải được dữ liệu.");
    const nextBugs = (bugsResult.data ?? []) as BugReport[];
    setBugs(nextBugs);
    setReviews((reviewsResult.data ?? []) as PlatformReview[]);
    setDrafts(Object.fromEntries(nextBugs.map(bug => [bug.id, {status: bug.status, admin_response: bug.admin_response ?? ""}])));
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const allowed = await isPlatformAdmin(user.id);
      if (cancelled) return;
      setAuthorized(allowed);
      if (allowed) {
        try { await reload(); }
        catch (err) { if (!cancelled) setMessage(err instanceof Error ? err.message : "Không tải được phản hồi."); }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const saveBug = async (bug: BugReport) => {
    const draft = drafts[bug.id];
    if (!draft || updating) return;
    setUpdating(bug.id);
    const { error } = await platformDb.from("platform_bug_reports")
      .update({ status: draft.status, admin_response: draft.admin_response.trim() || null })
      .eq("id", bug.id);
    setUpdating(null);
    if (error) { setMessage(error.message); toast.error("Không cập nhật được báo cáo."); return; }
    toast.success("Đã cập nhật trạng thái và phản hồi.");
    setMessage("");
    try { await reload(); }
    catch (err) { setMessage(err instanceof Error ? err.message : "Không tải lại được dữ liệu."); }
  };

  const showImage = async (path: string) => {
    const viewer = window.open("", "_blank");
    try {
      const url = await openBugScreenshot(path);
      if (viewer) { viewer.opener = null; viewer.location.href = url; }
      else window.location.assign(url);
    } catch (err) { viewer?.close(); toast.error(err instanceof Error ? err.message : "Không xem được ảnh."); }
  };

  if (loading) return <main className="mx-auto max-w-5xl p-8"><Loader2 className="h-6 w-6 animate-spin"/></main>;
  if (!authorized) return <main className="mx-auto max-w-2xl space-y-3 p-8"><h1 className="text-xl font-bold">Không có quyền truy cập</h1><p className="text-sm text-muted-foreground">Trang chỉ dành cho quản trị viên nền tảng Joinly. Quyền được kiểm tra bởi Supabase.</p><Button asChild variant="outline"><Link to="/my-events">Về Sự kiện của tôi</Link></Button></main>;
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" asChild><Link to="/my-events"><ArrowLeft className="mr-2 h-4 w-4"/> Sự kiện của tôi</Link></Button>
        <Button variant="outline" onClick={() => void reload().catch(err => setMessage(String(err)))}><RefreshCcw className="mr-2 h-4 w-4"/> Tải lại</Button>
      </div>
      <div><h1 className="text-2xl font-bold sm:text-3xl">Trung tâm phản hồi Joinly</h1><p className="mt-1 text-sm text-muted-foreground">Quản trị viên nền tảng · dữ liệu riêng tư, không dành cho BTC khác.</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant={activeTab === "bugs" ? "default" : "outline"} onClick={() => setActiveTab("bugs")}><Bug className="mr-2 h-4 w-4"/> Báo lỗi ({bugs.length})</Button>
        <Button variant={activeTab === "reviews" ? "default" : "outline"} onClick={() => setActiveTab("reviews")}><Star className="mr-2 h-4 w-4"/> Đánh giá website ({reviews.length})</Button>
      </div>
      {message && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{message}</p>}
      {activeTab === "bugs" ? <section className="space-y-4">
        {bugs.length === 0 && <p className="text-sm text-muted-foreground">Chưa có báo lỗi.</p>}
        {bugs.map(bug => {
          const draft = drafts[bug.id] ?? { status: bug.status, admin_response: bug.admin_response ?? "" };
          return <article key={bug.id} className="space-y-3 rounded-2xl border bg-card p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="font-semibold">{bug.title}</h2><p className="text-xs text-muted-foreground">{BUG_AREAS.find(a=>a.value===bug.area)?.label ?? bug.area} · {new Date(bug.created_at).toLocaleString("vi-VN")}</p></div>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs">{BUG_STATUS_LABELS[bug.status]}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{bug.description}</p>
            {bug.steps_to_reproduce && <div className="rounded-lg bg-muted/50 p-3 text-sm"><strong>Cách tái hiện:</strong><p className="mt-1 whitespace-pre-wrap">{bug.steps_to_reproduce}</p></div>}
            {getBugScreenshotPaths(bug).length > 0 && <div className="flex flex-wrap gap-2">
              {getBugScreenshotPaths(bug).map((path, i) => <Button key={`${path}-${i}`} size="sm" variant="outline"
                onClick={() => void showImage(path)}><ExternalLink className="mr-2 h-4 w-4"/> Ảnh {i + 1}</Button>)}
            </div>}
            <div className="grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
              <div className="space-y-1"><label className="text-sm font-medium" htmlFor={`status-${bug.id}`}>Trạng thái</label>
                <select id={`status-${bug.id}`} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.status} onChange={e=>setDrafts(prev=>({...prev,[bug.id]:{...draft,status:e.target.value as BugStatus}}))}>
                  {STATUSES.map(status=><option key={status} value={status}>{BUG_STATUS_LABELS[status]}</option>)}
                </select>
              </div>
              <div className="space-y-1"><label className="text-sm font-medium" htmlFor={`reply-${bug.id}`}>Phản hồi cho người báo</label>
                <Textarea id={`reply-${bug.id}`} maxLength={3000} rows={2} value={draft.admin_response} onChange={e=>setDrafts(prev=>({...prev,[bug.id]:{...draft,admin_response:e.target.value}}))} placeholder="Đã xác nhận lỗi, đang kiểm tra..."/>
              </div>
              <Button disabled={updating !== null} onClick={() => void saveBug(bug)}>{updating===bug.id?<Loader2 className="mr-1 h-4 w-4 animate-spin"/>:null} Lưu xử lý</Button>
            </div>
          </article>;
        })}
      </section> : <section className="space-y-3">
        {reviews.length === 0 && <p className="text-sm text-muted-foreground">Chưa có đánh giá.</p>}
        {reviews.map(review=><article key={review.user_id} className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><strong className="flex items-center gap-1"><Star className="h-4 w-4 fill-amber-400 text-amber-500"/> {review.website_rating}/5 sao</strong><span className="text-xs text-muted-foreground">{new Date(review.updated_at).toLocaleString("vi-VN")}</span></div>
          <p className="mt-2 text-xs text-muted-foreground">Giao diện: {review.ui_rating ?? "—"}/5 · Tốc độ: {review.performance_rating ?? "—"}/5 · Tính năng: {review.features_rating ?? "—"}/5</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{review.comment || "(Không có nhận xét)"}</p>
        </article>)}
      </section>}
      <p className="text-xs text-muted-foreground">Hiển thị tối đa 200 mục gần nhất mỗi loại. Có thể bổ sung phân trang khi có nhiều phản hồi.</p>
    </main>
  );
}
