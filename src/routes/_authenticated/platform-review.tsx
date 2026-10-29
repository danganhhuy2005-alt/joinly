import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Save, Star, ArrowLeft, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { platformDb, type PlatformReview } from "@/lib/platform-support";
import { getWorkspaceMode } from "@/lib/workspace-mode";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/platform-review")({
  head: () => ({ meta: [{ title: "Đánh giá Joinly — Người tổ chức" }] }),
  component: PlatformReviewPage,
});

function RatingStars({ value, onChange, label }: {value:number;onChange:(value:number)=>void;label:string}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-1" role="group" aria-label={label}>
        {[1,2,3,4,5].map((star) => (
          <button key={star} type="button" aria-label={`${star} sao`} aria-pressed={value === star}
            onClick={() => onChange(value === star ? 0 : star)}
            className="rounded-md p-1 transition hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <Star className={`h-6 w-6 ${star <= value ? "fill-amber-400 text-amber-500" : "text-muted-foreground/40"}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

function PlatformReviewPage() {
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [rating, setRating] = useState(0);
  const [uiRating, setUiRating] = useState(0);
  const [performanceRating, setPerformanceRating] = useState(0);
  const [featuresRating, setFeaturesRating] = useState(0);
  const [comment, setComment] = useState("");
  const [organizerMode, setOrganizerMode] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      if (getWorkspaceMode(user.id) !== "organizer") {
        setOrganizerMode(false); setLoading(false); return;
      }
      setUserId(user.id);
      const { data, error } = await platformDb.from("platform_reviews")
        .select("user_id,website_rating,ui_rating,performance_rating,features_rating,comment,created_at,updated_at")
        .eq("user_id", user.id).maybeSingle();
      if (cancelled) return;
      if (error) setErrorText(`Không tải được đánh giá: ${error.message}`);
      const old = data as PlatformReview | null;
      if (old) {
        setRating(old.website_rating); setUiRating(old.ui_rating ?? 0);
        setPerformanceRating(old.performance_rating ?? 0);
        setFeaturesRating(old.features_rating ?? 0);
        setComment(old.comment ?? ""); setSavedAt(old.updated_at);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    if (!userId || rating === 0 || saving) return;
    if (comment.length > 3000) { toast.error("Nhận xét tối đa 3.000 ký tự."); return; }
    setSaving(true); setErrorText("");
    const { error } = await platformDb.from("platform_reviews").upsert({
      user_id: userId, website_rating: rating, ui_rating: uiRating || null,
      performance_rating: performanceRating || null, features_rating: featuresRating || null,
      comment: comment.trim(),
    }, { onConflict: "user_id" });
    setSaving(false);
    if (error) { setErrorText(error.message); toast.error("Chưa lưu được đánh giá."); return; }
    setSavedAt(new Date().toISOString());
    toast.success("Đã lưu đánh giá Joinly. Cảm ơn bạn!");
  };

  if (loading) return <div className="mx-auto max-w-3xl p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!organizerMode) return <main className="mx-auto max-w-2xl p-6">Chuyển sang chế độ <strong>Người tổ chức</strong> trong menu Avatar để gửi đánh giá Joinly.</main>;
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <Button variant="ghost" asChild><Link to="/my-events"><ArrowLeft className="mr-2 h-4 w-4"/> Sự kiện của tôi</Link></Button>
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Đánh giá website Joinly</h1>
        <p className="mt-2 text-sm text-muted-foreground">Dành cho người tổ chức. Đánh giá trải nghiệm sử dụng nền tảng, không phải Feedback của sự kiện.</p>
      </div>
      <section className="space-y-6 rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
        <RatingStars label="Đánh giá tổng thể *" value={rating} onChange={setRating} />
        <div className="space-y-4 rounded-xl bg-muted/40 p-4">
          <p className="text-sm font-semibold">Đánh giá chi tiết (không bắt buộc)</p>
          <RatingStars label="Giao diện, dễ sử dụng" value={uiRating} onChange={setUiRating} />
          <RatingStars label="Tốc độ, ổn định" value={performanceRating} onChange={setPerformanceRating} />
          <RatingStars label="Tính năng tổ chức" value={featuresRating} onChange={setFeaturesRating} />
        </div>
        <div className="space-y-2">
          <label htmlFor="platform-comment" className="text-sm font-medium">Góp ý / Đề xuất cải thiện</label>
          <Textarea id="platform-comment" rows={5} maxLength={3000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Điểm bạn thích, điều cần cải thiện, tính năng nên có thêm..." />
          <p className="text-right text-xs text-muted-foreground">{comment.length}/3000</p>
        </div>
        {errorText && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errorText}</p>}
        {savedAt && <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-green-600"/>Đã lưu đánh giá; bạn có thể chỉnh lại bất cứ lúc nào.</p>}
        <Button disabled={!rating || saving || !userId} onClick={() => void save()} className="w-full sm:w-auto">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4"/>} {savedAt ? "Cập nhật đánh giá" : "Gửi đánh giá"}
        </Button>
      </section>
    </main>
  );
}
