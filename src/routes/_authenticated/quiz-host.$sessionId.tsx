import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Check,
  Clock3,
  Copy,
  Download,
  Expand,
  ImageIcon,
  Loader2,
  Minimize,
  Pause,
  Play,
  RefreshCw,
  SkipForward,
  Trophy,
  Users,
} from "lucide-react";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { controlLiveQuiz, getLiveQuizHostState } from "@/lib/quiz.host.functions";

export const Route = createFileRoute("/_authenticated/quiz-host/$sessionId")({
  head: () => ({
    meta: [{ title: "Joinly Live Quiz — Host" }],
  }),
  component: LiveQuizHostPage,
});

type LiveStatus = "waiting" | "active" | "paused" | "finished" | "closed";

type LivePhase = "lobby" | "question" | "reveal" | "leaderboard" | "finished";

type HostAction = "start" | "pause" | "resume" | "skip" | "close";

type HostState = {
  quiz: {
    id: string;
    eventId: string;
    title: string;
    description: string | null;
  };

  session: {
    id: string;
    status: LiveStatus;
    joinCode: string | null;
    questionNumber: number;
    totalQuestions: number;
    resultsRevealed: boolean;
    autoPlayEnabled: boolean;
    livePhase: LivePhase;
    revealSeconds: number;
    leaderboardSeconds: number;
  };

  playerCount: number;
  answeredCount: number;
  answerCounts: number[];

  question: {
    id: string;
    title: string;
    options: string[];
    correct_index: number;
    time_limit_seconds: number;
    explanation?: string | null;
    media_url?: string | null;
  } | null;

  secondsLeft: number | null;
  phaseSecondsLeft: number | null;
  serverNow: string;

  leaderboard: Array<{
    rank: number;
    playerName: string;
    score: number;
    correctCount: number;
  }>;
};

const COLORS = ["#AAF4DE", "#C7E99A", "#FFD092", "#FFB0AA", "#BDD9FF", "#DFC7FF"];

const ICON_BUTTON = "border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "Có lỗi xảy ra.";
}

