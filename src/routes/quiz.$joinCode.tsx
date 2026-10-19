import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Gamepad2,
  Loader2,
  RefreshCw,
  Trophy,
  Users,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  finishQuizPlayerAttempt,
  getPublicQuizRoom,
  getQuizPlayerState,
  joinQuizRoom,
  submitQuizPlayerAnswer,
} from "@/lib/quiz.play.functions";

export const Route = createFileRoute("/quiz/$joinCode")({
  head: () => ({
    meta: [
      { title: "Tham gia Quiz — Joinly" },
      {
        name: "robots",
        content: "noindex, nofollow",
      },
    ],
  }),
  component: QuizPlayerPage,
});

type GameMode = "live" | "self_paced";

type SavedPlayer = {
  attemptId: string;
  playerToken: string;
};

type RoomInfo =
  | { status: "unavailable" }
  | {
      status: "ok";
      title: string;
      description: string | null;
      mode: GameMode;
      sessionStatus: string;
      totalQuestions: number;
    };

type Question = {
  id: string;
  title: string;
  options: string[];
  position: number;
  points: number;
  time_limit_seconds: number;
  media_url?: string | null;
};

type PlayerState = {
  title: string;
  mode: GameMode;
  sessionStatus: string;
  playerName: string;
  totalQuestions: number;
  score: number | null;
  serverNow: string;

  phase:
    | "waiting"
    | "paused"
    | "question"
    | "answered"
    | "time_up"
    | "revealed"
    | "leaderboard"
    | "ready_to_finish"
    | "finished"
    | "closed";

  question: Question | null;
  questionNumber?: number;
  answeredCount?: number;
  endsAt?: string | null;

  livePhase?: "lobby" | "question" | "reveal" | "leaderboard" | "finished" | null;

  phaseSecondsLeft?: number | null;

  playerCount?: number;
  potentialPoints?: number | null;

  leaderboard?: Array<{
    rank: number;
    playerName: string;
    score: number;
    correctCount: number;
  }> | null;

  // Chỉ xuất hiện khi BTC công bố kết quả.
  reveal?: {
    correctIndex: number;
    selectedIndex: number | null;
    wasCorrect: boolean | null;
    explanation?: string | null;
  };
};

type QuizResult = {
  status: string;
  score?: number;
  correct_count?: number;
  total_questions?: number;
};

const ANSWER_COLORS = ["#AAF4DE", "#C7E99A", "#FFD092", "#FFB0AA", "#BDD9FF", "#DFC7FF"];

function storageKey(code: string) {
  return `joinly_quiz_player_${code}`;
}

function readSavedPlayer(code: string): SavedPlayer | null {
  try {
    const stored = sessionStorage.getItem(storageKey(code));

    if (!stored) return null;

    const value: unknown = JSON.parse(stored);

    if (
      typeof value === "object" &&
      value !== null &&
      "attemptId" in value &&
      "playerToken" in value &&
      typeof value.attemptId === "string" &&
      typeof value.playerToken === "string"
    ) {
      return {
        attemptId: value.attemptId,
        playerToken: value.playerToken,
      };
    }
  } catch {
    // sessionStorage có thể bị chặn.
  }

  return null;
}

function savePlayer(code: string, player: SavedPlayer) {
  try {
    sessionStorage.setItem(storageKey(code), JSON.stringify(player));
  } catch {
    // Vẫn có thể chơi trong tab hiện tại.
  }
}

function forgetPlayer(code: string) {
  try {
    sessionStorage.removeItem(storageKey(code));
  } catch {
    // Không cần xử lý thêm.
  }
}

function messageForStatus(status: string) {
  switch (status) {
    case "already_answered":
      return "Bạn đã trả lời câu hỏi này.";

    case "time_up":
      return "Đã hết thời gian trả lời.";

    case "wrong_question":
      return "Câu hỏi đã thay đổi. Đang cập nhật...";

    case "not_active":
    case "not_started":
      return "Câu hỏi chưa mở hoặc Quiz đã tạm dừng.";

    case "already_finished":
      return "Bạn đã hoàn thành lượt chơi.";

    case "invalid_player":
      return "Phiên người chơi không hợp lệ.";

    case "invalid_choice":
    case "invalid_question":
      return "Đáp án không hợp lệ. Hãy tải lại câu hỏi.";

    default:
      return "Không thể gửi đáp án. Vui lòng thử lại.";
  }
}

