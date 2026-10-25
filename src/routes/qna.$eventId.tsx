import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft, CheckCheck, Hand, Loader2, MessageCircle, Send,
  ShieldCheck, EyeOff, Eye, RefreshCw, XCircle, MonitorPlay, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getJoined } from "@/lib/joined-events";
import { getEventRole, type EventRole } from "@/lib/event-role";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  getEventQnaForParticipant, getEventQnaForHost,
  submitEventQnaQuestion, setEventQnaHand,
  changeEventQnaOpen, moderateEventQnaQuestion, resolveEventQnaHand,
  type QnaQuestion, type QnaHand,
} from "@/lib/event-qna.functions";

export const Route = createFileRoute("/qna/$eventId")({
  ssr: false,
  head: () => ({ meta: [{ title: "Live Q&A & Giơ tay — Joinly" }] }),
  component: QnaPage,
});

type GuestData = {
  eventName: string; isOpen: boolean; myName: string;
  handRaised: boolean; pendingCount: number; questions: QnaQuestion[]; mine: QnaQuestion[];
};
type HostData = {
  eventName: string; isOpen: boolean; eventActive: boolean;
  questions: QnaQuestion[]; hands: QnaHand[];
};
const statusText: Record<QnaQuestion["status"], string> = {
  pending: "Đang chờ BTC duyệt",
  approved: "Đã được công bố",
  answered: "BTC đã trả lời",
  rejected: "Không được duyệt",
};