function timeText(seconds: number | null) {
  if (seconds === null) return "--:--";

  const n = Math.max(0, Math.ceil(seconds));

  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

function LiveQuizHostPage() {
  const { sessionId } = Route.useParams();

  const getHost = useServerFn(getLiveQuizHostState);
  const controlHost = useServerFn(controlLiveQuiz);

  const [host, setHost] = useState<HostState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<HostAction | null>(null);
  const [origin, setOrigin] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  const stageRef = useRef<HTMLElement>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);
  const fetchingRef = useRef(false);

  // =====================================
  // FULLSCREEN
  // =====================================

  useEffect(() => {
    setOrigin(window.location.origin);

    const onFullscreen = () => {
      setFullscreen(document.fullscreenElement === stageRef.current);
    };

    document.addEventListener("fullscreenchange", onFullscreen);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await stageRef.current?.requestFullscreen();
      }
    } catch {
      toast.error("Không thể bật toàn màn hình.");
    }
  }

  // =====================================
  // ĐỒNG BỘ TRẠNG THÁI HOST
  // =====================================

  const refreshHost = useCallback(
    async (silent = false) => {
      if (fetchingRef.current) return;

      fetchingRef.current = true;

      try {
        const response = (await getHost({
          data: { sessionId },
        })) as HostState;

        setHost(response);
        setError("");
      } catch (err) {
        if (!silent) {
          setError(getError(err));
        }
      } finally {
        fetchingRef.current = false;
        setLoading(false);
      }
    },
    [getHost, sessionId],
  );

  useEffect(() => {
    void refreshHost();

    // Gọi server để tự chuyển các giai đoạn.
    const timer = window.setInterval(() => {
      void refreshHost(true);
    }, 1500);

    return () => window.clearInterval(timer);
  }, [refreshHost]);

  // =====================================
  // ĐỒNG HỒ ĐẾM NGƯỢC
  // =====================================

  const status = host?.session.status;
  const phase = host?.session.livePhase ?? "lobby";

  const phaseSeconds = host?.phaseSecondsLeft ?? null;
  const legacySeconds = host?.secondsLeft ?? null;
  const serverNow = host?.serverNow;

  useEffect(() => {
    const initial = phaseSeconds ?? legacySeconds;

    if (initial === null) {
      setTimeLeft(null);
      return;
    }

    if (status !== "active") {
      setTimeLeft(initial);
      return;
    }

    const measuredAt = Date.now();

    const update = () => {
      setTimeLeft(Math.max(0, initial - (Date.now() - measuredAt) / 1000));
    };

    update();

    const timer = window.setInterval(update, 100);

    return () => window.clearInterval(timer);
  }, [phaseSeconds, legacySeconds, serverNow, status, phase]);

  // =====================================
  // ĐIỀU KHIỂN HOST
  // =====================================

  async function perform(action: HostAction) {
    if (busy || !host) return;

    if (action === "close" && !window.confirm("Bạn muốn đóng phòng chờ này?")) {
      return;
    }

    setBusy(action);

    try {
      const result = await controlHost({
        data: {
          sessionId,
          action,
        },
      });

      if (!result.ok) {
        throw new Error("Thao tác không thành công.");
      }

      if (action === "pause") {
        toast.success("Đã tạm dừng Quiz.");
      }

      if (action === "resume") {
        toast.success("Đã tiếp tục Quiz.");
      }

      if (action === "skip") {
        toast.success("Đã bỏ qua giai đoạn hiện tại.");
      }

      await refreshHost();
    } catch (err) {
      toast.error(getError(err));
    } finally {
      setBusy(null);
    }
  }

  // =====================================
  // QR CODE
  // =====================================

  const joinCode = host?.session.joinCode ?? "";

  const joinUrl = origin && joinCode ? `${origin}/quiz/${encodeURIComponent(joinCode)}` : "";

  async function copyUrl() {
    if (!joinUrl) return;

    try {
      await navigator.clipboard.writeText(joinUrl);
      toast.success("Đã sao chép link tham gia.");
    } catch {
      toast.error("Không sao chép được link.");
    }
  }

  function downloadQR() {
    if (!qrRef.current || !joinCode) return;

    const a = document.createElement("a");

    a.href = qrRef.current.toDataURL("image/png");
    a.download = `joinly-quiz-${joinCode}.png`;
    a.click();
  }

  // =====================================
  // THÔNG TIN TRÌNH CHIẾU
  // =====================================

  const question = host?.question;

  const revealed = phase === "reveal" || phase === "leaderboard" || status === "finished";

  const isPlaying = status === "active" || status === "paused";

  const progress = host?.session.totalQuestions
    ? Math.min(100, Math.round((host.session.questionNumber / host.session.totalQuestions) * 100))
    : 0;

  const timerDuration =
    phase === "question"
      ? (question?.time_limit_seconds ?? 20)
      : phase === "reveal"
        ? (host?.session.revealSeconds ?? 4)
        : phase === "leaderboard"
          ? (host?.session.leaderboardSeconds ?? 5)
          : 0;

  const timerProgress =
    timerDuration > 0 && timeLeft !== null
      ? Math.max(0, Math.min(100, (timeLeft / timerDuration) * 100))
      : 0;

  // =====================================
  // LOADING
  // =====================================

  if (loading && !host) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#031e21] text-white">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Đang tải màn hình Host...
      </div>
    );
  }

  if (!host) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#031e21] p-6 text-white">
        <p>{error || "Không tìm thấy phiên Live Quiz."}</p>

        <Button onClick={() => void refreshHost()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Thử lại
        </Button>
      </div>
    );
  }

  // =====================================
  // GIAO DIỆN HOST
  // =====================================

  return (
    <main
      ref={stageRef}
      className="relative min-h-screen overflow-x-hidden bg-[#031e21] text-white"
    >
      {/* NỀN TRANG TRÍ */}

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.13]"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_40%_30%,#095e64_0%,transparent_50%)]" />

        <div className="absolute left-[3%] top-8 whitespace-pre font-mono text-3xl leading-[1.7] tracking-[2rem] text-cyan-200">
          {"1 7 A 8 5\n3 T 2 0 7\nS 8 7 5 T\nA 0 1 4 3\n9 T 7 8 2\n7 2 S 9 8\n5 A 3 1 7\n4 7 8 T 2"}
        </div>

        <div className="absolute right-[2%] top-10 whitespace-pre font-mono text-3xl leading-[1.8] tracking-[2rem] text-cyan-200">
          {"9 3 T 5 2\nA 2 7 4 1\n6 8 T 2 7\n5 0 S A 9\n1 7 T 8 3\n4 A 9 2 7\n2 8 3 0 S\nT 7 5 2 1"}
        </div>
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1720px] flex-col">
        {/* HEADER */}

        <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-black/45 px-3 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/dashboard/$id/quiz"
              params={{ id: host.quiz.eventId }}
              aria-label="Quay lại Quản lý Quiz"
              className="rounded-lg p-2 hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>

            <span className="whitespace-nowrap font-black tracking-wide text-[#AAF4DE]">
              JOINLY QUIZ
            </span>

            <span className="hidden text-xs font-bold text-white/70 sm:block">PIN {joinCode}</span>

            <span className="hidden max-w-60 truncate text-sm font-semibold md:block">
              {host.quiz.title}
            </span>

            <span className="flex items-center gap-1 text-xs text-white/65">
              <Users className="h-3.5 w-3.5" />
              {host.playerCount}
            </span>
          </div>

          {/* CHỈ PAUSE / SKIP */}

          <div className="flex items-center gap-2">
            {isPlaying && (
              <span className="mr-1 text-xs font-bold sm:text-sm">
                Câu {host.session.questionNumber}/{host.session.totalQuestions}
              </span>
            )}

            {status === "active" && (
              <>
                <Button
                  title="Tạm dừng"
                  aria-label="Tạm dừng"
                  variant="outline"
                  size="icon"
                  className={ICON_BUTTON}
                  disabled={!!busy}
                  onClick={() => void perform("pause")}
                >
                  <Pause className="h-4 w-4" />
                </Button>

                <Button
                  title="Bỏ qua giai đoạn hiện tại"
                  aria-label="Bỏ qua giai đoạn"
                  variant="outline"
                  size="icon"
                  className={ICON_BUTTON}
                  disabled={!!busy}
                  onClick={() => void perform("skip")}
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
              </>
            )}

            {status === "paused" && (
              <Button
                title="Tiếp tục"
                aria-label="Tiếp tục"
                variant="outline"
                size="icon"
                className={ICON_BUTTON}
                disabled={!!busy}
                onClick={() => void perform("resume")}
              >
                <Play className="h-4 w-4" />
              </Button>
            )}

            <Button
              title="Toàn màn hình"
              aria-label="Toàn màn hình"
              variant="outline"
              size="icon"
              className={ICON_BUTTON}
              onClick={() => void toggleFullscreen()}
            >
              {fullscreen ? <Minimize className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        {error && (
          <p
            role="alert"
            className="m-3 rounded-lg border border-red-400/30 bg-red-500/15 p-3 text-red-100"
          >
            {error}
          </p>
        )}

        {/* =====================================
            PHÒNG CHỜ
        ===================================== */}

        {status === "waiting" && (
          <section className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10 text-center">
            <p className="text-sm font-bold uppercase tracking-[0.35em] text-[#AAF4DE]">
              Phòng chờ Live Quiz
            </p>

            <h1 className="max-w-3xl text-3xl font-black sm:text-5xl">{host.quiz.title}</h1>

            {joinUrl && (
              <>
                <div className="rounded-3xl bg-white p-4">
                  <QRCodeSVG value={joinUrl} size={220} includeMargin />
                </div>

                <div className="pointer-events-none absolute left-[-9999px]" aria-hidden="true">
                  <QRCodeCanvas ref={qrRef} value={joinUrl} size={720} includeMargin />
                </div>

                <p className="font-mono text-4xl font-black tracking-widest text-[#AAF4DE] sm:text-6xl">
                  {joinCode}
                </p>

                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="outline" className={ICON_BUTTON} onClick={() => void copyUrl()}>
                    <Copy className="mr-2 h-4 w-4" />
                    Sao chép link
                  </Button>

                  <Button variant="outline" className={ICON_BUTTON} onClick={downloadQR}>
                    <Download className="mr-2 h-4 w-4" />
                    Tải QR
                  </Button>
                </div>
              </>
            )}

            <div className="flex items-center gap-3 rounded-2xl bg-white/10 px-6 py-4">
              <Users className="text-[#AAF4DE]" />
              <strong className="text-xl">{host.playerCount}</strong>
              người đang chờ
            </div>

            <Button
              className="h-12 bg-[#AAF4DE] px-8 text-base font-black text-[#032126] hover:bg-[#8beacd]"
              disabled={!!busy || host.playerCount === 0}
              onClick={() => void perform("start")}
            >
              {busy === "start" ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Play className="mr-2 h-5 w-5" />
              )}
              Bắt đầu Quiz
            </Button>

            <Button
              variant="ghost"
              className="text-white/60 hover:bg-white/10 hover:text-white"
              disabled={!!busy}
              onClick={() => void perform("close")}
            >
              Hủy phòng
            </Button>

            {host.playerCount === 0 && (
              <p className="text-sm text-white/50">
                Cần ít nhất 1 người tham gia trước khi bắt đầu.
              </p>
            )}
          </section>
        )}

        {/* =====================================
            MÀN HÌNH ĐANG CHƠI
        ===================================== */}

        {isPlaying && (
          <section className="flex flex-1 flex-col px-4 py-5 sm:px-8 lg:px-12">
            {/* THỜI GIAN */}

            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-white/65">
                {phase === "question"
                  ? "Đang trả lời"
                  : phase === "reveal"
                    ? "Đáp án & giải thích"
                    : "Bảng xếp hạng"}
              </span>

              <div className="flex items-center gap-3">
                <span className="text-xs text-white/65">
                  {host.answeredCount}/{host.playerCount} đã trả lời
                </span>

                <span className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 font-mono text-xl font-bold tabular-nums">
                  <Clock3 className="h-4 w-4" />
                  {timeText(timeLeft)}
                </span>
              </div>
            </div>

            <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-[#AAF4DE] transition-[width] duration-100"
                style={{
                  width: `${timerProgress}%`,
                }}
              />
            </div>

            {/* =================================
                BẢNG XẾP HẠNG
            ================================= */}

            {phase === "leaderboard" ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8">
                <Trophy className="h-12 w-12 text-yellow-300" />

                <h1 className="text-center text-3xl font-black sm:text-5xl">Bảng xếp hạng</h1>

                <div className="w-full max-w-4xl space-y-3">
                  {host.leaderboard.length === 0 && (
                    <p className="text-center text-white/60">Chưa có người chơi.</p>
                  )}

                  {host.leaderboard.map((player) => (
                    <div
                      key={player.rank}
                      className={`flex items-center gap-4 rounded-2xl border-2 px-5 py-4 shadow-lg ${
                        player.rank === 1
                          ? "border-[#FFD092] bg-[#90b8c3] text-[#082024]"
                          : "border-white/15 bg-white/10 text-white"
                      }`}
                    >
                      <span className="w-10 text-center text-xl font-black">{player.rank}</span>

                      <span className="min-w-0 flex-1 truncate text-lg font-bold">
                        {player.playerName}
                      </span>

                      <span className="text-xl font-black tabular-nums">{player.score}</span>
                    </div>
                  ))}
                </div>

                <p className="text-sm text-white/55">Tự chuyển sang câu tiếp theo...</p>
              </div>
            ) : question ? (
              /* =================================
                  CÂU HỎI + ĐÁP ÁN + HÌNH
              ================================= */

              <div className="grid flex-1 items-start gap-6 lg:grid-cols-[43%_57%] lg:gap-8">
                {/* BÊN TRÁI */}

                <div className="flex flex-col gap-5">
                  <h1 className="text-center text-2xl font-black leading-tight drop-shadow-[2px_3px_0_#000] sm:text-4xl lg:text-4xl">
                    {question.title}
                  </h1>

                  <div className="grid gap-3">
                    {question.options.map((answer, index) => {
                      const correct = index === question.correct_index;

                      return (
                        <div
                          key={`${question.id}-${index}`}
                          style={{
                            backgroundColor: COLORS[index] ?? "#E5E7EB",
                          }}
                          className={`relative flex min-h-17.5 items-center justify-center rounded-[28px] border-[3px] border-[#082426] px-5 py-4 text-center text-lg font-black text-[#091c22] shadow-[0_4px_0_#000] transition-opacity sm:min-h-19.5 sm:text-xl ${
                            revealed && !correct ? "opacity-25" : ""
                          } ${revealed && correct ? "ring-4 ring-white" : ""}`}
                        >
                          <span>{answer}</span>

                          {revealed && correct && (
                            <Check className="absolute right-4 h-6 w-6 rounded-full bg-[#05291c] p-1 text-white" />
                          )}

                          {revealed && (
                            <span className="absolute bottom-1 right-4 text-xs text-[#091c22]/70">
                              {host.answerCounts[index] ?? 0} lượt
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between gap-3 text-xs text-white/60">
                    <span>
                      Câu {host.session.questionNumber}/{host.session.totalQuestions}
                    </span>

                    <span>{progress}% hoàn thành</span>
                  </div>
                </div>

                {/* BÊN PHẢI: ẢNH / GIF */}

                <div className="relative flex min-h-75 items-center justify-center overflow-hidden rounded-3xl border-[3px] border-black bg-[#10373c] lg:min-h-137.5">
                  {question.media_url ? (
                    <img
                      src={question.media_url}
                      alt="Minh họa câu hỏi"
                      className="absolute inset-0 h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-4 text-center text-white/50">
                      <ImageIcon className="h-20 w-20" />
                      <span className="text-lg">Hình ảnh / GIF câu hỏi</span>
                    </div>
                  )}

                  {/* TỰ HIỆN ĐÁP ÁN */}

                  {phase === "reveal" && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/75 p-8 text-center">
                      <p className="text-sm font-bold uppercase tracking-[0.3em] text-[#AAF4DE]">
                        Đáp án chính xác
                      </p>

                      <h2 className="text-2xl font-black sm:text-4xl">
                        {question.options[question.correct_index]}
                      </h2>

                      {question.explanation && (
                        <p className="max-w-2xl text-lg leading-relaxed text-white/90">
                          {question.explanation}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-white/70">
                Không tìm thấy câu hỏi hiện tại.
              </div>
            )}

            {/* PAUSE OVERLAY */}

            {status === "paused" && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 top-14 z-20 flex items-center justify-center bg-black/70">
                <div className="rounded-2xl bg-black/75 px-10 py-6 text-center text-2xl font-black">
                  ⏸ Quiz đang tạm dừng
                </div>
              </div>
            )}
          </section>
        )}

        {/* =====================================
            KẾT THÚC QUIZ
        ===================================== */}

        {status === "finished" && (
          <section className="flex flex-1 flex-col items-center justify-center gap-7 px-4 py-10 text-center">
            <Trophy className="h-16 w-16 text-yellow-300" />

            <h1 className="text-3xl font-black sm:text-5xl">Quiz đã kết thúc!</h1>

            <p className="text-white/60">{host.quiz.title}</p>

            {/* TOP 3 */}

            <div className="grid w-full max-w-4xl gap-3 sm:grid-cols-3">
              {host.leaderboard.slice(0, 3).map((player) => (
                <div
                  key={player.rank}
                  className={`rounded-3xl border-2 p-6 ${
                    player.rank === 1
                      ? "border-yellow-300 bg-yellow-300/15"
                      : "border-white/20 bg-white/10"
                  }`}
                >
                  <p className="text-5xl">
                    {player.rank === 1 ? "🥇" : player.rank === 2 ? "🥈" : "🥉"}
                  </p>

                  <h2 className="mt-3 wrap-break-word text-xl font-bold">{player.playerName}</h2>

                  <p className="mt-2 text-3xl font-black text-[#AAF4DE]">{player.score}</p>
                </div>
              ))}
            </div>

            {/* TOP 10 */}

            <div className="w-full max-w-3xl space-y-2 rounded-3xl bg-white/10 p-5 text-left">
              <h2 className="mb-4 text-xl font-black">Top 10</h2>

              {host.leaderboard.map((player) => (
                <div
                  key={player.rank}
                  className="flex items-center gap-3 border-b border-white/10 py-3 last:border-0"
                >
                  <span className="w-10 font-bold">#{player.rank}</span>

                  <span className="min-w-0 flex-1 truncate">{player.playerName}</span>

                  <strong>{player.score}</strong>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* PHÒNG ĐÓNG */}

        {status === "closed" && (
          <section className="flex flex-1 items-center justify-center text-3xl font-bold">
            Phòng Quiz đã đóng.
          </section>
        )}
      </div>
    </main>
  );
}
