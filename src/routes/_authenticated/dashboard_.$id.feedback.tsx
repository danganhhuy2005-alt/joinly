import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  ClipboardList,
  Loader2,
  Plus,
  Save,
  Trash2,
  Pencil,
  LockKeyhole,
  CheckCircle2,
  QrCode,
  Copy,
  Download,
  ArrowUp,
  Eye,
  Star,
  ArrowDown,
  MoreHorizontal,
  XCircle,
} from "lucide-react";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { getEventRole, type EventRole } from "@/lib/event-role";

import {
  createFeedbackForm,
  duplicateFeedbackForm,
  updateFeedbackForm,
  deleteDraftFeedbackForm,
  listFeedbackForms,
  getFeedbackEditor,
  saveFeedbackQuestion,
  deleteFeedbackQuestion,
  setFeedbackStatus,
} from "@/lib/feedback.functions";

export const Route = createFileRoute("/_authenticated/dashboard_/$id/feedback")({
  head: () => ({
    meta: [{ title: "Quản lý Feedback — Joinly" }],
  }),
  component: FeedbackManagePage,
});

type Status = "draft" | "open" | "closed";

type QuestionType = "rating" | "short_text" | "long_text" | "single_choice" | "multi_choice";

type FeedbackForm = {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  status: Status;
  created_at: string;
};

type FeedbackQuestion = {
  id: string;
  title: string;
  question_type: QuestionType;
  options: unknown;
  is_required: boolean;
  position: number;
  max_choices: number | null;
};

const questionLabels: Record<QuestionType, string> = {
  rating: "Đánh giá sao (1–5)",
  short_text: "Trả lời ngắn",
  long_text: "Đoạn văn",
  single_choice: "Một lựa chọn",
  multi_choice: "Nhiều lựa chọn",
};

const statusLabels: Record<Status, string> = {
  draft: "Bản nháp",
  open: "Đang mở",
  closed: "Đã đóng",
};

function readOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter((v): v is string => typeof v === "string");
}

