import { useEffect, useState, type FormEvent, type ChangeEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpenCheck,
  Check,
  Clock3,
  Copy,
  Gamepad2,
  Loader2,
  Pencil,
  Play,
  Plus,
  Save,
  ArrowUp,
  ArrowDown,
  FileSpreadsheet,
  Upload,
  X,
  RadioTower,
  Search,
  ArrowUpDown,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { getEventRole, type EventRole } from "@/lib/event-role";

import {
  createQuiz,
  createQuizSession,
  deleteQuizQuestion,
  deleteUnusedQuiz,
  getQuizEditor,
  listQuizzes,
  listQuizSessions,
  saveQuizQuestion,
  updateQuiz,
  importQuizQuestions,
  moveQuizQuestion,
} from "@/lib/quiz.functions";

export const Route = createFileRoute("/_authenticated/dashboard_/$id/quiz")({
  head: () => ({
    meta: [{ title: "Quản lý Quiz — Joinly" }],
  }),
  component: QuizManagePage,
});

type Quiz = {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  created_at: string;
};

type Question = {
  id: string;
  title: string;
  options: unknown;
  correct_index: number;
  position: number;
  points: number;
  time_limit_seconds: number;
  explanation: string | null;
};

type QuizEditor = {
  quiz: Quiz;
  questions: Question[];
  role: "owner" | "co_owner" | "manager";
  canEditQuestions: boolean;
};

type QuizSession = {
  id: string;
  mode: "live" | "self_paced";
  status: string;
  join_code: string | null;
  created_at: string;
};

type ExcelQuestion = {
  excelRow: number;
  title: string;
  options: [string, string, string, string];
  correctIndex: number;
  timeLimitSeconds: number;
  explanation: string;
};

const EXCEL_ALLOWED_TIMES = [10, 15, 20, 30, 45, 60, 90, 120];

function normalizeExcelText(value: string) {
  return value.trim().normalize("NFC").toLocaleLowerCase("vi-VN");
}

const OPTION_COLORS = [
  "bg-[#aaf4de]",
  "bg-[#c7e99a]",
  "bg-[#ffd092]",
  "bg-[#ffb0aa]",
  "bg-[#bdd9ff]",
  "bg-[#dfc7ff]",
];

function optionsFrom(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Có lỗi xảy ra. Vui lòng thử lại.";
}

function QuizManagePage() {
  const { id } = Route.useParams();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const [role, setRole] = useState<EventRole>(null);
  const [eventName, setEventName] = useState("Sự kiện");

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<QuizEditor | null>(null);
  const [sessions, setSessions] = useState<QuizSession[]>([]);

  const [questionSearch, setQuestionSearch] = useState("");

  const [questionSort, setQuestionSort] = useState<"position" | "title" | "time_asc" | "time_desc">(
    "position",
  );

  const [excelQuestions, setExcelQuestions] = useState<ExcelQuestion[]>([]);

  const [excelErrors, setExcelErrors] = useState<string[]>([]);

  const [excelFileName, setExcelFileName] = useState("");
  useEffect(() => {
    setExcelQuestions([]);
    setExcelErrors([]);
    setExcelFileName("");
  }, [selectedId]);

  const [readingExcel, setReadingExcel] = useState(false);

  const [activeTab, setActiveTab] = useState<"questions" | "sessions" | "settings">("questions");
  const [refreshKey, setRefreshKey] = useState(0);

  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);

  const [questionTitle, setQuestionTitle] = useState("");
  const [choices, setChoices] = useState<string[]>(["", "", "", ""]);

  const [correctIndex, setCorrectIndex] = useState(0);
  const [position, setPosition] = useState(0);
  const [seconds, setSeconds] = useState(20);
  const [explanation, setExplanation] = useState("");

  const canManageQuestions = role === "owner" || role === "co_owner";

  const canEditQuestions = canManageQuestions && Boolean(editor?.canEditQuestions);

  const canMoveQuestions =
    canEditQuestions && questionSort === "position" && questionSearch.trim() === "";

  // ========================================
  // TÌM KIẾM VÀ SẮP XẾP NGÂN HÀNG CÂU HỎI
  // ========================================

  const normalizedSearch = questionSearch.trim().toLocaleLowerCase("vi-VN");

  const visibleQuestions = (editor?.questions ?? [])
    .map((question, originalIndex) => ({
      question,
      originalIndex,
    }))
    .filter(({ question }) => {
      if (!normalizedSearch) return true;

      const searchableText = [
        question.title,
        question.explanation ?? "",
        ...optionsFrom(question.options),
      ]
        .join(" ")
        .toLocaleLowerCase("vi-VN");

      return searchableText.includes(normalizedSearch);
    })
    .sort((a, b) => {
      if (questionSort === "title") {
        return (
          a.question.title.localeCompare(b.question.title, "vi") ||
          a.originalIndex - b.originalIndex
        );
      }

      if (questionSort === "time_asc") {
        return (
          a.question.time_limit_seconds - b.question.time_limit_seconds ||
          a.originalIndex - b.originalIndex
        );
      }

      if (questionSort === "time_desc") {
        return (
          b.question.time_limit_seconds - a.question.time_limit_seconds ||
          a.originalIndex - b.originalIndex
        );
      }

      return a.originalIndex - b.originalIndex;
    });

  // =========================================
  // LOAD DANH SÁCH QUIZ
  // =========================================

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      try {
        const currentRole = await getEventRole(id);

        if (!currentRole) {
          throw new Error("Bạn không có quyền quản lý sự kiện này.");
        }

        const [eventResult, quizResult] = await Promise.all([
          supabase.from("events").select("name").eq("id", id).maybeSingle(),

          listQuizzes({
            data: { eventId: id },
          }),
        ]);

        if (eventResult.error) {
          throw eventResult.error;
        }

        if (cancelled) return;

        const items = quizResult as Quiz[];

        setRole(currentRole);
        setEventName(eventResult.data?.name || "Sự kiện");
        setQuizzes(items);
        setSelectedId(items[0]?.id ?? null);
      } catch (error) {
        if (!cancelled) {
          toast.error(errorMessage(error));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [id]);

  // =========================================
  // LOAD QUIZ ĐƯỢC CHỌN
  // =========================================

  useEffect(() => {
    if (!selectedId) {
      setEditor(null);
      setSessions([]);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);

    async function loadDetail() {
      try {
        const [quizResult, sessionResult] = await Promise.all([
          getQuizEditor({
            data: { quizId: selectedId! },
          }),

          listQuizSessions({
            data: { quizId: selectedId! },
          }),
        ]);

        if (cancelled) return;

        const nextEditor = quizResult as QuizEditor;

        setEditor(nextEditor);
        setSessions(sessionResult as QuizSession[]);
        setTitle(nextEditor.quiz.title);
        setDescription(nextEditor.quiz.description || "");
      } catch (error) {
        if (!cancelled) {
          setEditor(null);
          toast.error(errorMessage(error));
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    }

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedId, refreshKey]);

  async function reloadQuizzes() {
    const items = (await listQuizzes({
      data: { eventId: id },
    })) as Quiz[];

    setQuizzes(items);
    return items;
  }

  function refreshDetail() {
    setRefreshKey((key) => key + 1);
  }

  async function runAction(action: () => Promise<void>, success: string) {
    if (busy) return;

    setBusy(true);

    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  // =========================================
  // RESET / EDIT CÂU HỎI
  // =========================================

  function resetQuestion(nextPosition = editor?.questions.length ?? 0) {
    setEditingQuestionId(null);
    setQuestionTitle("");
    setChoices(["", "", "", ""]);
    setCorrectIndex(0);
    setPosition(nextPosition);
    setSeconds(20);
    setExplanation("");
  }

  function editQuestion(question: Question) {
    setEditingQuestionId(question.id);
    setQuestionTitle(question.title);
    setChoices(optionsFrom(question.options));
    setCorrectIndex(question.correct_index);
    setPosition(question.position);
    setSeconds(question.time_limit_seconds);
    setExplanation(question.explanation || "");
  }

  function removeChoice(index: number) {
    if (choices.length <= 2) return;

    setChoices((items) => items.filter((_, itemIndex) => itemIndex !== index));

    setCorrectIndex((current) => (current === index ? 0 : current > index ? current - 1 : current));
  }

  // =========================================
  // TẠO QUIZ
  // =========================================

  function handleCreateQuiz(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    void runAction(async () => {
      const result = await createQuiz({
        data: {
          eventId: id,
          title: newTitle,
          description: newDescription,
        },
      });

      await reloadQuizzes();

      setSelectedId(result.quizId);
      setActiveTab("questions");
      setNewTitle("");
      setNewDescription("");
      resetQuestion(0);
    }, "Đã tạo Quiz mới.");
  }

  // =========================================
  // SỬA THÔNG TIN QUIZ
  // =========================================

  function handleUpdateQuiz(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;

    void runAction(async () => {
      await updateQuiz({
        data: {
          quizId: selectedId,
          title,
          description,
        },
      });

      await reloadQuizzes();
      refreshDetail();
    }, "Đã cập nhật Quiz.");
  }

  // =========================================
  // THÊM / SỬA CÂU HỎI
  // =========================================

  function handleSaveQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedId || !canEditQuestions) return;

    void runAction(async () => {
      await saveQuizQuestion({
        data: {
          quizId: selectedId,

          ...(editingQuestionId ? { questionId: editingQuestionId } : {}),

          title: questionTitle,
          options: choices,
          correctIndex,
          position,
          points: 1000,
          timeLimitSeconds: seconds,
          explanation,
        },
      });

      resetQuestion(position + (editingQuestionId ? 0 : 1));

      refreshDetail();
    }, "Đã lưu câu hỏi.");
  }

  // =========================================
  // XÓA CÂU HỎI
  // =========================================

  // =========================================
  // NHẬP CÂU HỎI TỪ EXCEL
  // =========================================

  async function downloadExcelTemplate() {
    try {
      const { default: writeExcelFile } = await import("write-excel-file/browser");

      // Đúng 8 cột mà trình nhập Excel đang đọc.
      const rows: Array<Array<string | number | null>> = [
        [
          "Câu hỏi",
          "Đáp án A",
          "Đáp án B",
          "Đáp án C",
          "Đáp án D",
          "Đáp án đúng",
          "Thời gian",
          "Giải thích",
        ],
        [
          "Thủ đô của Việt Nam là gì?",
          "Hà Nội",
          "Đà Nẵng",
          "Huế",
          "TP. Hồ Chí Minh",
          "A",
          20,
          "Hà Nội là thủ đô của Việt Nam.",
        ],
        ["2 + 2 bằng bao nhiêu?", "3", "4", "5", "6", "B", 15, "2 + 2 = 4."],
      ];

      await writeExcelFile(rows, {
        columns: [
          { width: 42 },
          { width: 22 },
          { width: 22 },
          { width: 22 },
          { width: 22 },
          { width: 18 },
          { width: 18 },
          { width: 48 },
        ],
      }).toFile("Mau_nhap_Quiz_Joinly.xlsx");

      toast.success("Đã tạo mẫu Excel Joinly.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  function clearExcelPreview() {
    setExcelQuestions([]);
    setExcelErrors([]);
    setExcelFileName("");
  }

  async function handleExcelFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    // Cho phép chọn lại cùng file.
    event.target.value = "";

    if (!file) return;

    clearExcelPreview();

    if (!canEditQuestions) {
      toast.error("Bạn không có quyền chỉnh sửa câu hỏi.");
      return;
    }

    if (!/\.xlsx$/i.test(file.name)) {
      toast.error("Chỉ hỗ trợ Excel .xlsx.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File Excel không được vượt quá 5 MB.");
      return;
    }

    setReadingExcel(true);
    setExcelFileName(file.name);

    try {
      const { readSheet } = await import("read-excel-file/browser");

      const rows = await readSheet(file);

      if (rows.length < 2) {
        throw new Error("Excel cần có dòng tiêu đề và ít nhất một câu hỏi.");
      }

      const textOf = (value: unknown): string => (value == null ? "" : String(value).trim());

      const header = rows[0].map(textOf);

      if (
        normalizeExcelText(header[0] ?? "") !== normalizeExcelText("Câu hỏi") ||
        normalizeExcelText(header[5] ?? "") !== normalizeExcelText("Đáp án đúng")
      ) {
        throw new Error('Dòng đầu phải có cột "Câu hỏi" tại A và "Đáp án đúng" tại F.');
      }

      const parsed: ExcelQuestion[] = [];
      const errors: string[] = [];

      const knownTitles = new Set(
        (editor?.questions ?? []).map((question) => normalizeExcelText(question.title)),
      );

      for (let i = 1; i < rows.length; i++) {
        const values = rows[i].map(textOf);
        const excelRow = i + 1;

        if (values.every((value) => !value)) {
          continue;
        }

        if (values.slice(8).some(Boolean)) {
          errors.push(`Dòng ${excelRow}: Chỉ sử dụng các cột A đến H.`);
          continue;
        }

        const [
          title = "",
          a = "",
          b = "",
          c = "",
          d = "",
          correct = "",
          time = "",
          explanation = "",
        ] = values;

        if (!title || title.length > 1000) {
          errors.push(`Dòng ${excelRow}: Câu hỏi trống hoặc vượt quá 1.000 ký tự.`);
          continue;
        }

        const options: [string, string, string, string] = [a, b, c, d];

        if (options.some((option) => !option || option.length > 200)) {
          errors.push(`Dòng ${excelRow}: Cần đủ 4 đáp án A/B/C/D, mỗi đáp án tối đa 200 ký tự.`);
          continue;
        }

        if (new Set(options.map(normalizeExcelText)).size !== 4) {
          errors.push(`Dòng ${excelRow}: Các đáp án bị trùng.`);
          continue;
        }

        const correctIndex = ["A", "B", "C", "D"].indexOf(correct.toUpperCase());

        if (correctIndex === -1) {
          errors.push(`Dòng ${excelRow}: Đáp án đúng phải là A, B, C hoặc D.`);
          continue;
        }

        const timeLimitSeconds = time === "" ? 20 : Number(time);

        if (!EXCEL_ALLOWED_TIMES.includes(timeLimitSeconds)) {
          errors.push(`Dòng ${excelRow}: Thời gian không hợp lệ.`);
          continue;
        }

        if (explanation.length > 2000) {
          errors.push(`Dòng ${excelRow}: Giải thích vượt quá 2.000 ký tự.`);
          continue;
        }

        const normalizedTitle = normalizeExcelText(title);

        if (knownTitles.has(normalizedTitle)) {
          errors.push(`Dòng ${excelRow}: Câu hỏi "${title}" bị trùng.`);
          continue;
        }

        knownTitles.add(normalizedTitle);

        parsed.push({
          excelRow,
          title,
          options,
          correctIndex,
          timeLimitSeconds,
          explanation,
        });
      }

      if (parsed.length > 100) {
        errors.push("Mỗi lần chỉ được nhập tối đa 100 câu hỏi.");
      }

      if (parsed.length === 0 && errors.length === 0) {
        errors.push("Không tìm thấy câu hỏi hợp lệ.");
      }

      setExcelQuestions(parsed);
      setExcelErrors(errors);

      if (errors.length > 0) {
        toast.error(`Excel có ${errors.length} lỗi cần sửa.`);
      } else {
        toast.success(`Đã đọc ${parsed.length} câu hỏi. Hãy kiểm tra trước khi nhập.`);
      }
    } catch (error) {
      clearExcelPreview();
      toast.error(errorMessage(error));
    } finally {
      setReadingExcel(false);
    }
  }

  // =========================================
  // XÁC NHẬN NHẬP CÂU HỎI
  // =========================================

  function handleImportExcel() {
    if (
      !selectedId ||
      !canEditQuestions ||
      excelErrors.length > 0 ||
      excelQuestions.length === 0 ||
      excelQuestions.length > 100
    ) {
      return;
    }

    void runAction(async () => {
      const result = await importQuizQuestions({
        data: {
          quizId: selectedId,

          questions: excelQuestions.map((question) => ({
            title: question.title,
            options: question.options,
            correctIndex: question.correctIndex,
            timeLimitSeconds: question.timeLimitSeconds,
            explanation: question.explanation,
          })),
        },
      });

      clearExcelPreview();
      refreshDetail();

      toast.message(`Đã thêm ${result.imported} câu hỏi vào bộ Quiz.`);
    }, "Nhập Excel thành công.");
  }

  // =========================================
  // DI CHUYỂN THỨ TỰ CÂU HỎI
  // =========================================

  function handleMoveQuestion(questionId: string, direction: "up" | "down") {
    if (
      !selectedId ||
      !canEditQuestions ||
      busy ||
      questionSort !== "position" ||
      questionSearch.trim() !== ""
    ) {
      return;
    }

    void runAction(async () => {
      await moveQuizQuestion({
        data: {
          quizId: selectedId,
          questionId,
          direction,
        },
      });

      // Nếu đang sửa một câu hỏi, đóng form
      // để tránh lưu lại position cũ.
      if (editingQuestionId) {
        resetQuestion();
      }

      // Đọc lại thứ tự mới từ Supabase.
      refreshDetail();
    }, "Đã cập nhật thứ tự câu hỏi.");
  }

  function handleDeleteQuestion(questionId: string) {
    if (!selectedId || !window.confirm("Xóa câu hỏi này?")) {
      return;
    }

    void runAction(async () => {
      await deleteQuizQuestion({
        data: {
          quizId: selectedId,
          questionId,
        },
      });

      resetQuestion(0);
      refreshDetail();
    }, "Đã xóa câu hỏi.");
  }

  // =========================================
  // XÓA QUIZ
  // =========================================

  function handleDeleteQuiz() {
    if (!selectedId || !window.confirm("Xóa Quiz này? Chỉ xóa được Quiz chưa có phiên chơi.")) {
      return;
    }

    void runAction(async () => {
      await deleteUnusedQuiz({
        data: { quizId: selectedId },
      });

      const items = await reloadQuizzes();

      setSelectedId(items[0]?.id ?? null);
      resetQuestion(0);
    }, "Đã xóa Quiz.");
  }

  // =========================================
  // TẠO PHIÊN CHƠI
  // =========================================

  function handleCreateSession(mode: "live" | "self_paced") {
    if (!selectedId) return;

    void runAction(
      async () => {
        const result = await createQuizSession({
          data: {
            quizId: selectedId,
            mode,
          },
        });

        refreshDetail();
        toast.message(`Mã phòng: ${result.joinCode}`);
      },
      mode === "live" ? "Đã tạo phòng chờ Live Quiz." : "Đã tạo phiên Self-paced Quiz.",
    );
  }

  async function copyCode(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Đã sao chép mã phòng.");
    } catch {
      toast.error("Không thể sao chép. Hãy chọn và sao chép mã thủ công.");
    }
  }

  const previewChoices = choices.map(
    (choice, index) => choice.trim() || `Đáp án ${String.fromCharCode(65 + index)}`,
  );

  // =========================================
  // LOADING
  // =========================================

  if (loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Đang tải Quiz...
      </div>
    );
  }

  if (!role) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12">
        <p>Bạn không có quyền truy cập trang Quiz này.</p>

        <Button variant="outline" asChild className="mt-4">
          <Link to="/my-events">Quay về sự kiện của tôi</Link>
        </Button>
      </div>
    );
  }

  // =========================================
  // GIAO DIỆN QUẢN LÝ
  // =========================================

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div className="relative overflow-hidden rounded-3xl border border-cyan-900/30 bg-[#071f23] p-6 text-white shadow-sm sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-[#aaf4de]/10 blur-3xl"
        />

        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0 space-y-3">
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="-ml-3 text-white/75 hover:bg-white/10 hover:text-white"
            >
              <Link to="/manage-event/$id" params={{ id }}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Quản lý sự kiện
              </Link>
            </Button>

            <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#aaf4de]">
              Joinly Quiz Studio
            </p>

            <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
              <Gamepad2 className="h-8 w-8 text-[#aaf4de]" />
              Quản lý Quiz
            </h1>

            <p className="text-sm text-white/70">{eventName}</p>

            <div className="flex flex-wrap gap-2 pt-1 text-xs">
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5">
                {quizzes.length} bộ Quiz
              </span>

              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5">
                {editor?.questions.length ?? 0} câu hỏi
              </span>

              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5">
                {sessions.length} phiên chơi
              </span>
            </div>
          </div>

          <Badge className="border-white/25 bg-white/10 text-white hover:bg-white/15">
            {role === "owner" ? "Owner" : role === "co_owner" ? "Co-owner" : "Manager"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* ===================================
            DANH SÁCH QUIZ
        =================================== */}

        <aside className="space-y-4">
          {canManageQuestions && (
            <form onSubmit={handleCreateQuiz} className="space-y-3 rounded-2xl border bg-card p-4">
              <h2 className="font-semibold">Tạo bộ Quiz</h2>

              <Input
                placeholder="Tên Quiz, ví dụ: Kiến thức sự kiện"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                required
                maxLength={200}
              />

              <Textarea
                placeholder="Mô tả (không bắt buộc)"
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                maxLength={2000}
                rows={2}
              />

              <Button type="submit" disabled={busy || !newTitle.trim()} className="w-full">
                <Plus className="mr-2 h-4 w-4" />
                Tạo Quiz
              </Button>
            </form>
          )}

          <div className="rounded-2xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Bộ câu hỏi</h2>

              <Badge variant="outline">{quizzes.length}</Badge>
            </div>

            {quizzes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có Quiz nào.</p>
            ) : (
              <div className="space-y-2">
                {quizzes.map((quiz) => (
                  <button
                    key={quiz.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(quiz.id);
                      setActiveTab("questions");
                      resetQuestion(0);
                    }}
                    className={`w-full rounded-xl border p-3 text-left transition-colors hover:bg-muted ${
                      selectedId === quiz.id ? "border-primary bg-muted" : "border-border"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0" />

                      <div className="min-w-0">
                        <p className="wrap-break-word text-sm font-semibold">{quiz.title}</p>

                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {quiz.description || "Chưa có mô tả"}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* ===================================
            CHI TIẾT QUIZ
        =================================== */}

        <section className="min-w-0 space-y-5">
          {!selectedId ? (
            <div className="rounded-2xl border bg-card p-8 text-center text-muted-foreground">
              {canManageQuestions
                ? "Tạo bộ Quiz đầu tiên để thêm câu hỏi."
                : "Chưa có Quiz để quản lý."}
            </div>
          ) : detailLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border p-10">
              <Loader2 className="h-5 w-5 animate-spin" />
              Đang tải câu hỏi...
            </div>
          ) : editor ? (
            <>
              <div className="rounded-2xl border bg-card p-2 shadow-sm">
                <div
                  role="tablist"
                  aria-label="Các mục quản lý Quiz"
                  className="grid grid-cols-3 gap-2"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "questions"}
                    onClick={() => setActiveTab("questions")}
                    className={`flex items-center justify-center gap-2 rounded-xl px-2 py-3 text-sm font-semibold transition-colors ${
                      activeTab === "questions"
                        ? "bg-[#aaf4de] text-[#06272a]"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <BookOpenCheck className="h-4 w-4 shrink-0" />
                    <span>Câu hỏi ({editor.questions.length})</span>
                  </button>

                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "sessions"}
                    onClick={() => setActiveTab("sessions")}
                    className={`flex items-center justify-center gap-2 rounded-xl px-2 py-3 text-sm font-semibold transition-colors ${
                      activeTab === "sessions"
                        ? "bg-[#aaf4de] text-[#06272a]"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <RadioTower className="h-4 w-4 shrink-0" />
                    <span>Phiên chơi ({sessions.length})</span>
                  </button>

                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "settings"}
                    onClick={() => setActiveTab("settings")}
                    className={`flex items-center justify-center gap-2 rounded-xl px-2 py-3 text-sm font-semibold transition-colors ${
                      activeTab === "settings"
                        ? "bg-[#aaf4de] text-[#06272a]"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Settings2 className="h-4 w-4 shrink-0" />
                    <span>Cài đặt</span>
                  </button>
                </div>
              </div>

              {/* THÔNG TIN QUIZ */}
              {activeTab === "settings" && (
                <div className="rounded-2xl border bg-card p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold">Thông tin Quiz</h2>

                    {canManageQuestions && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={handleDeleteQuiz}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Xóa Quiz
                      </Button>
                    )}
                  </div>

                  <form className="space-y-3" onSubmit={handleUpdateQuiz}>
                    <Input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      disabled={!canManageQuestions || busy}
                      maxLength={200}
                      required
                    />

                    <Textarea
                      rows={2}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      disabled={!canManageQuestions || busy}
                      maxLength={2000}
                      placeholder="Mô tả Quiz"
                    />

                    {canManageQuestions && (
                      <Button disabled={busy || !title.trim()} type="submit" size="sm">
                        <Save className="mr-2 h-4 w-4" />
                        Lưu thông tin
                      </Button>
                    )}
                  </form>
                </div>
              )}

              {/* PHIÊN CHƠI */}
              {activeTab === "sessions" && (
                <div className="rounded-2xl border bg-card p-5">
                  <h2 className="mb-3 text-lg font-semibold">Phiên chơi</h2>

                  <p className="mb-4 text-sm text-muted-foreground">
                    Cùng một bộ câu hỏi có thể tạo phiên Live hoặc Self-paced.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={busy || editor.questions.length === 0}
                      onClick={() => handleCreateSession("live")}
                    >
                      <RadioTower className="mr-2 h-4 w-4" />
                      Tạo Live Quiz
                    </Button>

                    <Button
                      variant="outline"
                      disabled={busy || editor.questions.length === 0}
                      onClick={() => handleCreateSession("self_paced")}
                    >
                      <Play className="mr-2 h-4 w-4" />
                      Tạo Self-paced
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      title="Tải lại phiên chơi"
                      disabled={busy}
                      onClick={refreshDetail}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>

                  {sessions.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {sessions.map((session) => (
                        <div
                          key={session.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">
                              {session.mode === "live" ? "Live Quiz" : "Self-paced"}
                            </Badge>

                            <span className="text-muted-foreground">
                              {session.status === "waiting"
                                ? "Phòng chờ"
                                : session.status === "active"
                                  ? "Đang hoạt động"
                                  : session.status === "paused"
                                    ? "Tạm dừng"
                                    : session.status === "finished"
                                      ? "Đã kết thúc"
                                      : session.status === "closed"
                                        ? "Đã đóng"
                                        : "Bản nháp"}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {session.join_code && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void copyCode(session.join_code!)}
                              >
                                <span className="font-mono font-bold tracking-widest">
                                  {session.join_code}
                                </span>
                                <Copy className="ml-2 h-3.5 w-3.5" />
                              </Button>
                            )}

                            {session.mode === "live" && (
                              <Button size="sm" asChild>
                                <Link
                                  to="/quiz-host/$sessionId"
                                  params={{
                                    sessionId: session.id,
                                  }}
                                >
                                  <Play className="mr-2 h-4 w-4" />
                                  Mở Host
                                </Link>
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="mt-3 text-xs text-muted-foreground">
                    Mã phòng chỉ để chuẩn bị. Trang tham gia bằng QR và điều khiển Live sẽ bổ sung ở
                    bước sau.
                  </p>
                </div>
              )}

              {/* DANH SÁCH CÂU HỎI */}
              {activeTab === "questions" && (
                <>
                  <div className="rounded-2xl border bg-card p-5">
                    <div className="mb-4 flex items-center justify-between gap-2">
                      <h2 className="text-lg font-semibold">Câu hỏi ({editor.questions.length})</h2>

                      {canEditQuestions && (
                        <Button variant="outline" size="sm" onClick={() => resetQuestion()}>
                          <Plus className="mr-1 h-4 w-4" />
                          Câu hỏi mới
                        </Button>
                      )}
                    </div>

                    {/* =====================================
    NHẬP CÂU HỎI TỪ EXCEL
===================================== */}

                    {canEditQuestions && (
                      <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/4 p-4 sm:p-5">
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="flex items-center gap-2 font-semibold">
                              <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                              Nhập câu hỏi từ Excel
                            </h3>

                            <p className="mt-1 text-sm text-muted-foreground">
                              Nhập tối đa 100 câu hỏi mỗi lần từ file .xlsx. Xem trước trước khi
                              lưu.
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {/* TẢI FILE EXCEL MẪU */}
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => void downloadExcelTemplate()}
                            >
                              Tải mẫu Excel
                            </Button>

                            {/* CHỌN FILE EXCEL ĐỂ NHẬP */}
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                              {readingExcel ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Upload className="h-4 w-4" />
                              )}

                              {readingExcel ? "Đang đọc..." : "Chọn file Excel"}

                              <input
                                type="file"
                                accept=".xlsx"
                                className="sr-only"
                                disabled={busy || readingExcel}
                                onChange={(event) => {
                                  void handleExcelFile(event);
                                }}
                              />
                            </label>
                          </div>
                        </div>

                        <div className="rounded-xl border bg-background p-3 text-xs text-muted-foreground">
                          <p className="font-semibold text-foreground">Thứ tự cột trong Excel:</p>

                          <p className="mt-1">
                            A: Câu hỏi · B: Đáp án A · C: Đáp án B · D: Đáp án C · E: Đáp án D
                          </p>

                          <p className="mt-1">
                            F: Đáp án đúng (A/B/C/D) · G: Thời gian (mặc định 20 giây) · H: Giải
                            thích (không bắt buộc)
                          </p>

                          <p className="mt-2">
                            Dòng đầu tiên là tiêu đề cột, dữ liệu bắt đầu từ dòng 2.
                          </p>
                        </div>

                        {(excelQuestions.length > 0 || excelErrors.length > 0) && (
                          <div className="mt-4 space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="font-semibold">
                                  Xem trước: {excelQuestions.length} câu hỏi
                                </p>

                                <p className="max-w-sm truncate text-xs text-muted-foreground">
                                  {excelFileName}
                                </p>
                              </div>

                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={clearExcelPreview}
                              >
                                <X className="mr-1 h-4 w-4" />
                                Hủy
                              </Button>
                            </div>

                            {excelErrors.length > 0 && (
                              <div
                                role="alert"
                                className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600"
                              >
                                <p className="font-semibold">
                                  Có {excelErrors.length} lỗi trong Excel. Chưa thể nhập.
                                </p>

                                <ul className="mt-2 list-inside list-disc space-y-1">
                                  {excelErrors.slice(0, 10).map((message, index) => (
                                    <li key={index}>{message}</li>
                                  ))}
                                </ul>

                                {excelErrors.length > 10 && (
                                  <p className="mt-2 text-xs">
                                    Còn {excelErrors.length - 10} lỗi khác.
                                  </p>
                                )}
                              </div>
                            )}

                            {excelQuestions.length > 0 && (
                              <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border bg-background p-3">
                                {excelQuestions.slice(0, 20).map((question) => (
                                  <div key={question.excelRow} className="rounded-lg border p-3">
                                    <p className="text-sm font-semibold">
                                      Dòng {question.excelRow}: {question.title}
                                    </p>

                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {question.timeLimitSeconds} giây
                                      {" · "}
                                      Đáp án đúng: {String.fromCharCode(65 + question.correctIndex)}
                                    </p>

                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {question.options.join(" · ")}
                                    </p>
                                  </div>
                                ))}

                                {excelQuestions.length > 20 && (
                                  <p className="text-center text-xs text-muted-foreground">
                                    Đang xem 20/{excelQuestions.length} câu hỏi. Toàn bộ câu hợp lệ
                                    sẽ được nhập.
                                  </p>
                                )}
                              </div>
                            )}

                            <Button
                              type="button"
                              className="w-full"
                              disabled={
                                busy ||
                                readingExcel ||
                                excelErrors.length > 0 ||
                                excelQuestions.length === 0 ||
                                excelQuestions.length > 100
                              }
                              onClick={handleImportExcel}
                            >
                              {busy ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Upload className="mr-2 h-4 w-4" />
                              )}
                              Xác nhận nhập {excelQuestions.length} câu hỏi
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* TÌM KIẾM VÀ SẮP XẾP CÂU HỎI */}

                    <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />

                        <Input
                          value={questionSearch}
                          onChange={(event) => setQuestionSearch(event.target.value)}
                          placeholder="Tìm câu hỏi hoặc đáp án..."
                          className="pl-9"
                        />
                      </div>

                      <div className="relative">
                        <ArrowUpDown className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />

                        <select
                          value={questionSort}
                          onChange={(event) =>
                            setQuestionSort(event.target.value as typeof questionSort)
                          }
                          className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <option value="position">Thứ tự câu hỏi</option>
                          <option value="title">Tên câu hỏi A–Z</option>
                          <option value="time_asc">Thời gian tăng dần</option>
                          <option value="time_desc">Thời gian giảm dần</option>
                        </select>
                      </div>
                    </div>

                    <p className="mb-3 text-xs text-muted-foreground">
                      Hiển thị {visibleQuestions.length}/{editor.questions.length} câu hỏi
                    </p>

                    {editor.questions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Chưa có câu hỏi nào.</p>
                    ) : visibleQuestions.length === 0 ? (
                      <div className="rounded-xl border border-dashed p-6 text-center">
                        <Search className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />

                        <p className="font-medium">Không tìm thấy câu hỏi phù hợp</p>

                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="mt-2"
                          onClick={() => setQuestionSearch("")}
                        >
                          Xóa tìm kiếm
                        </Button>
                      </div>
                    ) : (
                      <div className="mb-5 space-y-2">
                        {visibleQuestions.map(({ question, originalIndex }) => (
                          <div
                            key={question.id}
                            className="flex items-start justify-between gap-3 rounded-xl border p-3"
                          >
                            <div className="min-w-0">
                              <p className="font-medium">
                                {originalIndex + 1}. {question.title}
                              </p>

                              <p className="mt-1 text-xs text-muted-foreground">
                                {optionsFrom(question.options).length} đáp án ·{" "}
                                {question.time_limit_seconds} giây
                              </p>
                            </div>

                            {canEditQuestions && (
                              <div className="flex shrink-0 gap-1">
                                {/* DI CHUYỂN CÂU HỎI LÊN */}

                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  title="Chuyển câu hỏi lên"
                                  aria-label="Chuyển câu hỏi lên"
                                  disabled={busy || !canMoveQuestions || originalIndex === 0}
                                  onClick={() => handleMoveQuestion(question.id, "up")}
                                >
                                  <ArrowUp className="h-4 w-4" />
                                </Button>

                                {/* DI CHUYỂN CÂU HỎI XUỐNG */}

                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  title="Chuyển câu hỏi xuống"
                                  aria-label="Chuyển câu hỏi xuống"
                                  disabled={
                                    busy ||
                                    !canMoveQuestions ||
                                    originalIndex === editor.questions.length - 1
                                  }
                                  onClick={() => handleMoveQuestion(question.id, "down")}
                                >
                                  <ArrowDown className="h-4 w-4" />
                                </Button>

                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title="Sửa câu hỏi"
                                  onClick={() => editQuestion(question)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>

                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title="Xóa câu hỏi"
                                  disabled={busy}
                                  onClick={() => handleDeleteQuestion(question.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {canManageQuestions && !canEditQuestions && (
                      <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">
                        Quiz đang có phiên mở hoặc đã có người tham gia, nên câu hỏi được khóa để
                        bảo toàn kết quả.
                      </p>
                    )}

                    {/* FORM THÊM CÂU HỎI */}

                    {canEditQuestions && (
                      <form onSubmit={handleSaveQuestion} className="space-y-4 border-t pt-5">
                        <h3 className="font-semibold">
                          {editingQuestionId ? "Sửa câu hỏi" : "Thêm câu hỏi"}
                        </h3>

                        <div>
                          <label className="mb-1 block text-sm font-medium">Nội dung câu hỏi</label>

                          <Textarea
                            value={questionTitle}
                            onChange={(event) => setQuestionTitle(event.target.value)}
                            required
                            maxLength={1000}
                            rows={2}
                            placeholder="Ví dụ: Thủ đô của Việt Nam là gì?"
                          />
                        </div>

                        <div className="space-y-2">
                          <p className="text-sm font-medium">
                            Các lựa chọn (chọn ô tròn bên cạnh đáp án đúng)
                          </p>

                          {choices.map((choice, index) => (
                            <div key={index} className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="correct-answer"
                                checked={correctIndex === index}
                                onChange={() => setCorrectIndex(index)}
                                aria-label={`Đánh dấu đáp án ${index + 1} là đúng`}
                                className="h-4 w-4 shrink-0 accent-primary"
                              />

                              <span className="w-5 shrink-0 text-sm font-medium">
                                {String.fromCharCode(65 + index)}
                              </span>

                              <Input
                                value={choice}
                                onChange={(event) =>
                                  setChoices((items) =>
                                    items.map((item, i) =>
                                      i === index ? event.target.value : item,
                                    ),
                                  )
                                }
                                placeholder={`Đáp án ${String.fromCharCode(65 + index)}`}
                                required
                                maxLength={200}
                              />

                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                disabled={choices.length <= 2}
                                title="Bỏ lựa chọn"
                                onClick={() => removeChoice(index)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}

                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={choices.length >= 6}
                            onClick={() => setChoices((items) => [...items, ""])}
                          >
                            <Plus className="mr-1 h-4 w-4" />
                            Thêm đáp án
                          </Button>
                        </div>

                        {/* ĐIỂM / THỜI GIAN / THỨ TỰ */}

                        {/* THỜI GIAN / THỨ TỰ */}

                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="space-y-1 text-sm">
                            <span>Thời gian trả lời</span>

                            <select
                              value={seconds}
                              onChange={(event) => setSeconds(Number(event.target.value))}
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              required
                            >
                              <option value={10}>10 giây</option>
                              <option value={15}>15 giây</option>
                              <option value={20}>20 giây (mặc định)</option>
                              <option value={30}>30 giây</option>
                              <option value={45}>45 giây</option>
                              <option value={60}>60 giây</option>
                              <option value={90}>90 giây</option>
                              <option value={120}>120 giây</option>
                            </select>
                          </label>

                          <label className="space-y-1 text-sm">
                            <span>Thứ tự câu</span>

                            <Input
                              type="number"
                              min={0}
                              max={1000}
                              value={position}
                              onChange={(event) => setPosition(Number(event.target.value))}
                              required
                            />
                          </label>
                        </div>

                        <div>
                          <label className="mb-1 block text-sm font-medium">
                            Giải thích đáp án (không bắt buộc)
                          </label>

                          <Textarea
                            rows={2}
                            value={explanation}
                            maxLength={2000}
                            onChange={(event) => setExplanation(event.target.value)}
                          />
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="submit"
                            disabled={
                              busy || !questionTitle.trim() || choices.some((item) => !item.trim())
                            }
                          >
                            <Save className="mr-2 h-4 w-4" />
                            Lưu câu hỏi
                          </Button>

                          {editingQuestionId && (
                            <Button type="button" variant="outline" onClick={() => resetQuestion()}>
                              Hủy sửa
                            </Button>
                          )}
                        </div>
                      </form>
                    )}
                  </div>

                  {/* XEM TRƯỚC GIAO DIỆN QUIZ */}

                  {canEditQuestions && (
                    <div className="rounded-2xl border border-neutral-800 bg-black p-4 text-white sm:p-6">
                      <div className="mb-3 flex items-center justify-between text-xs">
                        <span className="rounded-full bg-neutral-900 px-3 py-1 font-bold">
                          JOINLY QUIZ
                        </span>

                        <span>Câu xem trước</span>
                      </div>

                      <div className="mb-3 h-1.5 w-1/4 rounded-full bg-white" />

                      <div className="mb-5 flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {seconds} giây
                        </span>
                      </div>

                      <h3 className="mb-2 text-center text-lg font-bold">
                        {questionTitle || "Thủ đô của Việt Nam là gì?"}
                      </h3>

                      <p className="mb-4 text-center text-xs text-neutral-400">
                        Chọn một đáp án đúng
                      </p>

                      <div className="space-y-2">
                        {previewChoices.map((choice, index) => (
                          <div
                            key={index}
                            className={`flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 text-slate-950 ${OPTION_COLORS[index]}`}
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white font-bold">
                              {String.fromCharCode(65 + index)}
                            </span>

                            <span className="flex-1 text-sm font-semibold">{choice}</span>

                            {correctIndex === index && <Check className="h-5 w-5 shrink-0" />}
                          </div>
                        ))}
                      </div>

                      <p className="mt-4 text-center text-xs text-neutral-400">
                        Bản xem trước dành cho BTC. Người chơi sẽ không thấy dấu đáp án đúng.
                      </p>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="rounded-2xl border p-6 text-muted-foreground">
              Không thể tải dữ liệu Quiz đã chọn.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
