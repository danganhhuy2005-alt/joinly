import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Bug, CheckCircle2, ImagePlus, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getWorkspaceMode } from "@/lib/workspace-mode";
import { BUG_AREAS, BUG_IMAGE_BUCKET, platformDb } from "@/lib/platform-support";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/platform-report-bug")({
  head: () => ({ meta: [{ title: "Báo lỗi Joinly — Người tổ chức" }] }),
  component: BugReportPage,
});

const ACCEPTED_MIME = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type SelectedScreenshot = { id: string; file: File; previewUrl: string };

function BugReportPage() {
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [organizerMode, setOrganizerMode] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [title, setTitle] = useState("");
  const [area, setArea] = useState<string>("event_management");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [images, setImages] = useState<SelectedScreenshot[]>([]);
  const previewUrlsRef = useRef<Set<string>>(new Set());

  // URLs are local previews only; files are not uploaded until the form is submitted.
  useEffect(() => () => {
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    previewUrlsRef.current.clear();
  }, []);

  const clearImages = () => {
    for (const image of images) {
      URL.revokeObjectURL(image.previewUrl);
      previewUrlsRef.current.delete(image.previewUrl);
    }
    setImages([]);
  };

  const removeImage = (id: string) => {
    const found = images.find(image => image.id === id);
    if (!found) return;
    URL.revokeObjectURL(found.previewUrl);
    previewUrlsRef.current.delete(found.previewUrl);
    setImages(images.filter(image => image.id !== id));
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user || getWorkspaceMode(user.id) !== "organizer") {
        setOrganizerMode(false); setLoading(false); return;
      }
      setUserId(user.id);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(event.currentTarget.files ?? []);
    // Reset so the user can select the same file again after removing it.
    event.currentTarget.value = "";
    if (!incoming.length) return;

    const next = [...images];
    let invalidCount = 0;
    let skippedCount = 0;
    for (const file of incoming) {
      if (!ACCEPTED_MIME.includes(file.type) || file.size > MAX_IMAGE_BYTES || file.size === 0) {
        invalidCount++;
        continue;
      }
      // Avoid including the same selected local file twice.
      if (next.some(image => image.file.name === file.name && image.file.size === file.size && image.file.lastModified === file.lastModified)) {
        skippedCount++;
        continue;
      }
      if (next.length >= MAX_IMAGES) { skippedCount++; continue; }
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      next.push({ id: crypto.randomUUID(), file, previewUrl });
    }
    setImages(next);
    if (invalidCount) toast.error(`${invalidCount} ảnh không hợp lệ. Chỉ nhận JPG/PNG/WebP, tối đa 5 MB mỗi ảnh.`);
    if (skippedCount) toast.info(`Chỉ chọn tối đa ${MAX_IMAGES} ảnh, không thêm ảnh trùng.`);
  };

  const send = async () => {
    if (!userId || saving) return;
    if (title.trim().length < 8 || description.trim().length < 20) {
      toast.error("Tiêu đề cần ít nhất 8 ký tự, mô tả ít nhất 20 ký tự."); return;
    }
    setSaving(true); setErrorText("");
    const uploadedPaths: string[] = [];
    let reportSaved = false;
    try {
      for (const image of images) {
        const file = image.file;
        const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        const path = `${userId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from(BUG_IMAGE_BUCKET)
          .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
        if (uploadError) throw new Error(`Không tải được ảnh ${file.name}: ${uploadError.message}`);
        uploadedPaths.push(path);
      }
      const { error } = await platformDb.from("platform_bug_reports").insert({
        user_id: userId, title: title.trim(), area, description: description.trim(),
        steps_to_reproduce: steps.trim() || null,
        screenshot_path: uploadedPaths[0] ?? null, // Legacy clients can still display the first screenshot.
        screenshot_paths: uploadedPaths,
      });
      if (error) throw error;
      reportSaved = true;
      setTitle(""); setDescription(""); setSteps(""); clearImages();
      setSubmitted(true);
      toast.success("Cảm ơn bạn đã báo lỗi cho Joinly!");
    } catch (err) {
      // Do not remove screenshots after a report has already been stored successfully.
      if (!reportSaved && uploadedPaths.length) {
        await supabase.storage.from(BUG_IMAGE_BUCKET).remove(uploadedPaths);
      }
      const message = err instanceof Error ? err.message : "Không gửi được báo lỗi.";
      setErrorText(message); toast.error("Chưa gửi được báo lỗi.");
    } finally { setSaving(false); }
  };

  if (loading) return <main className="mx-auto max-w-4xl p-8"><Loader2 className="h-6 w-6 animate-spin"/></main>;
  if (!organizerMode) return <main className="mx-auto max-w-2xl p-6">Chuyển sang chế độ <strong>Người tổ chức</strong> trong menu Avatar để báo lỗi Joinly.</main>;
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <Button asChild variant="ghost"><Link to="/my-events"><ArrowLeft className="mr-2 h-4 w-4"/> Sự kiện của tôi</Link></Button>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl"><Bug className="h-7 w-7 text-destructive"/> Báo lỗi Joinly</h1>
        <p className="mt-2 text-sm text-muted-foreground">Lỗi của website hoặc công cụ tổ chức sự kiện? Gửi cho đội ngũ Joinly để được kiểm tra. Không nhập mật khẩu hay mã truy cập trong mô tả/ảnh.</p>
      </div>
      {submitted ? (
        <section role="status" aria-live="polite" className="mx-auto max-w-2xl space-y-5 rounded-2xl border bg-card p-6 text-center shadow-sm sm:p-10">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
            <CheckCircle2 aria-hidden="true" className="h-9 w-9 text-emerald-500" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold sm:text-2xl">Cảm ơn bạn đã báo lỗi!</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Joinly đã tiếp nhận báo cáo của bạn. Đội ngũ phát triển sẽ xem xét để cải thiện website.
            </p>
          </div>
          <div className="flex flex-col justify-center gap-2 sm:flex-row">
            <Button type="button" onClick={() => { setSubmitted(false); setArea("event_management"); setErrorText(""); }}>
              <Bug className="mr-2 h-4 w-4" /> Báo lỗi khác
            </Button>
            <Button asChild variant="outline"><Link to="/my-events">Về Sự kiện của tôi</Link></Button>
          </div>
        </section>
      ) : (
      <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
        <h2 className="text-lg font-semibold">Gửi báo cáo mới</h2>
        <div className="space-y-1"><label htmlFor="bug-area" className="text-sm font-medium">Khu vực gặp lỗi</label>
          <select id="bug-area" className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={area} onChange={e => setArea(e.target.value)}>
            {BUG_AREAS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <div className="space-y-1"><label htmlFor="bug-title" className="text-sm font-medium">Tiêu đề *</label>
          <Input id="bug-title" maxLength={140} value={title} onChange={e => setTitle(e.target.value)} placeholder="Ví dụ: Không tải được mã QR phòng"/>
        </div>
        <div className="space-y-1"><label htmlFor="bug-detail" className="text-sm font-medium">Mô tả lỗi *</label>
          <Textarea id="bug-detail" rows={4} maxLength={5000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Bạn gặp lỗi gì? Điều gì xảy ra thay vì kết quả mong muốn?"/>
        </div>
        <div className="space-y-1"><label htmlFor="bug-steps" className="text-sm font-medium">Các bước tái hiện (không bắt buộc)</label>
          <Textarea id="bug-steps" rows={3} maxLength={3000} value={steps} onChange={e => setSteps(e.target.value)} placeholder="1. Vào Quản lý sự kiện... 2. Bấm..."/>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="bug-image" className="flex items-center gap-2 text-sm font-medium">
              <ImagePlus className="h-4 w-4"/> Ảnh chụp màn hình (tối đa 5 ảnh)
            </label>
            <span className="text-xs text-muted-foreground">{images.length}/{MAX_IMAGES} ảnh · JPG/PNG/WebP · 5 MB/ảnh</span>
          </div>
          <Input id="bug-image" type="file" multiple accept="image/jpeg,image/png,image/webp"
            disabled={saving || images.length >= MAX_IMAGES} onChange={selectFiles}
            aria-label="Chọn tối đa 5 ảnh chụp màn hình" />
          {images.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map(image => <div key={image.id} className="relative overflow-hidden rounded-lg border bg-muted/20">
              <img src={image.previewUrl} alt={`Ảnh đã chọn: ${image.file.name}`}
                className="h-28 w-full object-contain sm:h-36"/>
              <button type="button" onClick={() => removeImage(image.id)} disabled={saving}
                aria-label={`Xóa ảnh ${image.file.name}`}
                className="absolute right-1 top-1 rounded-full bg-background/95 p-1.5 text-foreground shadow-sm hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50">
                <X className="h-4 w-4"/>
              </button>
              <p className="truncate border-t px-2 py-1.5 text-xs text-muted-foreground" title={image.file.name}>{image.file.name}</p>
            </div>)}
          </div>}
          {images.length > 0 && <Button type="button" variant="outline" size="sm" onClick={clearImages} disabled={saving}>
            Xóa tất cả ảnh đã chọn
          </Button>}
          <p className="text-xs text-muted-foreground">Có thể chọn nhiều ảnh một lần hoặc chọn bổ sung. Xóa ảnh trước khi gửi sẽ không tải ảnh đó lên.</p>
        </div>
        {errorText && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errorText}</p>}
        <Button disabled={saving || !userId || title.trim().length < 8 || description.trim().length < 20} onClick={() => void send()}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4"/>} Gửi báo lỗi
        </Button>
      </section>
      )}
    </main>
  );
}