function QnaPage() {
  const { eventId } = useParams({ from: "/qna/$eventId" });
  const [role, setRole] = useState<EventRole>(null);
  const [roleReady, setRoleReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<"participant" | "host">("participant");
  const [guest, setGuest] = useState<GuestData | null>(null);
  const [host, setHost] = useState<HostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(true);
  const [projecting, setProjecting] = useState<QnaQuestion | null>(null);

  const loadGuest = useServerFn(getEventQnaForParticipant);
  const loadHost = useServerFn(getEventQnaForHost);
  const ask = useServerFn(submitEventQnaQuestion);
  const raise = useServerFn(setEventQnaHand);
  const setOpen = useServerFn(changeEventQnaOpen);
  const moderate = useServerFn(moderateEventQnaQuestion);
  const handleHand = useServerFn(resolveEventQnaHand);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const stored = getJoined(eventId);
      if (!cancelled && stored?.token) setToken(stored.token);
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (user) {
        const r = await getEventRole(eventId);
        if (cancelled) return;
        setRole(r);
        if (r) setTab("host");
        // Same verified account on another device can recover its ticket through
        // the existing get_my_participations RPC (no email supplied by the browser).
        if (!stored?.token) {
          const { data } = await supabase.rpc("get_my_participations" as never);
          const rows = (data ?? []) as Array<{ event_id: string; confirmation_token: string }>;
          const found = rows.find((row) => row.event_id === eventId && row.confirmation_token);
          if (!cancelled && found) setToken(found.confirmation_token);
        }
      }
      if (!cancelled) setRoleReady(true);
    };
    void init();
    return () => { cancelled = true; };
  }, [eventId]);

  const hostMode = role !== null && tab === "host";
  const refresh = useCallback(async () => {
    try {
      if (hostMode) {
        const data = await loadHost({ data: { eventId } });
        setHost(data);
      } else if (token) {
        const data = await loadGuest({ data: { eventId, ticketToken: token } });
        setGuest(data);
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải Q&A. Kiểm tra cấu hình Supabase.");
    } finally {
      setLoading(false);
    }
  }, [eventId, hostMode, token, loadHost, loadGuest]);

  useEffect(() => {
    if (!roleReady || (!hostMode && !token)) { setLoading(false); return; }
    setLoading(true);
    void refresh();
    // Polling is a reliable fallback if Realtime publication or connection is unavailable.
    const timer = window.setInterval(() => { void refresh(); }, 6000);
    const channel = supabase.channel(`joinly-qna-${eventId}-${hostMode ? "host" : "guest"}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "event_qna_questions", filter: `event_id=eq.${eventId}`,
      }, () => { void refresh(); })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "event_qna_hands", filter: `event_id=eq.${eventId}`,
      }, () => { void refresh(); })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "event_qna_settings", filter: `event_id=eq.${eventId}`,
      }, () => { void refresh(); })
      .subscribe();
    return () => { window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [roleReady, hostMode, token, eventId, refresh]);

  const perform = async (fn: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); toast.success(success); await refresh(); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Thao tác không thành công."); }
    finally { setBusy(false); }
  };

  const title = hostMode ? host?.eventName : guest?.eventName;
  const approved = host?.questions.filter((q) => q.status === "approved" || q.status === "answered") ?? [];
  const pending = host?.questions.filter((q) => q.status === "pending") ?? [];
  const questionsRemaining = Math.max(0, 3 - (guest?.pendingCount ?? 0));
  const reachedQuestionLimit = guest !== null && guest.pendingCount >= 3;

  return (
    <div className="min-h-screen bg-secondary/30 px-4 py-9 text-foreground">
      <main className="mx-auto max-w-5xl space-y-6">
        <a href={role ? `/manage-event/${eventId}` : `/join/${eventId}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {role ? "Quản lý sự kiện" : "Thông tin sự kiện"}
        </a>
        <header className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-primary">
                <MessageCircle className="h-4 w-4" /> Joinly Live Q&A
              </div>
              <h1 className="font-display text-2xl font-bold sm:text-3xl">{title || "Giơ tay & Đặt câu hỏi"}</h1>
              <p className="mt-2 text-sm text-muted-foreground">Tương tác trực tiếp với ban tổ chức ngay trong sự kiện.</p>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                <RefreshCw className="h-4 w-4" /> Làm mới
              </Button>
            </div>
          </div>
          {role && (
            <div className="mt-5 flex flex-wrap gap-2">
              <Button size="sm" variant={hostMode ? "default" : "outline"} onClick={() => setTab("host")}>
                <ShieldCheck className="h-4 w-4" /> Điều hành BTC
              </Button>
              <Button size="sm" variant={!hostMode ? "default" : "outline"} onClick={() => setTab("participant")}>
                <Hand className="h-4 w-4" /> Người tham gia
              </Button>
            </div>
          )}
        </header>

        {error && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
        {loading && <div className="flex items-center justify-center gap-2 rounded-xl border bg-card p-8 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải Q&A...</div>}

        {!hostMode && roleReady && !token && (
          <div className="rounded-2xl border bg-card p-7">
            <h2 className="font-semibold">Cần vé tham gia sự kiện</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Bạn không cần đăng nhập. Hãy đăng ký qua QR, sau đó mở Q&A từ trang vé xác nhận.
              Nếu đã đăng ký bằng email Google, đăng nhập để đồng bộ vé của mình.
            </p>
            <Button asChild className="mt-4"><a href={`/join/${eventId}`}>Đăng ký / Mở vé sự kiện</a></Button>
          </div>
        )}

        {hostMode && host && (
          <div className="space-y-5">
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5">
              <div>
                <h2 className="font-semibold">Nhận câu hỏi và giơ tay</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {host.isOpen ? "Đang mở cho người tham gia" : "Đang đóng — người tham gia chỉ được xem câu hỏi đã duyệt"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm">{host.isOpen ? "Đang mở" : "Đã đóng"}</span>
                <Switch checked={host.isOpen} disabled={busy || !host.eventActive}
                  onCheckedChange={(isOpen) => void perform(() => setOpen({ data: { eventId, isOpen } }),
                    isOpen ? "Đã mở Q&A" : "Đã đóng Q&A")} />
              </div>
            </section>
            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border bg-card p-5">
                <h2 className="flex items-center gap-2 font-semibold"><MessageCircle className="h-5 w-5" /> Chờ duyệt ({pending.length})</h2>
                <div className="mt-4 space-y-3">
                  {pending.length === 0 && <p className="text-sm text-muted-foreground">Không có câu hỏi đang chờ.</p>}
                  {pending.map((q) => (
                    <div key={q.id} className="rounded-xl border p-4">
                      <p className="text-xs text-muted-foreground">{q.is_anonymous ? "Yêu cầu ẩn danh" : q.author} · {new Date(q.created_at).toLocaleTimeString("vi-VN")}</p>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{q.body}</p>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" disabled={busy} onClick={() => void perform(() => moderate({ data: { eventId, questionId: q.id, action: "approve" } }), "Đã duyệt câu hỏi")}>
                          <Eye className="h-4 w-4" /> Duyệt
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void perform(() => moderate({ data: { eventId, questionId: q.id, action: "reject" } }), "Đã ẩn câu hỏi")}>
                          <XCircle className="h-4 w-4" /> Từ chối
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-2xl border bg-card p-5">
                <h2 className="flex items-center gap-2 font-semibold"><Hand className="h-5 w-5" /> Đang giơ tay ({host.hands.length})</h2>
                <div className="mt-4 space-y-3">
                  {host.hands.length === 0 && <p className="text-sm text-muted-foreground">Chưa có ai giơ tay.</p>}
                  {host.hands.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                      <div><p className="font-medium">{h.author}</p><p className="text-xs text-muted-foreground">Đang chờ phát biểu</p></div>
                      <Button variant="outline" size="sm" disabled={busy}
                        onClick={() => void perform(() => handleHand({ data: { eventId, handId: h.id } }), "Đã xử lý lượt giơ tay")}>
                        <CheckCheck className="h-4 w-4" /> Đã xử lý
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
            <section className="rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">Câu hỏi đã duyệt ({approved.length})</h2>
              <div className="mt-4 space-y-3">
                {approved.length === 0 && <p className="text-sm text-muted-foreground">Chưa có câu hỏi được duyệt.</p>}
                {approved.map((q) => (
                  <div key={q.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">{q.is_anonymous ? "Ẩn danh" : q.author} · {statusText[q.status]}</p>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm font-medium">{q.body}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setProjecting(q)}>
                        <MonitorPlay className="h-4 w-4" /> Trình chiếu
                      </Button>
                      {q.status === "approved" && <Button size="sm" variant="outline" disabled={busy}
                        onClick={() => void perform(() => moderate({ data: { eventId, questionId: q.id, action: "answer" } }), "Đã đánh dấu trả lời")}>
                        <CheckCheck className="h-4 w-4" /> Đã trả lời
                      </Button>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {!hostMode && guest && (
          <div className="space-y-5">
            <section className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border bg-card p-5">
                <h2 className="flex items-center gap-2 font-semibold"><Hand className="h-5 w-5" /> Giơ tay xin phát biểu</h2>
                <p className="mt-2 text-sm text-muted-foreground">BTC sẽ thấy tên trên vé của bạn trong hàng đợi giơ tay.</p>
                <Button className="mt-4 w-full" variant={guest.handRaised ? "outline" : "default"}
                  disabled={!guest.isOpen || busy}
                  onClick={() => void perform(() => raise({ data: { eventId, ticketToken: token!, raised: !guest.handRaised } }),
                    guest.handRaised ? "Đã hạ tay" : "Đã gửi yêu cầu giơ tay") }>
                  <Hand className="h-4 w-4" /> {guest.handRaised ? "Hạ tay" : "Giơ tay"}
                </Button>
              </div>
              <div className="rounded-2xl border bg-card p-5">
                <h2 className="flex items-center gap-2 font-semibold"><MessageCircle className="h-5 w-5" /> Đặt câu hỏi cho BTC</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Đang chờ duyệt {guest.pendingCount}/3 câu · Còn {questionsRemaining} chỗ trống
                </p>
                {reachedQuestionLimit && (
                  <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-foreground">
                    Bạn đang có 3 câu hỏi chờ duyệt. Khi BTC duyệt hoặc từ chối một câu, bạn có thể gửi thêm.
                  </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">Câu đã duyệt, đã trả lời hoặc bị từ chối không tính vào giới hạn. Không giới hạn tổng số câu hỏi.</p>
                <Textarea className="mt-3 min-h-28" placeholder="Bạn muốn hỏi điều gì? (5–400 ký tự)"
                  maxLength={400} value={body} onChange={(event) => setBody(event.target.value)}
                  disabled={!guest.isOpen || busy || reachedQuestionLimit} />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm"><Switch checked={anonymous} onCheckedChange={setAnonymous}
                    disabled={!guest.isOpen || busy || reachedQuestionLimit} />
                    <EyeOff className="h-4 w-4" /> Ẩn tên khi công bố</label>
                  <span className="text-xs text-muted-foreground">{body.length}/400</span>
                </div>
                <Button className="mt-4 w-full"
                  disabled={!guest.isOpen || busy || reachedQuestionLimit || body.trim().length < 5}
                  onClick={() => void perform(async () => {
                    await ask({ data: { eventId, ticketToken: token!, body: body.trim(), isAnonymous: anonymous } });
                    setBody("");
                  }, "Đã gửi câu hỏi, đang chờ BTC duyệt") }>
                  <Send className="h-4 w-4" /> Gửi câu hỏi
                </Button>
              </div>
            </section>
            {!guest.isOpen && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">BTC chưa mở hoặc đã tạm đóng tương tác.</p>}
            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border bg-card p-5">
                <h2 className="font-semibold">Câu hỏi của tôi</h2>
                <div className="mt-3 space-y-3">
                  {guest.mine.length === 0 && <p className="text-sm text-muted-foreground">Bạn chưa gửi câu hỏi nào.</p>}
                  {guest.mine.map((q) => (
                    <div key={q.id} className="rounded-xl border p-3">
                      <p className="text-xs text-muted-foreground">{statusText[q.status]}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{q.body}</p>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-2xl border bg-card p-5">
                <h2 className="font-semibold">Câu hỏi được công bố</h2>
                <div className="mt-3 space-y-3">
                  {guest.questions.length === 0 && <p className="text-sm text-muted-foreground">Chưa có câu hỏi nào được BTC duyệt.</p>}
                  {guest.questions.map((q) => (
                    <div key={q.id} className="rounded-xl border p-3">
                      <p className="text-xs text-muted-foreground">{q.author} · {statusText[q.status]}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{q.body}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
        {hostMode && projecting && (
          <div role="dialog" aria-modal="true" aria-label="Trình chiếu câu hỏi"
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950 px-6 py-16 text-white">
            <button type="button" onClick={() => setProjecting(null)}
              className="absolute right-6 top-5 flex items-center gap-2 rounded-lg border border-white/30 px-4 py-2 text-sm hover:bg-white/10">
              <X className="h-4 w-4" /> Đóng
            </button>
            <div className="w-full max-w-5xl text-center">
              <p className="mb-6 text-lg font-medium text-indigo-300">JOINLY · CÂU HỎI TỪ KHÁN GIẢ</p>
              <p className="mb-8 text-xl text-slate-300">{projecting.is_anonymous ? "Ẩn danh" : projecting.author}</p>
              <h2 className="whitespace-pre-wrap break-words text-3xl font-bold leading-relaxed sm:text-5xl">{projecting.body}</h2>
              <p className="mt-12 text-sm text-slate-400">Chỉ người điều hành được mở màn hình này</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