function QuizPlayerPage() {
  const { joinCode: rawCode } = useParams({
    from: "/quiz/$joinCode",
  });

  const joinCode = rawCode.trim().toUpperCase();

  const getRoom = useServerFn(getPublicQuizRoom);
  const joinRoom = useServerFn(joinQuizRoom);
  const getState = useServerFn(getQuizPlayerState);
  const submitAnswer = useServerFn(submitQuizPlayerAnswer);
  const finishAttempt = useServerFn(finishQuizPlayerAttempt);

  const [loading, setLoading] = useState(true);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [name, setName] = useState("");
  const [player, setPlayer] = useState<SavedPlayer | null>(null);
  const [game, setGame] = useState<PlayerState | null>(null);
  const [result, setResult] = useState<QuizResult | null>(null);

  const [selected, setSelected] = useState<number | null>(null);

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const pollingRef = useRef(false);

  // ========================================
  // 1. TẢI PHÒNG / KHÔI PHỤC NGƯỜI CHƠI
  // ========================================

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      setLoading(true);
      setRoom(null);
      setGame(null);
      setPlayer(null);
      setResult(null);
      setNotice("");

      const saved = readSavedPlayer(joinCode);

      try {
        const info = (await getRoom({
          data: { joinCode },
        })) as RoomInfo;

        if (cancelled) return;

        setRoom(info);

        if (saved) {
          try {
            const state = (await getState({
              data: saved,
            })) as PlayerState;

            if (cancelled) return;

            setPlayer(saved);
            setGame(state);
          } catch {
            if (cancelled) return;

            forgetPlayer(joinCode);

            setNotice("Phiên cũ không còn hợp lệ. Hãy tham gia lại nếu phòng còn mở.");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : "Không thể tải phòng Quiz.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [joinCode, getRoom, getState]);

  // ========================================
  // 2. CẬP NHẬT TRẠNG THÁI GAME
  // ========================================

  const refreshGame = useCallback(async () => {
    if (!player || pollingRef.current) return;

    pollingRef.current = true;

    try {
      const state = (await getState({
        data: player,
      })) as PlayerState;

      setGame(state);
      setNotice("");
    } catch {
      setNotice("Mất kết nối tạm thời. Đang thử cập nhật lại...");
    } finally {
      pollingRef.current = false;
    }
  }, [getState, player]);

  // Đồng bộ với BTC sau mỗi 2.5 giây.

  // Đồng bộ với BTC sau mỗi 2.5 giây.
  const gamePhase = game?.phase;

  useEffect(() => {
    if (!player || !gamePhase || result) return;

    if (gamePhase === "closed" || gamePhase === "finished") {
      return;
    }

    const timer = window.setInterval(() => {
      if (!busy) {
        void refreshGame();
      }
    }, 2500);

    return () => {
      window.clearInterval(timer);
    };
  }, [player, gamePhase, result, busy, refreshGame]);

  // Đổi câu hỏi thì xóa lựa chọn cũ.
  useEffect(() => {
    setSelected(null);
  }, [game?.question?.id]);

  // ========================================
  // 3. ĐỒNG HỒ LIVE QUIZ
  // ========================================

  useEffect(() => {
    if (game?.mode !== "live") {
      setSecondsLeft(null);
      return;
    }

    let msRemaining: number | null = null;

    if (game.phase === "leaderboard" && game.phaseSecondsLeft != null) {
      msRemaining = Math.max(0, game.phaseSecondsLeft * 1000);
    } else if (game.endsAt) {
      msRemaining = Math.max(0, Date.parse(game.endsAt) - Date.parse(game.serverNow));
    }

    if (msRemaining === null) {
      setSecondsLeft(null);
      return;
    }

    const localEnd = Date.now() + msRemaining;

    const tick = () => {
      setSecondsLeft(Math.max(0, (localEnd - Date.now()) / 1000));
    };

    tick();

    const timer = window.setInterval(tick, 100);

    return () => window.clearInterval(timer);
  }, [game?.mode, game?.phase, game?.endsAt, game?.serverNow, game?.phaseSecondsLeft]);

  // ========================================
  // 4. THAM GIA QUIZ
  // ========================================

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy || !name.trim()) return;

    setBusy(true);
    setNotice("");

    try {
      const joined = await joinRoom({
        data: {
          joinCode,
          playerName: name.trim(),
        },
      });

      const saved = {
        attemptId: joined.attemptId,
        playerToken: joined.playerToken,
      };

      savePlayer(joinCode, saved);
      setPlayer(saved);

      const state = (await getState({
        data: saved,
      })) as PlayerState;

      setGame(state);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể vào phòng Quiz.");
    } finally {
      setBusy(false);
    }
  }

  // ========================================
  // 5. GỬI ĐÁP ÁN
  // ========================================

  async function sendChoice(index: number) {
    if (!player || !game?.question || game.phase !== "question" || busy) {
      return;
    }

    if (game.mode === "live" && secondsLeft === 0) {
      return;
    }

    setBusy(true);
    setSelected(index);
    setNotice("");

    try {
      const response = await submitAnswer({
        data: {
          ...player,
          questionId: game.question.id,
          selectedIndex: index,
        },
      });

      if (response.status !== "ok") {
        setNotice(messageForStatus(response.status));
      }

      const state = (await getState({
        data: player,
      })) as PlayerState;

      setGame(state);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Gửi đáp án thất bại.");
    } finally {
      setBusy(false);
    }
  }

  // ========================================
  // 6. HOÀN THÀNH QUIZ
  // ========================================

  async function handleFinish() {
    if (!player || busy) return;

    setBusy(true);
    setNotice("");

    try {
      const response = (await finishAttempt({
        data: player,
      })) as QuizResult;

      if (response.status === "ok") {
        setResult(response);
      } else if (response.status === "incomplete") {
        setNotice("Bạn chưa trả lời đủ các câu hỏi.");

        await refreshGame();
      } else {
        setNotice(messageForStatus(response.status));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể lấy kết quả.");
    } finally {
      setBusy(false);
    }
  }

  const question = game?.question;
  const number = game?.questionNumber ?? 0;

  const progress = game?.totalQuestions
    ? Math.min(100, Math.round((number / game.totalQuestions) * 100))
    : 0;

  const answerDisabled =
    busy || game?.phase !== "question" || (game?.mode === "live" && (secondsLeft ?? 0) <= 0);

  // Chỉ hiện thanh điểm khi người chơi
  // đang có quyền trả lời Live Quiz.

  const showPotential =
    game?.mode === "live" &&
    game.livePhase === "question" &&
    game.phase === "question" &&
    !!question &&
    secondsLeft !== null &&
    secondsLeft > 0;

  // Tỷ lệ người đã trả lời trước.

  const crowdRatio = Math.min(1, (game?.answeredCount ?? 0) / Math.max(1, game?.playerCount ?? 1));

  // Điểm hiển thị ước tính.
  // Database vẫn là nơi tính điểm thực nhận.

  const potentialPoints =
    showPotential && question
      ? Math.max(
          200,
          Math.min(
            1000,
            Math.floor(
              1000 *
                Math.max(0, Math.min(1, (secondsLeft ?? 0) / question.time_limit_seconds)) *
                (1 - 0.7 * crowdRatio ** 2),
            ),
          ),
        )
      : null;

  // ========================================
  // 7. GIAO DIỆN NGƯỜI CHƠI
  // ========================================

  return (
    <main className="min-h-screen bg-[#080808] px-3 py-6 text-white sm:px-5 sm:py-10">
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-white/15 bg-[#0d0d0d] p-4 shadow-2xl sm:p-6">
        {/* HEADER */}

        <div className="mb-5 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-bold tracking-wide">
            <Gamepad2 className="h-3.5 w-3.5" />
            JOINLY QUIZ
          </span>

          <span className="text-xs text-white/70">Mã phòng: {joinCode}</span>
        </div>

        {/* THÔNG BÁO */}

        {notice && (
          <div
            role="status"
            className="mb-4 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-sm text-amber-100"
          >
            {notice}
          </div>
        )}

        {/* ĐANG TẢI */}

        {loading ? (
          <div className="flex min-h-52 items-center justify-center gap-2 text-white/70">
            <Loader2 className="h-5 w-5 animate-spin" />
            Đang tải Quiz...
          </div>
        ) : result ? (
          /* KẾT QUẢ CUỐI BÀI */

          <div className="space-y-4 py-8 text-center">
            <Trophy className="mx-auto h-14 w-14 text-yellow-400" />

            <h1 className="text-2xl font-bold">Hoàn thành Quiz!</h1>

            <p className="text-white/70">{game?.playerName}</p>

            <p className="text-5xl font-extrabold text-emerald-300">{result.score ?? 0}</p>

            <p className="text-white/70">điểm</p>

            <p className="text-sm">
              Đúng {result.correct_count ?? 0} / {result.total_questions ?? 0} câu
            </p>

            <p className="text-xs text-white/45">Kết quả đã được lưu trên Joinly.</p>
          </div>
        ) : !player ? (
          /* TRANG NHẬP TÊN */

          room?.status === "ok" ? (
            <div className="space-y-6 py-4">
              <div className="space-y-2 text-center">
                <h1 className="text-2xl font-bold">{room.title}</h1>

                {room.description && <p className="text-sm text-white/60">{room.description}</p>}

                <div className="flex flex-wrap justify-center gap-3 text-sm text-white/75">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-4 w-4" />

                    {room.mode === "live" ? "Live Quiz" : "Self-paced Quiz"}
                  </span>

                  <span>{room.totalQuestions} câu hỏi</span>
                </div>
              </div>

              {room.mode === "live" && room.sessionStatus !== "waiting" ? (
                <p className="rounded-xl border border-white/15 bg-white/5 p-4 text-center text-sm">
                  Live Quiz đã bắt đầu. Phòng không nhận thêm người chơi.
                </p>
              ) : room.mode === "self_paced" && room.sessionStatus !== "active" ? (
                <p className="rounded-xl border border-white/15 bg-white/5 p-4 text-center text-sm">
                  Quiz hiện không nhận người chơi mới.
                </p>
              ) : (
                <form className="mx-auto max-w-sm space-y-3" onSubmit={handleJoin}>
                  <label htmlFor="playerName" className="block text-sm font-medium">
                    Tên hiển thị của bạn
                  </label>

                  <Input
                    id="playerName"
                    autoComplete="nickname"
                    maxLength={100}
                    required
                    placeholder="Nhập tên để tham gia"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="h-12 border-white/20 bg-white text-black"
                  />

                  <Button
                    type="submit"
                    disabled={busy || !name.trim()}
                    className="h-12 w-full bg-emerald-300 font-bold text-black hover:bg-emerald-200"
                  >
                    {busy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRight className="mr-2 h-4 w-4" />
                    )}

                    {room.mode === "live" ? "Vào phòng chờ" : "Bắt đầu làm Quiz"}
                  </Button>
                </form>
              )}

              <p className="text-center text-xs text-white/45">
                Không cần đăng nhập. Tên hiển thị chưa được xác minh.
              </p>
            </div>
          ) : (
            /* PHÒNG KHÔNG TỒN TẠI */

            <div className="py-12 text-center">
              <h1 className="text-xl font-bold">Phòng Quiz không khả dụng</h1>

              <p className="mt-2 text-sm text-white/60">
                Mã phòng sai, phiên đã đóng hoặc chưa mở.
              </p>

              <Button
                type="button"
                variant="outline"
                className="mt-5"
                onClick={() => window.location.reload()}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Thử lại
              </Button>
            </div>
          )
        ) : !game ? (
          /* ĐANG VÀO PHÒNG */

          <div className="flex min-h-52 items-center justify-center gap-2 text-white/60">
            <Loader2 className="h-5 w-5 animate-spin" />
            Đang vào phòng...
          </div>
        ) : game.phase === "waiting" || game.phase === "paused" ? (
          /* LIVE - PHÒNG CHỜ */

          <div className="space-y-4 py-12 text-center">
            <Users className="mx-auto h-12 w-12 text-emerald-300" />

            <h1 className="text-2xl font-bold">
              {game.phase === "paused" ? "Quiz đang tạm dừng" : "Đang chờ BTC bắt đầu"}
            </h1>

            <p className="text-white/70">Xin chào, {game.playerName}!</p>

            <p className="text-sm text-white/50">Trang sẽ tự cập nhật khi BTC mở câu hỏi.</p>

            <Loader2 className="mx-auto h-5 w-5 animate-spin text-white/50" />
          </div>
        ) : game.phase === "closed" ? (
          /* QUIZ ĐÃ ĐÓNG */

          <div className="py-12 text-center">
            <h1 className="text-xl font-bold">Quiz đã đóng</h1>

            <p className="mt-2 text-white/60">Không thể gửi thêm câu trả lời.</p>
          </div>
        ) : game.phase === "leaderboard" ? (
          /* BẢNG XẾP HẠNG TỰ ĐỘNG */

          <div className="space-y-5 py-6">
            <Trophy className="mx-auto h-12 w-12 text-yellow-300" />

            <h1 className="text-center text-2xl font-black">Bảng xếp hạng</h1>

            <p className="text-center text-sm text-white/65">
              Câu {game.questionNumber ?? 0}/{game.totalQuestions}
              {" · "}
              Tự chuyển câu tiếp
              {secondsLeft !== null ? ` sau ${Math.ceil(secondsLeft)} giây` : ""}
            </p>

            {game.score !== null && (
              <p className="text-center text-lg font-bold text-emerald-300">
                Tổng điểm của bạn: {game.score.toLocaleString("vi-VN")}
              </p>
            )}

            <div className="space-y-2">
              {(game.leaderboard ?? []).map((entry) => (
                <div
                  key={entry.rank}
                  className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/10 px-4 py-3"
                >
                  <span className="w-9 shrink-0 font-black text-yellow-300">#{entry.rank}</span>

                  <span className="min-w-0 flex-1 truncate font-semibold">{entry.playerName}</span>

                  <strong className="tabular-nums">{entry.score.toLocaleString("vi-VN")}</strong>
                </div>
              ))}
            </div>
          </div>
        ) : game.phase === "finished" && game.mode === "live" ? (
          /* KẾT QUẢ LIVE QUIZ - KHÔNG CẦN BẤM KẾT THÚC */

          <div className="space-y-5 py-8 text-center">
            <Trophy className="mx-auto h-16 w-16 text-yellow-300" />

            <h1 className="text-3xl font-black">Quiz đã kết thúc!</h1>

            <p className="text-white/65">{game.playerName}</p>

            <p className="text-4xl font-black text-emerald-300">
              {(game.score ?? 0).toLocaleString("vi-VN")} điểm
            </p>

            <h2 className="pt-4 text-xl font-bold">Top 10</h2>

            <div className="space-y-2 text-left">
              {(game.leaderboard ?? []).map((entry) => (
                <div
                  key={entry.rank}
                  className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3"
                >
                  <span className="w-9 shrink-0 font-black text-yellow-300">#{entry.rank}</span>

                  <span className="min-w-0 flex-1 truncate">{entry.playerName}</span>

                  <strong>{entry.score.toLocaleString("vi-VN")}</strong>
                </div>
              ))}
            </div>
          </div>
        ) : game.phase === "finished" || game.phase === "ready_to_finish" ? (
          /* CHỜ XÁC NHẬN KẾT QUẢ */

          <div className="space-y-5 py-10 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-300" />

            <h1 className="text-2xl font-bold">
              {game.mode === "live" ? "BTC đã kết thúc Quiz" : "Bạn đã trả lời hết câu hỏi"}
            </h1>

            <p className="text-white/60">Nhấn nút bên dưới để xem điểm của bạn.</p>

            <Button
              onClick={() => void handleFinish()}
              disabled={busy}
              className="bg-emerald-300 text-black hover:bg-emerald-200"
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trophy className="mr-2 h-4 w-4" />
              )}
              Xem kết quả
            </Button>
          </div>
        ) : question ? (
          /* GIAO DIỆN CÂU HỎI */

          <div>
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="font-semibold">{game.title}</span>

              <span className="text-xs text-white/70">
                Câu {number} / {game.totalQuestions}
              </span>
            </div>

            {/* THANH TIẾN ĐỘ */}

            <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white transition-all"
                style={{
                  width: `${progress}%`,
                }}
              />
            </div>

            {/* ĐỒNG HỒ VÀ ĐIỂM */}

            <div className="mb-6 mt-4 flex items-center justify-between text-xs sm:text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="h-4 w-4" />

                {game.mode === "live"
                  ? `${Math.ceil(secondsLeft ?? 0)} giây`
                  : "Không giới hạn thời gian"}
              </span>

              <span className="inline-flex items-center gap-1.5">
                <Trophy className="h-4 w-4 text-yellow-400" />

                {game.score === null ? "Điểm sau khi nộp" : `${game.score} điểm`}
              </span>
            </div>

            {/* THANH ĐIỂM GIẢM DẦN */}

            {potentialPoints !== null && (
              <div className="mb-6 rounded-2xl border border-[#AAF4DE]/25 bg-[#092b2b] p-4">
                <div className="mb-2 flex items-end justify-between gap-3">
                  <span className="text-sm font-semibold text-[#AAF4DE]">
                    Điểm có thể nhận nếu trả lời đúng
                  </span>

                  <strong className="text-3xl font-black tabular-nums text-white">
                    {potentialPoints.toLocaleString("vi-VN")}
                  </strong>
                </div>

                <div className="h-3 overflow-hidden rounded-full bg-white/15">
                  <div
                    className="h-full rounded-full bg-[#AAF4DE] transition-[width] duration-100"
                    style={{
                      width: `${(potentialPoints / 1000) * 100}%`,
                    }}
                  />
                </div>

                <p className="mt-2 text-xs text-white/60">
                  {game.answeredCount ?? 0}/{game.playerCount ?? 0} người đã trả lời
                  {" · "}
                  Tối thiểu 200 điểm nếu đúng hạn
                </p>
              </div>
            )}

            {/* NỘI DUNG CÂU HỎI */}

            <h1 className="mb-2 text-center text-xl font-bold leading-relaxed sm:text-2xl">
              {question.title}
            </h1>

            <p className="mb-5 text-center text-xs text-white/60">Chọn một đáp án đúng</p>

            {/* ẢNH / GIF MINH HỌA */}

            {question.media_url && (
              <img
                src={question.media_url}
                alt="Ảnh minh họa câu hỏi"
                className="mb-5 max-h-64 w-full rounded-xl bg-white/5 object-contain"
              />
            )}

            {/* CÁC ĐÁP ÁN */}

            <div className="space-y-2.5">
              {question.options.map((option, index) => {
                const isRevealed =
                  game.phase === "revealed" &&
                  game.reveal != null &&
                  (game.mode !== "live" || secondsLeft === 0);

                const correctChoice = isRevealed && game.reveal?.correctIndex === index;

                const wrongChoice =
                  isRevealed && game.reveal?.selectedIndex === index && !correctChoice;

                const chosen = isRevealed
                  ? game.reveal?.selectedIndex === index
                  : selected === index;

                return (
                  <button
                    key={`${question.id}-${index}`}
                    type="button"
                    disabled={answerDisabled}
                    onClick={() => {
                      setSelected(index);

                      if (game.mode === "live") {
                        void sendChoice(index);
                      }
                    }}
                    style={{
                      backgroundColor: ANSWER_COLORS[index] ?? "#E5E7EB",
                    }}
                    className={`flex min-h-16 w-full items-center gap-3 rounded-xl border-[3px] px-3 py-3 text-left text-slate-950 transition-all disabled:cursor-not-allowed ${
                      correctChoice
                        ? "border-emerald-600 ring-2 ring-emerald-400"
                        : wrongChoice
                          ? "border-red-600 ring-2 ring-red-400"
                          : chosen
                            ? "border-white ring-2 ring-white/60"
                            : "border-transparent"
                    } ${answerDisabled ? "" : "hover:brightness-105 active:scale-[0.99]"}`}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white font-bold">
                      {String.fromCharCode(65 + index)}
                    </span>

                    <span className="flex-1 wrap-break-word text-sm font-semibold sm:text-base">
                      {option}
                    </span>

                    {correctChoice ? (
                      <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-700" />
                    ) : wrongChoice ? (
                      <XCircle className="h-6 w-6 shrink-0 text-red-700" />
                    ) : chosen ? (
                      <span className="shrink-0 rounded-full bg-slate-900/15 px-3 py-1 text-xs font-bold text-slate-900">
                        Đã chọn
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* KẾT QUẢ SAU KHI BTC CÔNG BỐ */}

            {game.phase === "revealed" &&
              game.reveal &&
              (game.mode !== "live" || secondsLeft === 0) && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mt-5 space-y-3 rounded-2xl border border-white/20 bg-white/5 p-5 text-center"
                >
                  {game.reveal.wasCorrect === true ? (
                    <>
                      <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-300" />

                      <h2 className="text-xl font-extrabold text-emerald-300">Chính xác!</h2>
                    </>
                  ) : game.reveal.wasCorrect === false ? (
                    <>
                      <XCircle className="mx-auto h-12 w-12 text-red-300" />

                      <h2 className="text-xl font-extrabold text-red-300">Chưa chính xác!</h2>
                    </>
                  ) : (
                    <>
                      <Clock3 className="mx-auto h-12 w-12 text-amber-300" />

                      <h2 className="text-xl font-bold text-amber-300">Bạn chưa trả lời câu này</h2>
                    </>
                  )}

                  <div className="rounded-xl bg-white/10 p-3">
                    <p className="text-xs text-white/60">Đáp án đúng</p>

                    <p className="mt-1 text-lg font-bold text-emerald-300">
                      {String.fromCharCode(65 + game.reveal.correctIndex)}
                      {" – "}
                      {question.options[game.reveal.correctIndex]}
                    </p>
                  </div>

                  {game.reveal.selectedIndex !== null && (
                    <p className="text-sm text-white/75">
                      Bạn đã chọn:{" "}
                      <strong>
                        {String.fromCharCode(65 + game.reveal.selectedIndex)}
                        {" – "}
                        {question.options[game.reveal.selectedIndex]}
                      </strong>
                    </p>
                  )}

                  <div className="flex items-center justify-center gap-2">
                    <Trophy className="h-5 w-5 text-yellow-300" />

                    <span className="text-xl font-bold">{game.score ?? 0} điểm</span>
                  </div>

                  {game.reveal.explanation && (
                    <p className="rounded-lg bg-white/10 p-3 text-sm text-white/80">
                      {game.reveal.explanation}
                    </p>
                  )}

                  <p className="text-xs text-white/50">
                    Quiz sẽ tự hiển thị bảng xếp hạng và câu tiếp theo.
                  </p>
                </div>
              )}

            {/* NÚT LƯU SELF-PACED */}

            {game.mode === "self_paced" && game.phase === "question" && (
              <Button
                className="mt-5 h-12 w-full bg-emerald-300 font-bold text-black hover:bg-emerald-200"
                disabled={busy || selected === null}
                onClick={() => {
                  if (selected !== null) {
                    void sendChoice(selected);
                  }
                }}
              >
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="mr-2 h-4 w-4" />
                )}
                Lưu đáp án và sang câu tiếp
              </Button>
            )}

            {/* TRẠNG THÁI */}

            <p role="status" className="mt-4 text-center text-xs text-white/60">
              {game.phase === "revealed"
                ? "Kết quả đã được công bố. Chờ câu tiếp theo."
                : game.phase === "answered"
                  ? "Đã ghi nhận đáp án. Kết quả sẽ hiện khi hết giờ."
                  : game.phase === "time_up" || (game.mode === "live" && secondsLeft === 0)
                    ? "Đã hết thời gian. Chờ BTC công bố kết quả."
                    : game.mode === "live"
                      ? "Chạm một đáp án để gửi ngay (không thể đổi)."
                      : "Chọn đáp án rồi bấm lưu để tiếp tục."}
            </p>
          </div>
        ) : (
          /* ĐỢI CÂU HỎI TIẾP THEO */

          <div className="py-12 text-center text-white/60">
            <p>Đang chờ câu hỏi tiếp theo...</p>

            <Loader2 className="mx-auto mt-3 h-5 w-5 animate-spin" />
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-white/40">Joinly · Quiz tương tác cho sự kiện</p>
    </main>
  );
}