function FeedbackManagePage() {
  const { id } = useParams({
    from: "/_authenticated/dashboard_/$id/feedback",
  });

  const [loading, setLoading] = useState(true);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  const [siteOrigin, setSiteOrigin] = useState("");

  useEffect(() => {
    setSiteOrigin(window.location.origin);
  }, []);

  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<EventRole>(null);
  const [eventName, setEventName] = useState("");

  const [forms, setForms] = useState<FeedbackForm[]>([]);
  const [formSearch, setFormSearch] = useState("");

  const [formStatusFilter, setFormStatusFilter] = useState<"all" | Status>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [selectedForm, setSelectedForm] = useState<FeedbackForm | null>(null);

  const feedbackUrl = siteOrigin && selectedForm ? `${siteOrigin}/feedback/${selectedForm.id}` : "";

  const [questions, setQuestions] = useState<FeedbackQuestion[]>([]);

  const [responseCount, setResponseCount] = useState(0);

  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [questionTitle, setQuestionTitle] = useState("");
  const [questionType, setQuestionType] = useState<QuestionType>("rating");
  const [choiceOptions, setChoiceOptions] = useState<string[]>(["", ""]);
  const [required, setRequired] = useState(true);
  const [questionPosition, setQuestionPosition] = useState(0);
  const [maxChoices, setMaxChoices] = useState<number | null>(null);

  const canEdit = role === "owner" || role === "co_owner";
  const canEditQuestions = canEdit && responseCount === 0;

  const isChoice = questionType === "single_choice" || questionType === "multi_choice";

  // ======================================
  // TÌM KIẾM VÀ LỌC BIỂU MẪU
  // ======================================

  const filteredForms = forms.filter((form) => {
    const matchesSearch = form.title
      .toLocaleLowerCase("vi")
      .includes(formSearch.trim().toLocaleLowerCase("vi"));

    const matchesStatus = formStatusFilter === "all" || form.status === formStatusFilter;

    return matchesSearch && matchesStatus;
  });

  // ======================================
  // TẢI DANH SÁCH FEEDBACK
  // ======================================

  const reloadForms = useCallback(async () => {
    const result = await listFeedbackForms({
      data: { eventId: id },
    });

    setForms(result as FeedbackForm[]);
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      try {
        const currentRole = await getEventRole(id);

        if (!currentRole) {
          throw new Error("Bạn không có quyền truy cập sự kiện này.");
        }

        const { data: ev, error } = await supabase
          .from("events")
          .select("name")
          .eq("id", id)
          .maybeSingle();

        if (error) throw error;

        const result = await listFeedbackForms({
          data: { eventId: id },
        });

        if (cancelled) return;

        setRole(currentRole);
        setEventName(ev?.name ?? "Sự kiện");
        setForms(result as FeedbackForm[]);
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Không thể tải Feedback.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [id]);

  // ======================================
  // RESET CÂU HỎI
  // ======================================

  const resetQuestion = () => {
    setEditingQuestionId(null);
    setQuestionTitle("");
    setQuestionType("rating");
    setChoiceOptions(["", ""]);
    setRequired(true);
    setQuestionPosition(questions.length ? Math.max(...questions.map((q) => q.position)) + 1 : 0);
    setMaxChoices(null);
  };

  // ======================================
  // MỞ TRÌNH CHỈNH SỬA FORM
  // ======================================

  const openEditor = async (formId: string) => {
    setSelectedId(formId);
    setEditorLoading(true);

    try {
      const result = await getFeedbackEditor({
        data: { formId },
      });

      const form = result.form as FeedbackForm;
      const items = result.questions as FeedbackQuestion[];

      setSelectedForm(form);
      setQuestions(items);
      setResponseCount(result.responseCount ?? 0);
      setTitle(form.title);
      setDescription(form.description ?? "");

      setEditingQuestionId(null);
      setQuestionTitle("");
      setQuestionType("rating");
      setChoiceOptions(["", ""]);
      setRequired(true);
      setMaxChoices(null);

      setQuestionPosition(items.length ? Math.max(...items.map((q) => q.position)) + 1 : 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không tải được biểu mẫu.");
    } finally {
      setEditorLoading(false);
    }
  };

  // ======================================
  // TẠO BIỂU MẪU
  // ======================================

  const createForm = async () => {
    if (!newTitle.trim()) {
      toast.error("Hãy nhập tên biểu mẫu.");
      return;
    }

    setBusy(true);

    try {
      const created = await createFeedbackForm({
        data: {
          eventId: id,
          title: newTitle.trim(),
          description: newDescription.trim(),
        },
      });

      setNewTitle("");
      setNewDescription("");
      setShowCreateForm(false);

      await reloadForms();
      await openEditor(created.formId);

      toast.success("Đã tạo biểu mẫu nháp.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Tạo biểu mẫu thất bại.");
    } finally {
      setBusy(false);
    }
  };

  // ======================================
  // NHÂN BẢN TOÀN BỘ BIỂU MẪU
  // ======================================

  const duplicateForm = async () => {
    if (!selectedId || !canEdit || busy) return;

    setBusy(true);

    try {
      const result = await duplicateFeedbackForm({
        data: {
          formId: selectedId,
        },
      });

      // Cập nhật danh sách biểu mẫu
      await reloadForms();

      // Tự động mở bản sao để BTC chỉnh sửa
      await openEditor(result.formId);

      toast.success(`Đã nhân bản biểu mẫu với ${result.questionCount} câu hỏi.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể nhân bản biểu mẫu.");
    } finally {
      setBusy(false);
    }
  };

  // ======================================
  // LƯU THÔNG TIN FORM
  // ======================================

  const saveForm = async () => {
    if (!selectedId || !title.trim()) {
      toast.error("Hãy nhập tiêu đề.");
      return;
    }

    setBusy(true);

    try {
      await updateFeedbackForm({
        data: {
          formId: selectedId,
          title: title.trim(),
          description: description.trim(),
        },
      });

      await reloadForms();
      await openEditor(selectedId);

      toast.success("Đã lưu thông tin biểu mẫu.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể lưu.");
    } finally {
      setBusy(false);
    }
  };

  // ======================================
  // CHỈNH SỬA CÂU HỎI
  // ======================================

  const editQuestion = (q: FeedbackQuestion) => {
    setEditingQuestionId(q.id);
    setQuestionTitle(q.title);
    setQuestionType(q.question_type);
    const savedOptions = readOptions(q.options);

    setChoiceOptions(savedOptions.length >= 2 ? savedOptions : ["", ""]);
    setRequired(q.is_required);
    setQuestionPosition(q.position);

    setMaxChoices(q.question_type === "multi_choice" ? (q.max_choices ?? null) : null);
  };

  // ======================================
  // LƯU CÂU HỎI
  // ======================================

  const saveQuestion = async () => {
    if (!selectedId || !questionTitle.trim()) {
      toast.error("Hãy nhập câu hỏi.");
      return;
    }

    const options = isChoice ? choiceOptions.map((v) => v.trim()) : [];

    if (isChoice && (options.length < 2 || options.some((v) => !v))) {
      toast.error("Hãy nhập đầy đủ ít nhất 2 lựa chọn.");
      return;
    }
    if (questionType === "multi_choice" && maxChoices !== null && maxChoices > options.length) {
      toast.error("Số đáp án tối đa không được lớn hơn số phương án.");
      return;
    }

    if (isChoice && new Set(options.map((v) => v.toLowerCase())).size !== options.length) {
      toast.error("Các lựa chọn không được trùng nhau.");
      return;
    }

    setBusy(true);

    try {
      await saveFeedbackQuestion({
        data: {
          formId: selectedId,
          ...(editingQuestionId ? { questionId: editingQuestionId } : {}),
          title: questionTitle.trim(),
          questionType,
          options,
          isRequired: required,
          position: questionPosition,

          maxChoices: questionType === "multi_choice" ? maxChoices : null,
        },
      });

      await openEditor(selectedId);

      toast.success("Đã lưu câu hỏi.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể lưu câu hỏi.");
    } finally {
      setBusy(false);
    }
  };
  // ======================================
  // NHÂN BẢN CÂU HỎI
  // ======================================

  const duplicateQuestion = async (q: FeedbackQuestion) => {
    if (!selectedId || busy || !canEditQuestions) return;

    // Đưa câu hỏi nhân bản xuống cuối danh sách
    const nextPosition = Math.max(0, ...questions.map((item) => item.position)) + 1;

    if (nextPosition > 1000) {
      toast.error("Đã đạt giới hạn vị trí câu hỏi.");
      return;
    }

    setBusy(true);

    try {
      await saveFeedbackQuestion({
        data: {
          formId: selectedId,

          title: `${q.title.slice(0, 480)} (bản sao)`,

          questionType: q.question_type,

          options: readOptions(q.options),

          isRequired: q.is_required,

          position: nextPosition,

          maxChoices: q.question_type === "multi_choice" ? (q.max_choices ?? null) : null,
        },
      });

      await openEditor(selectedId);

      toast.success("Đã nhân bản câu hỏi.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể nhân bản câu hỏi.");
    } finally {
      setBusy(false);
    }
  };

  // ======================================
  // DI CHUYỂN CÂU HỎI LÊN / XUỐNG
  // ======================================

  const moveQuestion = async (index: number, direction: -1 | 1) => {
    if (!selectedId || busy || !canEditQuestions) return;

    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= questions.length) {
      return;
    }

    const current = questions[index];
    const target = questions[targetIndex];

    if (!current || !target) return;

    if (current.position === target.position) {
      toast.error("Hai câu hỏi đang trùng vị trí. Cần chuẩn hóa thứ tự trước khi di chuyển.");
      return;
    }

    const questionData = (question: FeedbackQuestion, position: number) => ({
      formId: selectedId,
      questionId: question.id,
      title: question.title,
      questionType: question.question_type,
      options: readOptions(question.options),
      isRequired: question.is_required,
      position,
      maxChoices: question.question_type === "multi_choice" ? (question.max_choices ?? null) : null,
    });

    setBusy(true);

    let firstUpdated = false;

    try {
      // Đưa câu hỏi hiện tại sang vị trí của câu kế bên
      await saveFeedbackQuestion({
        data: questionData(current, target.position),
      });

      firstUpdated = true;

      // Đưa câu hỏi kế bên về vị trí cũ
      await saveFeedbackQuestion({
        data: questionData(target, current.position),
      });

      await openEditor(selectedId);

      toast.success("Đã cập nhật thứ tự câu hỏi.");
    } catch (error) {
      // Nếu cập nhật lần hai lỗi, cố gắng hoàn tác lần đầu
      if (firstUpdated) {
        try {
          await saveFeedbackQuestion({
            data: questionData(current, current.position),
          });
        } catch (rollbackError) {
          console.error("Không thể hoàn tác vị trí câu hỏi:", rollbackError);
          toast.error("Không thể hoàn tác thứ tự. Hãy tải lại form để kiểm tra.");
        }
      }

      toast.error(error instanceof Error ? error.message : "Không thể di chuyển câu hỏi.");
    } finally {
      await openEditor(selectedId);
      setBusy(false);
    }
  };

  // ======================================
  // XÓA CÂU HỎI
  // ======================================

  const removeQuestion = async (questionId: string) => {
    if (!selectedId || !window.confirm("Xóa câu hỏi này?")) {
      return;
    }

    setBusy(true);

    try {
      await deleteFeedbackQuestion({
        data: {
          formId: selectedId,
          questionId,
        },
      });

      await openEditor(selectedId);

      toast.success("Đã xóa câu hỏi.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể xóa câu hỏi.");
    } finally {
      setBusy(false);
    }
  };

  // ======================================
  // MỞ / ĐÓNG FEEDBACK
  // ======================================

  const changeStatus = async (status: "open" | "closed") => {
    if (!selectedId) return;

    const confirmed = window.confirm(
      status === "open"
        ? "Mở biểu mẫu này để nhận phản hồi? Bạn vẫn có thể chỉnh sửa câu hỏi khi chưa có người gửi Feedback."
        : "Đóng biểu mẫu này và ngừng nhận phản hồi?",
    );

    if (!confirmed) return;

    setBusy(true);

    try {
      await setFeedbackStatus({
        data: {
          formId: selectedId,
          status,
        },
      });

      await reloadForms();
      await openEditor(selectedId);

      toast.success(status === "open" ? "Đã mở Feedback." : "Đã đóng Feedback.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể thay đổi trạng thái.");
    } finally {
      setBusy(false);
    }
  };

  // ======================================
  // XÓA BIỂU MẪU NHÁP
  // ======================================

  const removeForm = async () => {
    if (!selectedId || !window.confirm("Xóa vĩnh viễn biểu mẫu nháp này?")) {
      return;
    }

    setBusy(true);

    try {
      await deleteDraftFeedbackForm({
        data: { formId: selectedId },
      });

      setSelectedId(null);
      setSelectedForm(null);
      setQuestions([]);

      await reloadForms();

      toast.success("Đã xóa biểu mẫu.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể xóa biểu mẫu.");
    } finally {
      setBusy(false);
    }
  };
  // ======================================
  // TẢI MÃ QR FEEDBACK
  // ======================================

  const downloadFeedbackQr = () => {
    if (!selectedForm || !feedbackUrl) return;

    const canvas = qrCanvasRef.current;

    if (!canvas) {
      toast.error("Mã QR chưa sẵn sàng.");
      return;
    }

    try {
      const safeName = selectedForm.title
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[đĐ]/g, "d")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();

      const link = document.createElement("a");

      link.href = canvas.toDataURL("image/png");
      link.download = `Joinly-Feedback-${safeName || selectedForm.id}.png`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      toast.success("Đã tải mã QR Feedback.");
    } catch {
      toast.error("Không thể tải mã QR.");
    }
  };

  // ======================================
  // SAO CHÉP LINK FEEDBACK
  // ======================================

  const copyFeedbackLink = async () => {
    if (!feedbackUrl) return;

    try {
      await navigator.clipboard.writeText(feedbackUrl);
      toast.success("Đã sao chép liên kết Feedback.");
    } catch {
      toast.error("Không thể sao chép liên kết.");
    }
  };

  // ======================================
  // LOADING / PHÂN QUYỀN
  // ======================================

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!role) {
    return (
      <div className="p-10 text-center">Bạn không có quyền truy cập Feedback của sự kiện này.</div>
    );
  }

  // ======================================
  // GIAO DIỆN QUẢN LÝ FEEDBACK
  // ======================================

  return (
    <main className="min-h-screen bg-secondary/30 px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <Link
          to="/manage-event/$id"
          params={{ id }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Quay lại sự kiện
        </Link>

        <div className="flex items-center gap-3">
          <ClipboardList className="h-7 w-7 text-primary" />

          <div>
            <h1 className="text-2xl font-bold">Quản lý Feedback</h1>

            <p className="text-sm text-muted-foreground">
              {eventName} · Biểu mẫu dành cho người đã đăng ký
            </p>
          </div>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          {/* CỘT TRÁI: TẠO VÀ CHỌN FORM */}
          <aside className="space-y-4">
            {/* TẠO BIỂU MẪU MỚI */}
            {canEdit && (
              <section className="rounded-2xl border bg-card p-4">
                {!showCreateForm ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-center gap-2"
                    disabled={busy}
                    onClick={() => setShowCreateForm(true)}
                  >
                    <Plus className="h-4 w-4" />
                    Tạo biểu mẫu mới
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <h2 className="font-semibold">Tạo biểu mẫu mới</h2>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Tên biểu mẫu</label>

                      <Input
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        maxLength={200}
                        disabled={busy}
                        placeholder="Ví dụ: Đánh giá Workshop"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Mô tả (không bắt buộc)</label>

                      <Textarea
                        value={newDescription}
                        onChange={(e) => setNewDescription(e.target.value)}
                        maxLength={2000}
                        disabled={busy}
                        placeholder="Nhập mô tả biểu mẫu..."
                        rows={3}
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1"
                        disabled={busy}
                        onClick={() => {
                          setNewTitle("");
                          setNewDescription("");
                          setShowCreateForm(false);
                        }}
                      >
                        Hủy
                      </Button>

                      <Button
                        type="button"
                        className="flex-1"
                        disabled={busy || !newTitle.trim()}
                        onClick={() => void createForm()}
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                        Tạo form
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* DANH SÁCH BIỂU MẪU */}
            <section className="space-y-4 rounded-2xl border bg-card p-4">
              <h2 className="font-semibold">Danh sách biểu mẫu ({forms.length})</h2>

              {/* TÌM KIẾM */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Tìm kiếm</label>

                <Input
                  value={formSearch}
                  onChange={(e) => setFormSearch(e.target.value)}
                  placeholder="Nhập tên biểu mẫu..."
                  className="w-full"
                />
              </div>

              {/* LỌC TRẠNG THÁI */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Trạng thái</label>

                <select
                  value={formStatusFilter}
                  onChange={(e) => setFormStatusFilter(e.target.value as "all" | Status)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">Tất cả</option>
                  <option value="draft">Bản nháp</option>
                  <option value="open">Đang mở</option>
                  <option value="closed">Đã đóng</option>
                </select>
              </div>

              {/* SỐ KẾT QUẢ */}
              <p className="text-xs text-muted-foreground">
                Hiển thị {filteredForms.length}/{forms.length} biểu mẫu
              </p>

              {/* DANH SÁCH */}
              <div className="max-h-125 space-y-2 overflow-y-auto pr-1">
                {filteredForms.map((form) => (
                  <button
                    key={form.id}
                    type="button"
                    disabled={editorLoading}
                    onClick={() => void openEditor(form.id)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors hover:bg-secondary/60 disabled:opacity-60 ${
                      selectedId === form.id ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <span className="block wrap-break-word font-medium">{form.title}</span>

                    <span
                      className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                        form.status === "open"
                          ? "bg-green-500/10 text-green-600 dark:text-green-400"
                          : form.status === "draft"
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {statusLabels[form.status]}
                    </span>
                  </button>
                ))}

                {/* CHƯA CÓ FORM */}
                {forms.length === 0 && (
                  <div className="rounded-xl border border-dashed p-5 text-center">
                    <p className="text-sm text-muted-foreground">Chưa có biểu mẫu nào.</p>
                  </div>
                )}

                {/* KHÔNG TÌM THẤY */}
                {forms.length > 0 && filteredForms.length === 0 && (
                  <div className="space-y-3 rounded-xl border border-dashed p-5 text-center">
                    <p className="text-sm text-muted-foreground">
                      Không tìm thấy biểu mẫu phù hợp.
                    </p>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFormSearch("");
                        setFormStatusFilter("all");
                      }}
                    >
                      Xóa bộ lọc
                    </Button>
                  </div>
                )}
              </div>
            </section>
          </aside>

          {/* CỘT PHẢI: CHỈNH SỬA FORM */}
          <section className="min-w-0 rounded-2xl border bg-card p-5">
            {editorLoading ? (
              <div className="flex justify-center p-12">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : !selectedForm ? (
              <div className="py-16 text-center text-muted-foreground">
                Chọn một biểu mẫu ở bên trái để xem hoặc chỉnh sửa.
              </div>
            ) : (
              <div className="space-y-6">
                {/* TRẠNG THÁI VÀ NÚT ĐIỀU KHIỂN */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                  <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium">
                    {statusLabels[selectedForm.status]}
                  </span>

                  <div className="flex flex-wrap gap-2">
                    {/* NHÂN BẢN FORM */}
                    {canEdit && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void duplicateForm()}
                      >
                        <Copy className="h-4 w-4" />
                        Nhân bản form
                      </Button>
                    )}
                    {/* XEM TRƯỚC FORM FEEDBACK */}
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button type="button" variant="outline">
                          <Eye className="mr-2 h-4 w-4" />
                          Xem trước
                        </Button>
                      </DialogTrigger>

                      <DialogContent className="max-h-[90vh] w-[calc(100vw-32px)] max-w-2xl overflow-y-auto rounded-2xl">
                        <DialogHeader>
                          <DialogTitle>{selectedForm.title}</DialogTitle>

                          <DialogDescription>
                            Xem trước biểu mẫu như người tham gia. Các câu trả lời thử sẽ không được
                            lưu.
                          </DialogDescription>
                        </DialogHeader>

                        <FeedbackPreview
                          questions={questions}
                          description={selectedForm.description}
                        />
                      </DialogContent>
                    </Dialog>

                    {/* GIỮ NGUYÊN CÁC NÚT QUẢN LÝ BÊN DƯỚI */}

                    {canEdit && selectedForm.status === "draft" && (
                      <>
                        <Button variant="outline" onClick={() => void removeForm()} disabled={busy}>
                          <Trash2 className="h-4 w-4" />
                          Xóa form
                        </Button>

                        <Button
                          onClick={() => void changeStatus("open")}
                          disabled={busy || questions.length === 0}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Mở Feedback
                        </Button>
                      </>
                    )}

                    {canEdit && selectedForm.status === "open" && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void changeStatus("closed")}
                      >
                        <XCircle className="h-4 w-4" />
                        Đóng Feedback
                      </Button>
                    )}

                    {canEdit && selectedForm.status === "closed" && (
                      <Button disabled={busy} onClick={() => void changeStatus("open")}>
                        <CheckCircle2 className="h-4 w-4" />
                        Mở lại
                      </Button>
                    )}
                  </div>
                </div>

                {/* TIÊU ĐỀ VÀ MÔ TẢ */}
                <div className="space-y-3">
                  <label className="block text-sm font-medium">Tên biểu mẫu</label>

                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                    disabled={!canEdit}
                  />

                  <label className="block text-sm font-medium">Mô tả</label>

                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    disabled={!canEdit}
                  />

                  {canEdit && (
                    <Button
                      variant="outline"
                      disabled={busy || !title.trim()}
                      onClick={() => void saveForm()}
                    >
                      <Save className="h-4 w-4" />
                      Lưu thông tin
                    </Button>
                  )}
                </div>

                {/* DANH SÁCH CÂU HỎI */}
                <div className="border-t pt-5">
                  <h2 className="mb-3 text-lg font-semibold">Câu hỏi ({questions.length})</h2>

                  <div className="space-y-3">
                    {questions.map((q, index) => (
                      <div key={q.id} className="rounded-xl border p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <p className="wrap-break-word font-medium">
                              {index + 1}. {q.title}{" "}
                              {q.is_required && <span className="text-destructive">*</span>}
                            </p>

                            <p className="text-xs text-muted-foreground">
                              {questionLabels[q.question_type]}
                            </p>

                            {/* HIỂN THỊ RADIO / CHECKBOX */}
                            {(q.question_type === "single_choice" ||
                              q.question_type === "multi_choice") && (
                              <div className="mt-3 space-y-2">
                                {readOptions(q.options).map((option, i) => (
                                  <div
                                    key={i}
                                    className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm"
                                  >
                                    <input
                                      type={
                                        q.question_type === "single_choice" ? "radio" : "checkbox"
                                      }
                                      disabled
                                      tabIndex={-1}
                                      aria-hidden="true"
                                      className="h-4 w-4 shrink-0 accent-primary"
                                    />

                                    <span className="wrap-break-word">{option}</span>
                                  </div>
                                ))}

                                {q.question_type === "multi_choice" && q.max_choices !== null && (
                                  <p className="text-xs text-muted-foreground">
                                    Tối đa {q.max_choices} đáp án
                                  </p>
                                )}
                              </div>
                            )}

                            {/* HIỂN THỊ ĐÁNH GIÁ SAO */}
                            {q.question_type === "rating" && (
                              <div className="mt-3 flex gap-1" aria-label="Minh họa đánh giá 5 sao">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <Star key={star} className="h-5 w-5 text-muted-foreground/50" />
                                ))}
                              </div>
                            )}

                            {/* HIỂN THỊ CÂU HỎI VĂN BẢN */}
                            {(q.question_type === "short_text" ||
                              q.question_type === "long_text") && (
                              <p className="mt-3 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                                {q.question_type === "short_text"
                                  ? "Người tham gia nhập câu trả lời ngắn"
                                  : "Người tham gia nhập nội dung góp ý"}
                              </p>
                            )}
                          </div>

                          {canEditQuestions && (
                            <div className="flex shrink-0 gap-1">
                              {/* DI CHUYỂN LÊN */}
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                title="Di chuyển câu hỏi lên"
                                aria-label="Di chuyển câu hỏi lên"
                                disabled={busy || index === 0}
                                onClick={() => void moveQuestion(index, -1)}
                              >
                                <ArrowUp className="h-4 w-4" />
                              </Button>

                              {/* DI CHUYỂN XUỐNG */}
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                title="Di chuyển câu hỏi xuống"
                                aria-label="Di chuyển câu hỏi xuống"
                                disabled={busy || index === questions.length - 1}
                                onClick={() => void moveQuestion(index, 1)}
                              >
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label="Sửa câu hỏi"
                                onClick={() => editQuestion(q)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>

                              {/* MENU THAO TÁC CÂU HỎI */}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    aria-label="Thao tác khác với câu hỏi"
                                    title="Thao tác khác"
                                    disabled={busy}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>

                                <DropdownMenuContent align="end" className="w-48">
                                  {/* NHÂN BẢN */}
                                  <DropdownMenuItem onSelect={() => void duplicateQuestion(q)}>
                                    <Copy className="mr-2 h-4 w-4" />
                                    Nhân bản câu hỏi
                                  </DropdownMenuItem>

                                  <DropdownMenuSeparator />

                                  {/* XÓA */}
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() => void removeQuestion(q.id)}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Xóa câu hỏi
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )}
                        </div>

                        {/* CHỈNH SỬA TRỰC TIẾP TRÊN THẺ CÂU HỎI */}
                        {canEditQuestions && editingQuestionId === q.id && (
                          <div className="mt-5 space-y-4 border-t border-border pt-5">
                            <div className="flex items-center gap-2">
                              <Pencil className="h-4 w-4 text-primary" />
                              <h4 className="font-semibold">Chỉnh sửa câu hỏi</h4>
                            </div>

                            {/* NỘI DUNG CÂU HỎI */}
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Nội dung câu hỏi</label>

                              <Input
                                value={questionTitle}
                                maxLength={500}
                                disabled={busy}
                                onChange={(e) => setQuestionTitle(e.target.value)}
                                placeholder="Nhập nội dung câu hỏi"
                              />
                            </div>

                            {/* LOẠI CÂU HỎI */}
                            <div className="space-y-2">
                              <label
                                htmlFor={`question-type-${q.id}`}
                                className="text-sm font-medium"
                              >
                                Loại câu hỏi
                              </label>

                              <select
                                id={`question-type-${q.id}`}
                                value={questionType}
                                disabled={busy}
                                onChange={(e) => setQuestionType(e.target.value as QuestionType)}
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              >
                                {Object.entries(questionLabels).map(([key, label]) => (
                                  <option key={key} value={key}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* NHẬP CÁC PHƯƠNG ÁN */}
                            {isChoice && (
                              <div className="space-y-3 rounded-xl border bg-secondary/20 p-4">
                                <div className="flex items-center justify-between">
                                  <h4 className="text-sm font-semibold">Các phương án trả lời</h4>

                                  <span className="text-xs text-muted-foreground">
                                    {choiceOptions.length}/30
                                  </span>
                                </div>

                                {choiceOptions.map((option, optionIndex) => (
                                  <div key={optionIndex} className="flex items-center gap-2">
                                    <input
                                      type={questionType === "single_choice" ? "radio" : "checkbox"}
                                      disabled
                                      aria-hidden="true"
                                      className="h-4 w-4 shrink-0"
                                    />

                                    <Input
                                      value={option}
                                      maxLength={200}
                                      disabled={busy}
                                      placeholder={`Lựa chọn ${optionIndex + 1}`}
                                      className="min-w-0 flex-1 bg-background"
                                      onChange={(e) => {
                                        const value = e.target.value;

                                        setChoiceOptions((prev) =>
                                          prev.map((item, i) => (i === optionIndex ? value : item)),
                                        );
                                      }}
                                    />

                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      title="Xóa lựa chọn"
                                      disabled={busy || choiceOptions.length <= 2}
                                      onClick={() => {
                                        const remaining = choiceOptions.length - 1;

                                        setChoiceOptions((prev) =>
                                          prev.filter((_, i) => i !== optionIndex),
                                        );

                                        setMaxChoices((prev) =>
                                          prev === null ? null : Math.min(prev, remaining),
                                        );
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ))}

                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="w-full border-dashed"
                                  disabled={busy || choiceOptions.length >= 30}
                                  onClick={() => setChoiceOptions((prev) => [...prev, ""])}
                                >
                                  <Plus className="mr-2 h-4 w-4" />
                                  Thêm lựa chọn
                                </Button>
                              </div>
                            )}

                            {/* GIỚI HẠN CHECKBOX */}
                            {questionType === "multi_choice" && (
                              <div className="space-y-3 rounded-xl border bg-secondary/20 p-4">
                                <label className="flex items-center gap-2 text-sm font-medium">
                                  <input
                                    type="checkbox"
                                    checked={maxChoices !== null}
                                    disabled={busy}
                                    onChange={(e) =>
                                      setMaxChoices(
                                        e.target.checked ? Math.min(2, choiceOptions.length) : null,
                                      )
                                    }
                                    className="h-4 w-4 accent-primary"
                                  />
                                  Giới hạn số đáp án được chọn
                                </label>

                                {maxChoices !== null && (
                                  <div className="space-y-2">
                                    <label
                                      htmlFor={`max-choices-${q.id}`}
                                      className="text-sm font-medium"
                                    >
                                      Người tham gia được chọn tối đa
                                    </label>

                                    <select
                                      id={`max-choices-${q.id}`}
                                      value={Math.min(maxChoices, choiceOptions.length)}
                                      disabled={busy}
                                      onChange={(e) => setMaxChoices(Number(e.target.value))}
                                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                      {Array.from(
                                        { length: choiceOptions.length - 1 },
                                        (_, i) => i + 2,
                                      ).map((count) => (
                                        <option key={count} value={count}>
                                          {count} đáp án
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* BẮT BUỘC TRẢ LỜI */}
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={required}
                                disabled={busy}
                                onChange={(e) => setRequired(e.target.checked)}
                                className="h-4 w-4 accent-primary"
                              />
                              Bắt buộc trả lời
                            </label>

                            {/* NÚT LƯU VÀ HỦY */}
                            <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                              <Button
                                type="button"
                                variant="outline"
                                disabled={busy}
                                onClick={resetQuestion}
                              >
                                Hủy
                              </Button>

                              <Button
                                type="button"
                                disabled={busy || !questionTitle.trim()}
                                onClick={() => void saveQuestion()}
                              >
                                {busy ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <Save className="mr-2 h-4 w-4" />
                                )}
                                Lưu chỉnh sửa
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {questions.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        Chưa có câu hỏi. Thêm ít nhất một câu trước khi mở Feedback.
                      </p>
                    )}
                  </div>
                </div>

                {/* KHUNG THÊM / SỬA CÂU HỎI */}
                {canEditQuestions && !editingQuestionId && (
                  <div className="space-y-3 rounded-xl border border-dashed p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold">
                        {editingQuestionId ? "Sửa câu hỏi" : "Thêm câu hỏi"}
                      </h3>

                      {editingQuestionId && (
                        <Button size="sm" variant="ghost" onClick={resetQuestion}>
                          Hủy sửa
                        </Button>
                      )}
                    </div>

                    <Input
                      value={questionTitle}
                      maxLength={500}
                      onChange={(e) => setQuestionTitle(e.target.value)}
                      placeholder="Nhập nội dung câu hỏi"
                    />

                    <label className="block text-sm font-medium" htmlFor="feedback-question-type">
                      Loại câu hỏi
                    </label>

                    <select
                      id="feedback-question-type"
                      value={questionType}
                      onChange={(e) => setQuestionType(e.target.value as QuestionType)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {Object.entries(questionLabels).map(([key, value]) => (
                        <option key={key} value={key}>
                          {value}
                        </option>
                      ))}
                    </select>

                    {isChoice && (
                      <div className="space-y-3 rounded-xl border bg-secondary/20 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-sm font-semibold">Các phương án trả lời</label>

                          <span className="text-xs text-muted-foreground">
                            {choiceOptions.length}/30
                          </span>
                        </div>

                        <p className="text-xs text-muted-foreground">
                          {questionType === "single_choice"
                            ? "Người tham gia chỉ được chọn một đáp án."
                            : "Người tham gia có thể chọn nhiều đáp án."}
                        </p>

                        <div className="space-y-2">
                          {choiceOptions.map((option, index) => (
                            <div key={index} className="flex items-center gap-2">
                              <input
                                type={questionType === "single_choice" ? "radio" : "checkbox"}
                                disabled
                                aria-hidden="true"
                                className="h-4 w-4 shrink-0"
                              />

                              <Input
                                value={option}
                                maxLength={200}
                                disabled={busy}
                                placeholder={`Lựa chọn ${index + 1}`}
                                className="min-w-0 flex-1 bg-background"
                                onChange={(e) => {
                                  const value = e.target.value;

                                  setChoiceOptions((prev) =>
                                    prev.map((item, i) => (i === index ? value : item)),
                                  );
                                }}
                              />

                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                title="Xóa lựa chọn"
                                disabled={busy || choiceOptions.length <= 2}
                                onClick={() => {
                                  const remaining = choiceOptions.length - 1;

                                  setChoiceOptions((prev) => prev.filter((_, i) => i !== index));

                                  setMaxChoices((prev) =>
                                    prev === null ? null : Math.min(prev, remaining),
                                  );
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </div>
                          ))}
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full border-dashed"
                          disabled={busy || choiceOptions.length >= 30}
                          onClick={() => {
                            setChoiceOptions((prev) => [...prev, ""]);
                          }}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Thêm lựa chọn
                        </Button>

                        <p className="text-xs text-muted-foreground">
                          Tối thiểu 2 lựa chọn. Tối đa 30 lựa chọn.
                        </p>
                      </div>
                    )}
                    {/* GIỚI HẠN ĐÁP ÁN CHO CHECKBOX */}
                    {questionType === "multi_choice" && (
                      <div className="space-y-3 rounded-xl border bg-secondary/20 p-4">
                        <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
                          <input
                            type="checkbox"
                            checked={maxChoices !== null}
                            disabled={busy}
                            onChange={(e) => {
                              setMaxChoices(
                                e.target.checked ? Math.min(2, choiceOptions.length) : null,
                              );
                            }}
                            className="h-4 w-4 accent-primary"
                          />
                          Giới hạn số đáp án được chọn
                        </label>

                        {maxChoices !== null && (
                          <div className="space-y-2">
                            <label
                              htmlFor="feedback-max-choices"
                              className="block text-sm font-medium"
                            >
                              Người tham gia được chọn tối đa
                            </label>

                            <select
                              id="feedback-max-choices"
                              value={Math.min(maxChoices, choiceOptions.length)}
                              disabled={busy}
                              onChange={(e) => setMaxChoices(Number(e.target.value))}
                              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            >
                              {Array.from(
                                { length: choiceOptions.length - 1 },
                                (_, i) => i + 2,
                              ).map((count) => (
                                <option key={count} value={count}>
                                  {count} đáp án
                                </option>
                              ))}
                            </select>

                            <p className="text-xs text-muted-foreground">
                              Người tham gia chỉ có thể chọn tối đa{" "}
                              {Math.min(maxChoices, choiceOptions.length)} trong tổng số{" "}
                              {choiceOptions.length} phương án.
                            </p>
                          </div>
                        )}

                        {maxChoices === null && (
                          <p className="text-xs text-muted-foreground">
                            Không giới hạn số đáp án được chọn.
                          </p>
                        )}
                      </div>
                    )}

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={required}
                        onChange={(e) => setRequired(e.target.checked)}
                      />
                      Bắt buộc trả lời
                    </label>

                    <Button
                      disabled={busy || !questionTitle.trim()}
                      onClick={() => void saveQuestion()}
                    >
                      <Save className="h-4 w-4" />
                      {editingQuestionId ? "Lưu chỉnh sửa" : "Thêm câu hỏi"}
                    </Button>
                  </div>
                )}

                {/* THÔNG BÁO QUYỀN */}
                {(!canEdit || responseCount > 0) && (
                  <p className="flex items-start gap-2 rounded-xl border bg-secondary/30 p-3 text-sm text-muted-foreground">
                    <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />

                    <span>
                      {!canEdit
                        ? "Chỉ Owner và Co-owner được chỉnh sửa biểu mẫu."
                        : `Biểu mẫu đã nhận ${responseCount} phản hồi. Bạn vẫn có thể sửa tiêu đề và mô tả, nhưng không thể thay đổi câu hỏi để bảo toàn kết quả.`}
                    </span>
                  </p>
                )}
                {/* THỐNG KÊ KẾT QUẢ FEEDBACK */}
                {selectedForm.status !== "draft" && (
                  <FeedbackResultsPanel formId={selectedForm.id} />
                )}

                {selectedForm.status === "open" && feedbackUrl && (
                  <div className="space-y-4 rounded-2xl border bg-secondary/30 p-4 sm:p-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <QrCode className="h-5 w-5 text-primary" />

                        <h3 className="font-semibold">Mã QR Feedback</h3>
                      </div>

                      <p className="text-sm text-muted-foreground">
                        Người tham gia quét mã QR, nhập email đã đăng ký sự kiện và gửi đánh giá.
                      </p>
                    </div>

                    {/* Mã QR hiển thị */}
                    <div className="flex justify-center">
                      <div className="rounded-2xl border bg-white p-4">
                        <QRCodeSVG
                          value={feedbackUrl}
                          size={220}
                          marginSize={2}
                          level="M"
                          className="h-auto w-full max-w-55"
                        />
                      </div>
                    </div>

                    {/* Canvas độ phân giải cao để tải PNG */}
                    <QRCodeCanvas
                      ref={qrCanvasRef}
                      value={feedbackUrl}
                      size={960}
                      marginSize={4}
                      level="M"
                      style={{ display: "none" }}
                    />

                    {/* Các nút quản lý QR */}
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button type="button" variant="outline" className="w-full">
                            <QrCode className="mr-2 h-4 w-4" />
                            Xem QR lớn
                          </Button>
                        </DialogTrigger>

                        <DialogContent className="w-[calc(100vw-32px)] max-w-md rounded-2xl">
                          <DialogHeader>
                            <DialogTitle className="pr-6 text-center">
                              {selectedForm.title}
                            </DialogTitle>

                            <DialogDescription className="text-center">
                              Quét mã QR để gửi Feedback
                            </DialogDescription>
                          </DialogHeader>

                          <div className="flex justify-center p-2">
                            <div className="w-full max-w-82.5 rounded-2xl bg-white p-4">
                              <QRCodeSVG
                                value={feedbackUrl}
                                size={300}
                                marginSize={2}
                                level="M"
                                className="h-auto w-full"
                              />
                            </div>
                          </div>

                          <p className="text-center text-xs text-muted-foreground">
                            Vui lòng sử dụng email đã đăng ký sự kiện.
                          </p>
                        </DialogContent>
                      </Dialog>

                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={downloadFeedbackQr}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Tải PNG
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => void copyFeedbackLink()}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Sao chép link
                      </Button>
                    </div>

                    {/* Link Feedback */}
                    <div className="flex min-w-0 items-center gap-2 rounded-xl border bg-background p-3">
                      <code className="min-w-0 flex-1 truncate text-xs">{feedbackUrl}</code>

                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void copyFeedbackLink()}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>

                    <p className="text-center text-xs text-muted-foreground">
                      Mã QR chỉ nhận câu trả lời khi Feedback đang mở.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

type PreviewAnswer = string | number | string[];

function FeedbackPreview({
  questions,
  description,
}: {
  questions: FeedbackQuestion[];
  description: string | null;
}) {
  const [answers, setAnswers] = useState<Record<string, PreviewAnswer>>({});

  const updateAnswer = (questionId: string, value: PreviewAnswer) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: value,
    }));
  };

  return (
    <div className="space-y-4 py-2">
      {/* MÔ TẢ BIỂU MẪU */}
      {description && (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{description}</p>
      )}

      <p className="text-xs text-muted-foreground">Dấu * là câu hỏi bắt buộc.</p>

      {questions.length === 0 && (
        <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
          Biểu mẫu chưa có câu hỏi.
        </p>
      )}

      {/* DANH SÁCH CÂU HỎI */}
      {questions.map((q, index) => {
        const value = answers[q.id];
        const options = readOptions(q.options);

        const selectedOptions = Array.isArray(value) ? value : [];

        const maxChoices = q.question_type === "multi_choice" ? q.max_choices : null;

        const reachedMax = maxChoices !== null && selectedOptions.length >= maxChoices;

        return (
          <div key={q.id} className="space-y-4 rounded-2xl border bg-card p-4">
            <h3 className="font-semibold">
              {index + 1}. {q.title}
              {q.is_required && <span className="ml-1 text-destructive">*</span>}
            </h3>

            {/* ĐÁNH GIÁ SAO */}
            {q.question_type === "rating" && (
              <div className="flex flex-wrap gap-3">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    aria-label={`Đánh giá ${star} sao`}
                    aria-pressed={value === star}
                    onClick={() => updateAnswer(q.id, star)}
                  >
                    <Star
                      className={`h-9 w-9 ${
                        typeof value === "number" && value >= star
                          ? "fill-amber-400 text-amber-400"
                          : "text-muted-foreground/40"
                      }`}
                    />
                  </button>
                ))}
              </div>
            )}

            {/* TRẢ LỜI NGẮN */}
            {q.question_type === "short_text" && (
              <Input
                placeholder="Nhập câu trả lời..."
                maxLength={500}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => updateAnswer(q.id, e.target.value)}
              />
            )}

            {/* ĐOẠN VĂN */}
            {q.question_type === "long_text" && (
              <Textarea
                placeholder="Nhập ý kiến của bạn..."
                rows={4}
                maxLength={2000}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => updateAnswer(q.id, e.target.value)}
              />
            )}

            {/* MỘT LỰA CHỌN */}
            {q.question_type === "single_choice" && (
              <div className="space-y-2">
                {options.map((option, i) => (
                  <label
                    key={i}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 hover:bg-secondary/50"
                  >
                    <input
                      type="radio"
                      name={`preview-${q.id}`}
                      checked={value === option}
                      onChange={() => updateAnswer(q.id, option)}
                      className="h-4 w-4 accent-primary"
                    />

                    <span className="text-sm">{option}</span>
                  </label>
                ))}
              </div>
            )}

            {/* NHIỀU LỰA CHỌN */}
            {q.question_type === "multi_choice" && (
              <div className="space-y-3">
                {maxChoices !== null && (
                  <div className="flex flex-wrap justify-between gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm">
                    <span>Chọn tối đa {maxChoices} đáp án</span>

                    <span className="font-semibold text-primary">
                      {selectedOptions.length}/{maxChoices}
                    </span>
                  </div>
                )}

                {options.map((option, i) => {
                  const checked = selectedOptions.includes(option);

                  const disabledOption = reachedMax && !checked;

                  return (
                    <label
                      key={i}
                      className={`flex items-center gap-3 rounded-xl border p-3 ${
                        disabledOption
                          ? "cursor-not-allowed opacity-50"
                          : "cursor-pointer hover:bg-secondary/50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabledOption}
                        className="h-4 w-4 accent-primary"
                        onChange={(e) => {
                          if (e.target.checked) {
                            if (reachedMax) return;

                            updateAnswer(q.id, [...selectedOptions, option]);
                          } else {
                            updateAnswer(
                              q.id,
                              selectedOptions.filter((v) => v !== option),
                            );
                          }
                        }}
                      />

                      <span className="text-sm">{option}</span>
                    </label>
                  );
                })}

                {reachedMax && (
                  <p className="text-xs text-primary">
                    Đã chọn đủ {maxChoices} đáp án. Bỏ chọn một đáp án để thay đổi.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* CHẾ ĐỘ XEM TRƯỚC */}
      <div className="rounded-xl border border-dashed p-4 text-center">
        <p className="text-sm font-medium">Chế độ xem trước</p>

        <p className="mt-1 text-xs text-muted-foreground">
          Bạn có thể thử trả lời các câu hỏi. Không có dữ liệu nào được gửi lên Supabase.
        </p>
      </div>
    </div>
  );
}

type ResultQuestion = {
  id: string;
  title: string;
  question_type: string;
  options: unknown;
  position: number;
};

type ResultSubmission = {
  id: string;
  email_normalized: string;
  submitted_at: string;
};

type ResultAnswer = {
  question_id: string;
  submission_id: string;
  answer: unknown;
};

type FeedbackResultsData = {
  questions: ResultQuestion[];
  submissions: ResultSubmission[];
  answers: ResultAnswer[];
};

function FeedbackResultsPanel({ formId }: { formId: string }) {
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<FeedbackResultsData | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Sử dụng Supabase client của người đăng nhập.
  // RLS sẽ giới hạn dữ liệu theo quyền quản lý sự kiện.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      try {
        const db = supabase as unknown as SupabaseClient;

        const { data: questionData, error: questionError } = await db
          .from("feedback_questions")
          .select("id,title,question_type,options,position")
          .eq("form_id", formId)
          .order("position");

        if (questionError) throw questionError;

        const submissions: ResultSubmission[] = [];

        // Phân trang để không bị giới hạn 1000 dòng.
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await db
            .from("feedback_submissions")
            .select("id,email_normalized,submitted_at")
            .eq("form_id", formId)
            .order("submitted_at", { ascending: false })
            .order("id", { ascending: false })
            .range(offset, offset + 499);

          if (error) throw error;

          const batch = (data ?? []) as ResultSubmission[];
          submissions.push(...batch);

          if (batch.length < 500) break;
        }

        const answers: ResultAnswer[] = [];

        for (let offset = 0; ; offset += 500) {
          const { data, error } = await db
            .from("feedback_answers")
            .select("id,question_id,submission_id,answer")
            .eq("form_id", formId)
            .order("id")
            .range(offset, offset + 499);

          if (error) throw error;

          const batch = (data ?? []) as ResultAnswer[];
          answers.push(...batch);

          if (batch.length < 500) break;
        }

        if (cancelled) return;

        setResults({
          questions: (questionData ?? []) as ResultQuestion[],
          submissions,
          answers,
        });
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Không thể tải kết quả Feedback.");
          setResults(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [formId, reloadKey]);

  // =====================================
  // XUẤT KẾT QUẢ CSV
  // =====================================

  const exportCsv = () => {
    if (!results) return;

    const { questions, submissions, answers } = results;

    const answerMap = new Map<string, Map<string, unknown>>();

    for (const answer of answers) {
      if (!answerMap.has(answer.submission_id)) {
        answerMap.set(answer.submission_id, new Map());
      }

      answerMap.get(answer.submission_id)!.set(answer.question_id, answer.answer);
    }

    const escapeCell = (value: unknown) => {
      let text = Array.isArray(value) ? value.join("; ") : value == null ? "" : String(value);

      // Tránh CSV formula injection khi mở bằng Excel.
      if (/^[\s]*[=+\-@\t\r]/.test(text)) {
        text = "'" + text;
      }

      return `"${text.replace(/"/g, '""')}"`;
    };

    const headers = ["Email", "Thời gian gửi", ...questions.map((q) => q.title)];

    const lines = [
      headers.map(escapeCell).join(","),
      ...submissions.map((submission) => {
        const values = answerMap.get(submission.id);

        return [
          submission.email_normalized,
          submission.submitted_at,
          ...questions.map((q) => values?.get(q.id) ?? ""),
        ]
          .map(escapeCell)
          .join(",");
      }),
    ];

    const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `Joinly-Feedback-${formId}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
    toast.success("Đã xuất kết quả Feedback.");
  };

  // =====================================
  // HIỂN THỊ GIAO DIỆN
  // =====================================

  if (loading) {
    return (
      <div className="flex justify-center rounded-xl border p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!results) {
    return (
      <Button variant="outline" onClick={() => setReloadKey((v) => v + 1)}>
        Tải lại kết quả Feedback
      </Button>
    );
  }

  const { questions, submissions, answers } = results;

  const ratingValues = answers
    .filter((a) => questions.some((q) => q.id === a.question_id && q.question_type === "rating"))
    .map((a) => a.answer)
    .filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5);

  const ratingAverage = ratingValues.length
    ? ratingValues.reduce((sum, v) => sum + v, 0) / ratingValues.length
    : null;

  const submissionEmails = new Map(submissions.map((s) => [s.id, s.email_normalized]));

  return (
    <section className="space-y-5 rounded-2xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Kết quả Feedback</h2>
          <p className="text-sm text-muted-foreground">Thống kê phản hồi của người tham gia</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setReloadKey((v) => v + 1)}>
            Làm mới
          </Button>

          <Button
            type="button"
            variant="outline"
            disabled={submissions.length === 0}
            onClick={exportCsv}
          >
            Xuất CSV
          </Button>
        </div>
      </div>

      {/* TỔNG QUAN */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border bg-secondary/30 p-4">
          <p className="text-sm text-muted-foreground">Tổng lượt phản hồi</p>
          <p className="mt-2 text-3xl font-bold">{submissions.length}</p>
        </div>

        <div className="rounded-xl border bg-secondary/30 p-4">
          <p className="text-sm text-muted-foreground">Điểm sao trung bình</p>
          <p className="mt-2 text-3xl font-bold text-primary">
            {ratingAverage !== null ? `${ratingAverage.toFixed(1)} / 5` : "—"}
          </p>
          <p className="text-xs text-muted-foreground">Tính trên tất cả câu hỏi đánh giá sao</p>
        </div>
      </div>

      {submissions.length === 0 && (
        <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
          Chưa có ai gửi Feedback cho biểu mẫu này.
        </p>
      )}

      {/* THỐNG KÊ TỪNG CÂU HỎI */}
      {questions.map((question, index) => {
        const questionAnswers = answers.filter((a) => a.question_id === question.id);

        const total = questionAnswers.length;
        const type = question.question_type;

        let labels: string[] = [];

        if (type === "rating") {
          labels = ["5", "4", "3", "2", "1"];
        } else if (type === "single_choice" || type === "multi_choice") {
          labels = Array.isArray(question.options)
            ? question.options.filter((v): v is string => typeof v === "string")
            : [];
        }

        return (
          <div key={question.id} className="space-y-4 rounded-xl border p-4">
            <div>
              <h3 className="font-semibold">
                {index + 1}. {question.title}
              </h3>
              <p className="text-xs text-muted-foreground">{total} câu trả lời</p>
            </div>

            {/* BIỂU ĐỒ SAO / LỰA CHỌN */}
            {labels.length > 0 && (
              <div className="space-y-3">
                {labels.map((label) => {
                  const count = questionAnswers.filter((a) => {
                    if (type === "rating") {
                      return a.answer === Number(label);
                    }

                    if (Array.isArray(a.answer)) {
                      return a.answer.includes(label);
                    }

                    return a.answer === label;
                  }).length;

                  const percent = total ? Math.round((count / total) * 100) : 0;

                  return (
                    <div key={label} className="space-y-1">
                      <div className="flex justify-between gap-3 text-sm">
                        <span className="min-w-0 wrap-break-word">
                          {type === "rating" ? `${label} sao` : label}
                        </span>

                        <span className="shrink-0 text-muted-foreground">
                          {count} ({percent}%)
                        </span>
                      </div>

                      <div className="h-2 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* TRẢ LỜI VĂN BẢN */}
            {(type === "short_text" || type === "long_text") && (
              <div className="space-y-2">
                {questionAnswers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Chưa có nhận xét.</p>
                ) : (
                  questionAnswers.slice(0, 30).map((a, i) => (
                    <div key={`${a.submission_id}-${i}`} className="rounded-lg bg-secondary/40 p-3">
                      <p className="whitespace-pre-wrap wrap-break-word text-sm">
                        {typeof a.answer === "string" ? a.answer : ""}
                      </p>

                      <p className="mt-2 break-all text-xs text-muted-foreground">
                        {submissionEmails.get(a.submission_id) ?? "Người tham gia"}
                      </p>
                    </div>
                  ))
                )}

                {questionAnswers.length > 30 && (
                  <p className="text-xs text-muted-foreground">
                    Đang hiển thị 30 nhận xét. Xuất CSV để xem toàn bộ.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
