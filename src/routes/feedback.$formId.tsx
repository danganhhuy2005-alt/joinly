import { useEffect, useState } from "react";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Sparkles,
  Star,
  Mail,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Send,
  ClipboardList,
  LockKeyhole,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  getPublicFeedbackForm,
  checkFeedbackEmail,
  submitFeedback,
  submitJoinlyAppReview,
} from "@/lib/feedback.functions";

export const Route = createFileRoute("/feedback/$formId")({
  head: () => ({
    meta: [{ title: "Gửi Feedback — Joinly" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: FeedbackPublicPage,
});

type QuestionType = "rating" | "short_text" | "long_text" | "single_choice" | "multi_choice";

type Question = {
  id: string;
  title: string;
  question_type: QuestionType;
  options: unknown;
  is_required: boolean;
  position: number;
  max_choices: number | null;
};

type PublicForm = {
  id: string;
  title: string;
  description: string | null;
};

type AnswerValue = string | number | string[];

type Step = "loading" | "email" | "questions" | "done" | "unavailable";

function readOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === "string");
}

function hasAnswer(value: AnswerValue | undefined): boolean {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1 && value <= 5;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return false;
}

function FeedbackPublicPage() {
  const { formId } = useParams({
    from: "/feedback/$formId",
  });

  const loadPublicForm = useServerFn(getPublicFeedbackForm);
  const verifyEmail = useServerFn(checkFeedbackEmail);
  const sendFeedback = useServerFn(submitFeedback);
  const sendAppReview = useServerFn(submitJoinlyAppReview);

  const [step, setStep] = useState<Step>("loading");
  const [form, setForm] = useState<PublicForm | null>(null);

  const [email, setEmail] = useState("");
  const [verifiedEmail, setVerifiedEmail] = useState("");

  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // Đánh giá ứng dụng Joinly sau Feedback BTC
  const [appReviewToken, setAppReviewToken] = useState<string | null>(null);

  const [appReviewStep, setAppReviewStep] = useState<"ask" | "form" | "finished">("finished");

  const [appRating, setAppRating] = useState(0);
  const [appComment, setAppComment] = useState("");
  const [appReviewBusy, setAppReviewBusy] = useState(false);
  const [appReviewNote, setAppReviewNote] = useState("");

  // ======================================
  // TIẾN ĐỘ TRẢ LỜI FEEDBACK
  // ======================================

  const answeredCount = questions.filter((q) => hasAnswer(answers[q.id])).length;

  const requiredRemaining = questions.filter(
    (q) => q.is_required && !hasAnswer(answers[q.id]),
  ).length;

  const progressPercent =
    questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0;

  // ======================================
  // 1. TẢI THÔNG TIN BIỂU MẪU
  // ======================================

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const result = await loadPublicForm({
          data: { formId },
        });

        if (cancelled) return;

        if (!result) {
          setStep("unavailable");
          return;
        }

        setForm(result);
        setStep("email");
      } catch {
        if (!cancelled) {
          setMessage("Không thể tải biểu mẫu. Vui lòng thử lại.");
          setStep("unavailable");
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [formId, loadPublicForm]);

  // ======================================
  // 2. CẬP NHẬT CÂU TRẢ LỜI
  // ======================================

  const updateAnswer = (questionId: string, value: AnswerValue) => {
    setAnswers((previous) => ({
      ...previous,
      [questionId]: value,
    }));
  };

  // ======================================
  // 3. KIỂM TRA EMAIL THAM GIA
  // ======================================

  const handleCheckEmail = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      toast.error("Vui lòng nhập email hợp lệ.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const result = await verifyEmail({
        data: {
          formId,
          email: normalizedEmail,
        },
      });

      if (result.status === "closed") {
        setMessage("Biểu mẫu hiện không nhận phản hồi.");
        setStep("unavailable");
        return;
      }

      if (result.status === "not_registered") {
        toast.error("Email này chưa đăng ký tham gia sự kiện. Vui lòng kiểm tra lại.");
        return;
      }

      if (result.status === "already_submitted") {
        toast.error("Email này đã gửi Feedback cho biểu mẫu.");
        return;
      }

      if (result.status === "eligible") {
        setVerifiedEmail(normalizedEmail);

        setForm({
          id: result.form.id,
          title: result.form.title,
          description: result.form.description,
        });

        setQuestions(result.questions as Question[]);
        setAnswers({});
        setStep("questions");
        setAttemptedSubmit(false);
      }
    } catch {
      toast.error("Không thể kiểm tra email. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  };

  // ======================================
  // 4. GỬI CÂU TRẢ LỜI
  // ======================================

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttemptedSubmit(true);

    const preparedAnswers: Array<{
      questionId: string;
      value: AnswerValue;
    }> = [];

    for (const question of questions) {
      const value = answers[question.id];

      if (!hasAnswer(value)) {
        if (question.is_required) {
          toast.error(`Vui lòng trả lời: ${question.title}`);
          return;
        }

        continue;
      }

      if (value === undefined) continue;

      preparedAnswers.push({
        questionId: question.id,
        value: typeof value === "string" ? value.trim() : value,
      });
    }

    if (preparedAnswers.length === 0) {
      toast.error("Vui lòng trả lời ít nhất một câu hỏi.");
      return;
    }

    setBusy(true);

    try {
      const result = await sendFeedback({
        data: {
          formId,
          email: verifiedEmail,
          answers: preparedAnswers,
        },
      });

      switch (result.status) {
        case "ok": {
          // Mã mời chỉ có khi backend tạo thành công
          const token =
            "appReviewToken" in result && typeof result.appReviewToken === "string"
              ? result.appReviewToken
              : null;

          setAppReviewToken(token);
          setAppReviewStep(token ? "ask" : "finished");

          setAppRating(0);
          setAppComment("");
          setAppReviewNote("");

          setStep("done");
          break;
        }

        case "already_submitted":
          toast.error("Email này đã gửi Feedback trước đó.");
          break;

        case "not_registered":
          toast.error("Không tìm thấy email trong danh sách tham gia.");
          setStep("email");
          break;

        case "closed":
          setMessage("BTC đã đóng biểu mẫu và ngừng nhận phản hồi.");
          setStep("unavailable");
          break;

        case "invalid_answers":
          toast.error("Câu trả lời không hợp lệ. Vui lòng kiểm tra lại.");
          break;

        default:
          toast.error("Không thể gửi Feedback.");
      }
    } catch {
      toast.error("Có lỗi khi gửi Feedback. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  };

  // ======================================
  // GỬI ĐÁNH GIÁ ỨNG DỤNG JOINLY
  // ======================================

  const handleAppReviewSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!appReviewToken) {
      toast.error("Lời mời đánh giá không còn hiệu lực.");
      return;
    }

    if (appRating < 1 || appRating > 5) {
      toast.error("Vui lòng chọn từ 1 đến 5 sao.");
      return;
    }

    setAppReviewBusy(true);

    try {
      const result = await sendAppReview({
        data: {
          token: appReviewToken,
          rating: appRating,
          comment: appComment.trim(),
        },
      });

      if (result.status === "ok") {
        setAppReviewNote("Cảm ơn bạn đã đánh giá Joinly!");
        setAppReviewStep("finished");
        setAppReviewToken(null);
      } else if (result.status === "already_reviewed") {
        setAppReviewNote("Email này đã được dùng để đánh giá Joinly trước đó.");
        setAppReviewStep("finished");
        setAppReviewToken(null);
      } else if (result.status === "unavailable") {
        setAppReviewNote("Lời mời đánh giá đã hết hạn hoặc không còn hiệu lực.");
        setAppReviewStep("finished");
        setAppReviewToken(null);
      } else {
        toast.error("Đánh giá không hợp lệ. Vui lòng kiểm tra lại.");
      }
    } catch {
      toast.error("Không thể gửi đánh giá Joinly. Vui lòng thử lại.");
    } finally {
      setAppReviewBusy(false);
    }
  };

  // ======================================
  // 5. GIAO DIỆN CHUNG
  // ======================================

  return (
    <main className="min-h-screen bg-secondary/30 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        {/* LOGO JOINLY */}
        <div className="flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </span>

          <span className="font-display text-2xl font-bold">joinly</span>
        </div>

        {/* LOADING */}
        {step === "loading" && (
          <div className="flex justify-center rounded-2xl border bg-card p-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {/* FORM KHÔNG KHẢ DỤNG */}
        {step === "unavailable" && (
          <div className="space-y-3 rounded-2xl border bg-card p-8 text-center">
            <LockKeyhole className="mx-auto h-10 w-10 text-muted-foreground" />

            <h1 className="text-xl font-semibold">Feedback chưa mở hoặc đã đóng</h1>

            <p className="text-sm text-muted-foreground">
              {message || "Biểu mẫu hiện không nhận câu trả lời. Vui lòng liên hệ ban tổ chức."}
            </p>
          </div>
        )}

        {/* =====================================
    BƯỚC 1: NHẬP EMAIL FEEDBACK
===================================== */}

        {step === "email" && form && (
          <div className="overflow-hidden rounded-3xl border bg-card shadow-sm">
            {/* PHẦN ĐẦU BIỂU MẪU */}
            <div className="space-y-4 border-b bg-primary/5 px-6 py-7 sm:px-8">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  Bước 1/2
                </span>

                <span className="text-xs font-medium text-muted-foreground">
                  Kiểm tra email đăng ký
                </span>
              </div>

              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                <ClipboardList className="h-6 w-6 text-primary" />
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Joinly Feedback
                </p>

                <h1 className="wrap-break-word text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
                  {form.title}
                </h1>
                {form.description && (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {form.description}
                  </p>
                )}
              </div>
            </div>

            {/* NHẬP EMAIL */}
            <div className="space-y-6 p-6 sm:p-8">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold">Xác nhận email tham gia</h2>

                <p className="text-sm leading-relaxed text-muted-foreground">
                  Vui lòng nhập địa chỉ email bạn đã sử dụng khi đăng ký tham gia sự kiện để tiếp
                  tục gửi phản hồi.
                </p>
              </div>

              <form onSubmit={(event) => void handleCheckEmail(event)} className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="feedback-email" className="text-sm font-semibold">
                    Email đã đăng ký
                    <span className="ml-1 text-destructive">*</span>
                  </label>

                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />

                    <Input
                      id="feedback-email"
                      type="email"
                      required
                      autoComplete="email"
                      inputMode="email"
                      maxLength={320}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="example@gmail.com"
                      disabled={busy}
                      className="h-12 rounded-xl pl-12 text-base"
                    />
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Hãy sử dụng đúng email đã đăng ký sự kiện.
                  </p>
                </div>

                <Button
                  type="submit"
                  className="h-12 w-full gap-2 rounded-xl text-base font-semibold"
                  disabled={busy || !email.trim()}
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Đang kiểm tra...
                    </>
                  ) : (
                    <>
                      Tiếp tục trả lời
                      <ArrowRight className="h-5 w-5" />
                    </>
                  )}
                </Button>
              </form>

              {/* THÔNG TIN GỬI PHẢN HỒI */}
              <div className="flex items-start gap-3 rounded-xl border bg-secondary/30 p-4">
                <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />

                <div className="space-y-1">
                  <p className="text-sm font-medium">Thông tin cần lưu ý</p>

                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Email được đối chiếu với danh sách đăng ký sự kiện. Mỗi email chỉ được gửi phản
                    hồi một lần cho biểu mẫu này.
                  </p>
                </div>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                Không tìm thấy email đăng ký? Hãy liên hệ ban tổ chức sự kiện.
              </p>
            </div>
          </div>
        )}

        {/* =====================================
            BƯỚC TRẢ LỜI CÂU HỎI
        ===================================== */}

        {step === "questions" && form && (
          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
            <div className="space-y-3 rounded-2xl border bg-card p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                Joinly Feedback
              </p>

              <h1 className="text-2xl font-bold">{form.title}</h1>

              {form.description && (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {form.description}
                </p>
              )}

              <div className="border-t pt-3">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  <span className="break-all">{verifiedEmail}</span>
                </p>
              </div>

              {/* THANH TIẾN ĐỘ TRẢ LỜI */}
              <div className="space-y-3 rounded-xl bg-secondary/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Tiến độ trả lời</p>

                  <span className="text-sm font-medium text-primary">
                    {answeredCount}/{questions.length} câu · {progressPercent}%
                  </span>
                </div>

                <div
                  role="progressbar"
                  aria-label="Tiến độ trả lời Feedback"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPercent}
                  className="h-2.5 overflow-hidden rounded-full bg-border"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  {requiredRemaining === 0
                    ? "Bạn đã hoàn thành các câu hỏi bắt buộc."
                    : `Còn ${requiredRemaining} câu hỏi bắt buộc chưa trả lời.`}
                </p>
              </div>

              <p className="text-xs text-muted-foreground">Dấu * là câu hỏi bắt buộc.</p>
            </div>

            {questions.map((question, index) => {
              const value = answers[question.id];
              const options = readOptions(question.options);

              const selectedOptions = Array.isArray(value) ? value : [];
              // Giới hạn số đáp án được chọn
              const maxChoices =
                question.question_type === "multi_choice" &&
                typeof question.max_choices === "number"
                  ? question.max_choices
                  : null;

              const reachedMax = maxChoices !== null && selectedOptions.length >= maxChoices;
              const isAnswered = hasAnswer(value);

              const missingRequired = attemptedSubmit && question.is_required && !isAnswered;

              return (
                <section
                  key={question.id}
                  className={`space-y-4 rounded-2xl border bg-card p-5 shadow-sm transition-colors sm:p-6 ${
                    missingRequired
                      ? "border-destructive"
                      : isAnswered
                        ? "border-primary/30"
                        : "border-border"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="min-w-0 flex-1 wrap-break-word font-semibold leading-relaxed">
                      {index + 1}. {question.title}
                      {question.is_required && <span className="ml-1 text-destructive">*</span>}
                    </h2>

                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        isAnswered
                          ? "bg-primary/10 text-primary"
                          : missingRequired
                            ? "bg-destructive/10 text-destructive"
                            : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {isAnswered
                        ? "Đã trả lời"
                        : missingRequired
                          ? "Chưa trả lời"
                          : question.is_required
                            ? "Bắt buộc"
                            : "Không bắt buộc"}
                    </span>
                  </div>

                  {missingRequired && (
                    <p className="text-xs font-medium text-destructive">
                      Vui lòng trả lời câu hỏi này trước khi gửi.
                    </p>
                  )}

                  {/* ĐÁNH GIÁ SAO */}
                  {question.question_type === "rating" && (
                    <div className="flex flex-wrap gap-3">
                      {[1, 2, 3, 4, 5].map((star) => {
                        const selected = typeof value === "number" ? value >= star : false;

                        return (
                          <button
                            key={star}
                            type="button"
                            disabled={busy}
                            aria-label={`Đánh giá ${star} sao`}
                            aria-pressed={value === star}
                            onClick={() => updateAnswer(question.id, star)}
                            className="transition-transform hover:scale-110"
                          >
                            <Star
                              className={`h-9 w-9 ${
                                selected
                                  ? "fill-amber-400 text-amber-400"
                                  : "text-muted-foreground/40"
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* TRẢ LỜI NGẮN */}
                  {question.question_type === "short_text" && (
                    <Input
                      maxLength={500}
                      disabled={busy}
                      placeholder="Nhập câu trả lời..."
                      value={typeof value === "string" ? value : ""}
                      onChange={(event) => updateAnswer(question.id, event.target.value)}
                    />
                  )}

                  {/* ĐOẠN VĂN */}
                  {question.question_type === "long_text" && (
                    <Textarea
                      rows={4}
                      maxLength={2000}
                      disabled={busy}
                      placeholder="Nhập ý kiến của bạn..."
                      value={typeof value === "string" ? value : ""}
                      onChange={(event) => updateAnswer(question.id, event.target.value)}
                    />
                  )}

                  {/* TRẮC NGHIỆM 1 LỰA CHỌN */}
                  {question.question_type === "single_choice" && (
                    <div className="space-y-3">
                      {options.map((option, i) => (
                        <label
                          key={i}
                          className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 hover:bg-secondary/50"
                        >
                          <input
                            type="radio"
                            name={`question-${question.id}`}
                            value={option}
                            disabled={busy}
                            checked={value === option}
                            onChange={() => updateAnswer(question.id, option)}
                            className="h-4 w-4 accent-primary"
                          />

                          <span className="text-sm">{option}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* CHECKBOX NHIỀU LỰA CHỌN */}
                  {question.question_type === "multi_choice" && (
                    <div className="space-y-3">
                      {/* THÔNG BÁO GIỚI HẠN */}
                      {maxChoices !== null && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/5 px-3 py-2">
                          <p className="text-sm text-muted-foreground">
                            Chọn tối đa {maxChoices} đáp án
                          </p>

                          <span className="text-sm font-semibold text-primary">
                            Đã chọn {selectedOptions.length}/{maxChoices}
                          </span>
                        </div>
                      )}

                      {/* DANH SÁCH ĐÁP ÁN */}
                      {options.map((option, i) => {
                        const checked = selectedOptions.includes(option);

                        const disabledOption = reachedMax && !checked;

                        return (
                          <label
                            key={i}
                            className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                              disabledOption
                                ? "cursor-not-allowed opacity-50"
                                : "cursor-pointer hover:bg-secondary/50"
                            } ${checked ? "border-primary bg-primary/5" : "border-border"}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={busy || disabledOption}
                              className="h-4 w-4 shrink-0 accent-primary"
                              onChange={(event) => {
                                if (event.target.checked) {
                                  if (maxChoices !== null && selectedOptions.length >= maxChoices) {
                                    toast.error(`Bạn chỉ được chọn tối đa ${maxChoices} đáp án.`);
                                    return;
                                  }

                                  updateAnswer(question.id, [...selectedOptions, option]);
                                } else {
                                  updateAnswer(
                                    question.id,
                                    selectedOptions.filter((item) => item !== option),
                                  );
                                }
                              }}
                            />

                            <span className="min-w-0 wrap-break-word text-sm">{option}</span>
                          </label>
                        );
                      })}

                      {/* THÔNG BÁO ĐÃ CHỌN ĐỦ */}
                      {reachedMax && (
                        <p className="text-xs font-medium text-primary">
                          Bạn đã chọn đủ {maxChoices} đáp án. Bỏ chọn một đáp án nếu muốn thay đổi.
                        </p>
                      )}

                      {/* KHI KHÔNG GIỚI HẠN */}
                      {maxChoices === null && (
                        <p className="text-xs text-muted-foreground">Có thể chọn nhiều đáp án.</p>
                      )}
                    </div>
                  )}
                </section>
              );
            })}

            {/* KHU VỰC GỬI FEEDBACK */}
            <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">Hoàn tất phản hồi</h2>

                <p className="text-sm text-muted-foreground">
                  Bạn đã trả lời {answeredCount}/{questions.length} câu hỏi.
                  {requiredRemaining > 0
                    ? ` Còn ${requiredRemaining} câu bắt buộc cần hoàn thành.`
                    : " Bạn có thể gửi phản hồi ngay."}
                </p>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  disabled={busy}
                  onClick={() => {
                    setStep("email");
                    setAnswers({});
                    setAttemptedSubmit(false);
                  }}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Quay lại
                </Button>

                <Button
                  type="submit"
                  className="h-11 w-full gap-2 sm:w-auto"
                  disabled={busy || questions.length === 0}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}

                  {busy ? "Đang gửi..." : "Gửi Feedback"}
                </Button>
              </div>
            </div>
          </form>
        )}

        {/* =====================================
            GỬI THÀNH CÔNG
        ===================================== */}

        {step === "done" && (
          <div className="space-y-5">
            {/* XÁC NHẬN GỬI FEEDBACK THÀNH CÔNG */}
            <section className="overflow-hidden rounded-3xl border bg-card shadow-sm">
              <div className="space-y-4 bg-primary/5 px-6 py-8 text-center sm:px-8">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <CheckCircle2 className="h-9 w-9 text-primary" />
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Joinly Feedback
                  </p>

                  <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                    Gửi phản hồi thành công!
                  </h1>

                  <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
                    Cảm ơn bạn đã dành thời gian chia sẻ ý kiến. Phản hồi của bạn đã được gửi đến
                    ban tổ chức sự kiện.
                  </p>
                </div>
              </div>

              <div className="space-y-2 px-6 py-5 sm:px-8">
                <p className="text-sm font-medium">Biểu mẫu đã hoàn thành</p>

                <p className="wrap-break-word text-sm text-muted-foreground">
                  {form?.title ?? "Feedback sự kiện"}
                </p>

                <div className="flex items-start gap-2 pt-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />

                  <span>
                    Bạn không cần thực hiện thêm thao tác nào để hoàn tất Feedback cho BTC.
                  </span>
                </div>
              </div>
            </section>

            {/* LỜI MỜI ĐÁNH GIÁ JOINLY */}
            {appReviewStep === "ask" && (
              <section className="space-y-5 rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
                <div className="space-y-3 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                    <Sparkles className="h-6 w-6 text-primary" />
                  </div>

                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                    Tùy chọn
                  </p>

                  <h2 className="text-xl font-bold">Bạn có muốn đánh giá Joinly?</h2>

                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Đánh giá về trải nghiệm sử dụng Joinly giúp chúng mình cải thiện nền tảng. Đây
                    là đánh giá riêng cho Joinly, không phải Feedback gửi ban tổ chức.
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <Button
                    type="button"
                    className="w-full gap-2 sm:w-auto"
                    onClick={() => setAppReviewStep("form")}
                  >
                    <Star className="h-4 w-4" />
                    Đánh giá Joinly
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={() => {
                      setAppReviewStep("finished");
                      setAppReviewToken(null);
                    }}
                  >
                    Để sau
                  </Button>
                </div>

                <p className="text-center text-xs text-muted-foreground">
                  Bạn có thể bỏ qua hoặc đóng trang. Feedback cho BTC đã được ghi nhận.
                </p>
              </section>
            )}

            {/* BIỂU MẪU ĐÁNH GIÁ JOINLY */}
            {appReviewStep === "form" && (
              <form
                onSubmit={(event) => void handleAppReviewSubmit(event)}
                className="space-y-5 rounded-3xl border bg-card p-6 shadow-sm sm:p-8"
              >
                <div className="space-y-2 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                    Đánh giá Joinly · Không bắt buộc
                  </p>

                  <h2 className="text-xl font-bold">Trải nghiệm của bạn thế nào?</h2>

                  <p className="text-sm text-muted-foreground">
                    Chọn từ 1 đến 5 sao. Bạn có thể để lại góp ý bên dưới.
                  </p>
                </div>

                {/* CHỌN SAO */}
                <div
                  className="flex flex-wrap justify-center gap-2"
                  role="group"
                  aria-label="Chọn số sao đánh giá Joinly"
                >
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      disabled={appReviewBusy}
                      aria-label={`Đánh giá ${star} sao`}
                      aria-pressed={appRating === star}
                      onClick={() => setAppRating(star)}
                      className="rounded-lg p-1 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
                    >
                      <Star
                        className={`h-9 w-9 sm:h-10 sm:w-10 ${
                          star <= appRating
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground/40"
                        }`}
                      />
                    </button>
                  ))}
                </div>

                <p className="text-center text-sm font-medium text-muted-foreground">
                  {appRating === 0 ? "Chưa chọn số sao" : `Bạn đã chọn ${appRating}/5 sao`}
                </p>

                {/* NHẬN XÉT */}
                <div className="space-y-2">
                  <label htmlFor="joinly-app-comment" className="text-sm font-medium">
                    Nhận xét (không bắt buộc)
                  </label>

                  <Textarea
                    id="joinly-app-comment"
                    rows={4}
                    maxLength={1000}
                    value={appComment}
                    onChange={(event) => setAppComment(event.target.value)}
                    disabled={appReviewBusy}
                    placeholder="Điều bạn thích hoặc muốn Joinly cải thiện..."
                  />

                  <p className="text-right text-xs text-muted-foreground">
                    {appComment.length}/1000
                  </p>
                </div>

                {/* NÚT GỬI VÀ BỎ QUA */}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={appReviewBusy}
                    onClick={() => {
                      setAppReviewStep("finished");
                      setAppReviewToken(null);
                    }}
                  >
                    Bỏ qua
                  </Button>

                  <Button
                    type="submit"
                    className="gap-2"
                    disabled={appReviewBusy || appRating === 0}
                  >
                    {appReviewBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}

                    {appReviewBusy ? "Đang gửi..." : "Gửi đánh giá Joinly"}
                  </Button>
                </div>

                <p className="text-center text-xs text-muted-foreground">
                  Việc đánh giá Joinly không ảnh hưởng đến Feedback đã gửi cho BTC.
                </p>
              </form>
            )}

            {/* HOÀN TẤT HOẶC BỎ QUA */}
            {appReviewStep === "finished" && (
              <section className="rounded-2xl border bg-card p-5 text-center">
                <p className="font-medium">{appReviewNote || "Cảm ơn bạn đã tham gia sự kiện!"}</p>

                <p className="mt-1 text-sm text-muted-foreground">
                  Feedback của bạn đã được gửi thành công. Bạn có thể đóng trang này.
                </p>
              </section>
            )}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">Powered by Joinly</p>
      </div>
    </main>
  );
}
