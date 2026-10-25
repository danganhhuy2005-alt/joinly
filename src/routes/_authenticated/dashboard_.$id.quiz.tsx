import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BookOpenCheck, Gamepad2, Loader2, Plus, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { getEventRole, type EventRole } from "@/lib/event-role";
import { createQuiz, listQuizzes } from "@/lib/quiz.functions";

export const Route = createFileRoute("/_authenticated/dashboard_/$id/quiz")({
  head: () => ({ meta: [{ title: "Thư viện Quiz — Joinly" }] }),
  component: QuizLibraryPage,
});

type Quiz = {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  created_at: string;
};

function QuizLibraryPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<EventRole>(null);
  const [eventName, setEventName] = useState("Sự kiện");
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const canCreate = role === "owner" || role === "co_owner";
  const visibleQuizzes = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("vi-VN");
    return quizzes.filter((quiz) => !term || `${quiz.title} ${quiz.description ?? ""}`.toLocaleLowerCase("vi-VN").includes(term));
  }, [quizzes, search]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const userRole = await getEventRole(id);
        if (!userRole) throw new Error("Bạn không có quyền quản lý Quiz của sự kiện này.");
        const [eventResult, list] = await Promise.all([
          supabase.from("events").select("name").eq("id", id).maybeSingle(),
          listQuizzes({ data: { eventId: id } }),
        ]);
        if (eventResult.error) throw eventResult.error;
        if (cancelled) return;
        setRole(userRole);
        setEventName(eventResult.data?.name || "Sự kiện");
        setQuizzes(list as Quiz[]);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Không tải được thư viện Quiz.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [id]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate || busy || !title.trim()) return;
    setBusy(true);
    try {
      const result = await createQuiz({ data: { eventId: id, title: title.trim(), description } });
      toast.success("Đã tạo bộ Quiz. Bắt đầu thêm câu hỏi!");
      navigate({ to: "/dashboard/$id/quiz-editor/$quizId", params: { id, quizId: result.quizId } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Tạo Quiz thất bại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 lg:px-8">
      <header className="relative overflow-hidden rounded-3xl border border-emerald-600/20 bg-[#08272b] p-6 text-white sm:p-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-24 h-64 w-64 rounded-full border-[36px] border-white/10" />
        <Button variant="ghost" size="sm" asChild className="-ml-3 text-white/75 hover:bg-white/10 hover:text-white">
          <Link to="/manage-event/$id" params={{ id }}><ArrowLeft className="mr-2 h-4 w-4" />Quản lý sự kiện</Link>
        </Button>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#aaf4de]">Joinly Quiz Library</p>
            <h1 className="flex items-center gap-3 text-2xl font-extrabold sm:text-3xl"><Gamepad2 className="h-8 w-8 text-[#aaf4de]" />Bộ Quiz của sự kiện</h1>
            <p className="text-sm text-white/70">{eventName}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge className="border border-white/20 bg-white/10 text-white hover:bg-white/10">{quizzes.length} bộ Quiz</Badge>
            {canCreate && (
              <Button type="button" className="bg-[#aaf4de] font-bold text-[#052b2d] hover:bg-[#8ce5c7]" onClick={() => setShowCreate((value) => !value)}>
                <Plus className="mr-2 h-4 w-4" />Tạo Quiz mới
              </Button>
            )}
          </div>
        </div>
      </header>

      {showCreate && canCreate && (
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2 font-bold"><Sparkles className="h-5 w-5 text-emerald-500" />Tạo bộ Quiz mới</div>
          <form onSubmit={handleCreate} className="space-y-3">
            <Input placeholder="Tên Quiz, ví dụ: Kiến thức sự kiện" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} />
            <Textarea placeholder="Mô tả (không bắt buộc)" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!title.trim() || busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Tạo và mở trình chỉnh sửa</Button>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Hủy</Button>
            </div>
          </form>
        </section>
      )}

      <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Thư viện Quiz</h2>
            <p className="text-sm text-muted-foreground">Bấm thẻ để sửa câu hỏi; chọn Quản lý phiên chơi để mở trang riêng.</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm bộ Quiz..." className="pl-9" />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border p-14 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Đang tải thư viện...</div>
        ) : loadError ? (
          <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-600">{loadError}</div>
        ) : quizzes.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-12 text-center">
            <BookOpenCheck className="h-12 w-12 text-muted-foreground" />
            <p className="font-bold">Chưa có bộ Quiz nào</p>
            <p className="text-sm text-muted-foreground">{canCreate ? "Tạo bộ Quiz để bắt đầu thêm câu hỏi." : "Chưa có Quiz để quản lý."}</p>
            {canCreate && <Button type="button" onClick={() => setShowCreate(true)}><Plus className="mr-2 h-4 w-4" />Tạo Quiz</Button>}
          </div>
        ) : visibleQuizzes.length === 0 ? (
          <p className="rounded-xl border p-8 text-center text-muted-foreground">Không tìm thấy Quiz phù hợp.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleQuizzes.map((quiz, index) => (
              <div key={quiz.id} className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm transition hover:border-emerald-500 hover:shadow-lg">
              <Link
                to="/dashboard/$id/quiz-editor/$quizId"
                params={{ id, quizId: quiz.id }}
                className="group block min-w-0 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <div className={`relative flex h-40 items-center justify-center overflow-hidden ${index % 4 === 0 ? "bg-[#144a50]" : index % 4 === 1 ? "bg-[#49365b]" : index % 4 === 2 ? "bg-[#614332]" : "bg-[#1e5260]"}`}>
                  <div aria-hidden="true" className="absolute -right-5 -top-12 h-48 w-48 rounded-full border-[27px] border-white/10" />
                  <BookOpenCheck className="relative h-14 w-14 text-white/75 transition-transform group-hover:scale-110" />
                  <span className="absolute bottom-3 left-3 rounded-full bg-black/30 px-2.5 py-1 text-xs text-white">Bộ câu hỏi</span>
                </div>
                <div className="space-y-2 p-4">
                  <h3 className="line-clamp-2 text-base font-bold">{quiz.title}</h3>
                  <p className="line-clamp-2 min-h-9 text-sm text-muted-foreground">{quiz.description || "Chưa có mô tả"}</p>
                  <div className="flex items-center justify-between gap-2 pt-2">
                    <span className="text-xs text-muted-foreground">{new Date(quiz.created_at).toLocaleDateString("vi-VN")}</span>
                    <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Mở Quiz →</span>
                  </div>
                </div>
              </Link>
              <div className="border-t p-3">
                <Link to="/dashboard/$id/quiz-sessions/$quizId" params={{ id, quizId: quiz.id }} className="flex min-h-9 items-center justify-center gap-2 rounded-lg bg-muted px-3 text-sm font-semibold transition-colors hover:bg-emerald-500/15 hover:text-emerald-700 dark:hover:text-emerald-300">
                  <Gamepad2 className="h-4 w-4" /> Quản lý phiên chơi
                </Link>
              </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
