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
import { QuizMediaEffect } from "@/components/quiz/QuizMediaEffect";

import {
  finishQuizPlayerAttempt,
  getPublicQuizRoom,
  getQuizPlayerState,
  joinQuizRoom,
  submitQuizPlayerAnswer,
} from "@/lib/quiz.play.functions";

// ========================================
// ROUTE
// ========================================

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

// ========================================
// TYPES
// ========================================

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
  media_effect?: string | null;
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
    | "intro"
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
  // Đáp án người chơi đã chọn,
  // lấy từ Supabase khi mở lại trang.
  selectedIndex?: number | null;

  answeredCount?: number;
  endsAt?: string | null;

  livePhase?: "lobby" | "intro" | "question" | "reveal" | "leaderboard" | "finished" | null;

  phaseSecondsLeft?: number | null;

  // Tiến độ ảnh do backend tính.
  // Giữ nguyên khi Pause hoặc công bố sớm.
  imageProgress?: number | null;

  // Giai đoạn trước khi Host bấm Pause.
  pausedFromPhase?: "lobby" | "intro" | "question" | "reveal" | "leaderboard" | "finished" | null;

  playerCount?: number;
  potentialPoints?: number | null;

  leaderboard?: Array<{
    rank: number;
    playerName: string;
    score: number;
    correctCount: number;
  }> | null;

  reveal?: {
    correctIndex: number;
    selectedIndex: number | null;
    pointsEarned: number;
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

// ========================================
// CONSTANTS
// ========================================

const ANSWER_COLORS = ["#AAF4DE", "#C7E99A", "#FFD092", "#FFB0AA", "#BDD9FF", "#DFC7FF"];

const INTRO_SECONDS = 9;
const WORD_REVEAL_SECONDS = 5;

// ========================================
// SESSION STORAGE
// ========================================

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
    // Vẫn chơi được trong tab hiện tại.
  }
}

function forgetPlayer(code: string) {
  try {
    sessionStorage.removeItem(storageKey(code));
  } catch {
    // Không cần xử lý thêm.
  }
}

// ========================================
// ERROR MESSAGES
// ========================================

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

// ========================================
// MAIN COMPONENT
// ========================================

function QuizPlayerPage() {
  const { joinCode: rawCode } = useParams({
    from: "/quiz/$joinCode",
  });

  const joinCode = rawCode.trim().toUpperCase();

  // ======================================
  // SERVER FUNCTIONS
  // ======================================

  const getRoom = useServerFn(getPublicQuizRoom);
  const joinRoom = useServerFn(joinQuizRoom);
  const getState = useServerFn(getQuizPlayerState);

  const submitAnswer = useServerFn(submitQuizPlayerAnswer);

  const finishAttempt = useServerFn(finishQuizPlayerAttempt);

  // ======================================
  // STATE
  // ======================================

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

  const submittingRef = useRef(false);

  // ======================================
  // 1. KHỞI TẠO PHÒNG
  // ======================================

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

  // ======================================
  // 2. CẬP NHẬT GAME
  // ======================================

  const refreshGame = useCallback(async () => {
    if (!player || pollingRef.current) {
      return;
    }

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

  const gamePhase = game?.phase;

  useEffect(() => {
    if (!player || !gamePhase || result) {
      return;
    }

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

  // ======================================
  // 3. ĐỔI CÂU HỎI
  // ======================================

  useEffect(() => {
    setSelected(null);
  }, [game?.question?.id]);

  // ======================================
  // 4. ĐỒNG HỒ LIVE
  // ======================================

  useEffect(() => {
    if (game?.mode !== "live") {
      setSecondsLeft(null);
      return;
    }

    // ========================================
    // PAUSE: GIỮ CỐ ĐỊNH THỜI GIAN
    // ========================================

    if (game.phase === "paused") {
      setSecondsLeft(
        typeof game.phaseSecondsLeft === "number" ? Math.max(0, game.phaseSecondsLeft) : null,
      );

      // Không tạo interval đếm ngược khi Pause.
      return;
    }

    let msRemaining: number | null = null;

    if ((game.phase === "leaderboard" || game.phase === "intro") && game.phaseSecondsLeft != null) {
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
      const remaining = (localEnd - Date.now()) / 1000;

      // Intro cho phép remaining nhỏ hơn 0 để
      // tính đồng hồ trả lời ngay khi hết 9 giây.
      // Trên giao diện Intro vẫn không hiện giây.

      setSecondsLeft(game.phase === "intro" ? remaining : Math.max(0, remaining));
    };

    tick();

    const timer = window.setInterval(tick, 100);

    return () => {
      window.clearInterval(timer);
    };
  }, [game?.mode, game?.phase, game?.endsAt, game?.serverNow, game?.phaseSecondsLeft]);

  // ======================================
  // 5. ĐỒNG BỘ KHI INTRO HẾT GIỜ
  // ======================================

  // ======================================
  // 5. ĐỒNG BỘ MỐC 5 GIÂY / MỐC 9 GIÂY
  // ======================================

  const previewSyncNeeded =
    game?.mode === "live" &&
    game.phase === "intro" &&
    secondsLeft !== null &&
    secondsLeft <= 4 &&
    (game.question?.options.length ?? 0) === 0;

  const answerSyncNeeded =
    game?.mode === "live" && game.phase === "intro" && secondsLeft !== null && secondsLeft <= 0;

  useEffect(() => {
    if (!player || busy || (!previewSyncNeeded && !answerSyncNeeded)) {
      return;
    }

    // Đồng bộ nhanh tại hai mốc:
    // 5 giây: lấy danh sách đáp án.
    // 9 giây: xác nhận server mở Question.
    //
    // Khi đã nhận dữ liệu mới thì tự dừng.

    void refreshGame();

    const timer = window.setInterval(() => void refreshGame(), 500);

    return () => window.clearInterval(timer);
  }, [player, busy, previewSyncNeeded, answerSyncNeeded, refreshGame]);

  // ======================================
  // 6. THAM GIA QUIZ
  // ======================================

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy || !name.trim()) {
      return;
    }

    setBusy(true);
    setNotice("");

    try {
      const joined = await joinRoom({
        data: {
          joinCode,
          playerName: name.trim(),
        },
      });

      const saved: SavedPlayer = {
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

  // ======================================
  // 7. GỬI ĐÁP ÁN
  // ======================================

  async function sendChoice(index: number) {
    if (
      !player ||
      !game?.question ||
      (game.phase !== "question" && !localQuestionOpen) ||
      busy ||
      submittingRef.current
    ) {
      return;
    }

    if (game.mode === "live" && (answerSecondsLeft ?? 0) <= 0) {
      return;
    }

    submittingRef.current = true;

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
        setSelected(null);

        setNotice(messageForStatus(response.status));
      }

      const state = (await getState({
        data: player,
      })) as PlayerState;

      setGame(state);
    } catch (error) {
      setSelected(null);

      setNotice(error instanceof Error ? error.message : "Gửi đáp án thất bại.");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  // ======================================
  // 8. KẾT THÚC QUIZ
  // ======================================

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

  // ======================================
  // 9. DỮ LIỆU CÂU HỎI
  // ======================================

  const question = game?.question;
  const number = game?.questionNumber ?? 0;

  // ========================================
  // KHÔI PHỤC ĐÁP ÁN SAU KHI F5
  // ========================================

  // Khi server xác nhận đã trả lời,
  // ưu tiên đáp án được lưu trong Supabase.
  // Khi vừa bấm chọn và đang gửi,
  // dùng lựa chọn tạm trên giao diện.

  const displayedSelectedIndex =
    game?.phase === "answered" ? (game.selectedIndex ?? selected) : selected;

  // Câu hỏi và các đáp án đã được tải
  // trong giai đoạn xem trước.
  //
  // Hết 9 giây thì cho phép mở giao diện
  // Question ngay, không chờ polling.

  const localQuestionOpen =
    game?.mode === "live" &&
    game.phase === "intro" &&
    (game.question?.options.length ?? 0) > 0 &&
    secondsLeft !== null &&
    secondsLeft <= 0;

  // Đồng hồ 20 giây bắt đầu từ mốc server
  // đã cung cấp trong giai đoạn Intro.

  const answerSecondsLeft =
    localQuestionOpen && game?.question && secondsLeft !== null
      ? Math.max(0, game.question.time_limit_seconds + secondsLeft)
      : secondsLeft;

  const inAnswerPreview =
    game?.mode === "live" &&
    game.phase === "intro" &&
    (game.question?.options.length ?? 0) > 0 &&
    !localQuestionOpen;

  // ======================================
  // 10. TIẾN ĐỘ HIỆU ỨNG ẢNH
  // ======================================

  // =========================================
  // TIẾN ĐỘ ẢNH ĐỒNG BỘ LIVE QUIZ
  // =========================================

  const quizImageProgress = (() => {
    if (!question?.media_url || !game) {
      return 0;
    }

    // Self-paced: hiện toàn bộ ảnh.
    if (game.mode !== "live") {
      return 1;
    }

    // Giá trị đã được server tính tại thời điểm
    // Pause hoặc công bố đáp án.
    const serverImageProgress =
      typeof game.imageProgress === "number" && Number.isFinite(game.imageProgress)
        ? Math.max(0, Math.min(1, game.imageProgress))
        : null;

    // =====================================
    // PAUSE: ĐÓNG BĂNG HIỆU ỨNG
    // =====================================

    if (game.phase === "paused") {
      if (serverImageProgress !== null) {
        return serverImageProgress;
      }

      // Dự phòng khi API chưa gửi imageProgress.
      if (game.pausedFromPhase === "question" && game.phaseSecondsLeft != null) {
        const duration = Math.max(1, question.time_limit_seconds);

        return Math.max(0, Math.min(1, 1 - game.phaseSecondsLeft / duration));
      }

      return 0;
    }

    // =====================================
    // INTRO: CHỈ MỞ PHẦN ẢNH BAN ĐẦU
    // =====================================

    if (game.phase === "intro") {
      if (localQuestionOpen && secondsLeft !== null) {
        return Math.max(0, Math.min(1, -secondsLeft / Math.max(1, question.time_limit_seconds)));
      }

      return 0;
    }

    // =====================================
    // REVEAL: GIỮ MỨC ẢNH LÚC CÔNG BỐ
    // =====================================

    if (game.phase === "revealed") {
      return serverImageProgress ?? 1;
    }

    // Hết thời gian bình thường.
    if (game.phase === "time_up") {
      return 1;
    }

    // =====================================
    // ĐANG TRẢ LỜI / ĐÃ TRẢ LỜI
    // =====================================

    if (game.phase === "question" || game.phase === "answered") {
      const duration = Math.max(1, question.time_limit_seconds);

      const remaining = secondsLeft ?? game.phaseSecondsLeft;

      if (remaining == null) {
        return serverImageProgress ?? 0;
      }

      return Math.max(0, Math.min(1, 1 - remaining / duration));
    }

    return serverImageProgress ?? 0;
  })();

  // ======================================
  // 11. INTRO 5 GIÂY
  // ======================================

  const introWords = question?.title.trim().split(/\s+/).filter(Boolean) ?? [];

  // Khi Pause giữa Intro, dùng mốc thời gian
  // server đã đóng băng, không đếm tiếp.

  const introClock =
    game?.phase === "paused" && game.pausedFromPhase === "intro"
      ? game.phaseSecondsLeft
      : secondsLeft;

  const introRemaining = Math.max(0, Math.min(INTRO_SECONDS, introClock ?? INTRO_SECONDS));

  const introElapsed = Math.min(WORD_REVEAL_SECONDS, INTRO_SECONDS - introRemaining);
  const showingAnswerPreview =
    game?.phase === "intro" && introRemaining <= 4 && (question?.options.length ?? 0) > 0;

  // Xem đáp án trong 4 giây cuối của Intro.

  // Nếu Pause trong lúc xem đáp án,
  // giữ nguyên 4 đáp án đã xuất hiện.
  const showingPausedAnswerPreview =
    game?.phase === "paused" &&
    game.pausedFromPhase === "intro" &&
    introRemaining <= 4 &&
    (question?.options.length ?? 0) > 0;

  const introVisibleWords = Math.min(
    introWords.length,
    Math.max(1, Math.ceil(introWords.length * Math.min(1, introElapsed / WORD_REVEAL_SECONDS))),
  );

  // ======================================
  // 12. TIẾN ĐỘ GAME
  // ======================================

  const progress = game?.totalQuestions
    ? Math.min(100, Math.round((number / game.totalQuestions) * 100))
    : 0;

  const answerDisabled =
    busy ||
    (game?.phase !== "question" && !localQuestionOpen) ||
    (game?.mode === "live" && (answerSecondsLeft ?? 0) <= 0);

  // ======================================
  // 13. ĐIỂM TIỀM NĂNG
  // ======================================

  const showPotential =
    game?.mode === "live" &&
    (game.phase === "question" || localQuestionOpen) &&
    !!question &&
    answerSecondsLeft !== null &&
    answerSecondsLeft > 0;

  const crowdRatio = Math.min(1, (game?.answeredCount ?? 0) / Math.max(1, game?.playerCount ?? 1));

  // Chỉ tính thời gian khi server mở Question.
  // 4 giây xem đáp án không bị trừ thời gian.

  const elapsedSeconds = question
    ? Math.max(0, question.time_limit_seconds - (answerSecondsLeft ?? 0))
    : 0;

  // Mọi người trả lời đúng trong 0,5 giây
  // đầu đều được 1000 điểm, bất kể số
  // người khác đã trả lời trước.

  const potentialPoints =
    !showPotential || !question
      ? null
      : elapsedSeconds <= 0.5
        ? 1000
        : Math.max(
            200,
            Math.min(
              1000,
              Math.floor(
                1000 *
                  Math.max(0, 1 - (elapsedSeconds - 0.5) / question.time_limit_seconds) *
                  (1 - 0.7 * crowdRatio ** 2),
              ),
            ),
          );

  // ======================================
  // 14. GIAO DIỆN NGƯỜI CHƠI
  // ======================================

  return (
    <main className="min-h-screen bg-[#080808] px-3 py-6 text-white sm:px-5 sm:py-10">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-white/15 bg-[#0d0d0d] p-5 shadow-2xl sm:p-8">
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
        ) : game.phase === "intro" && (game.question?.options.length ?? 0) === 0 ? (
          /* ===================================
             INTRO 5 GIÂY
          =================================== */

          <div className="space-y-6 py-6 text-center">
            <div>
              <span className="inline-flex rounded-full border border-emerald-300/30 bg-emerald-300/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-emerald-300">
                Chuẩn bị câu hỏi
              </span>

              <p className="mt-3 text-sm text-white/60">
                Câu {number} / {game.totalQuestions}
              </p>
            </div>

            {/* CÂU HỎI HIỆN DẦN */}

            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8">
              {question ? (
                <h1
                  aria-label={question.title}
                  className="text-xl font-extrabold leading-relaxed sm:text-2xl"
                >
                  {introWords.map((word, index) => (
                    <span
                      key={`${question.id}-intro-${index}`}
                      aria-hidden="true"
                      className={`mr-[0.3em] inline-block transition-all duration-300 ${
                        index < introVisibleWords
                          ? "translate-y-0 opacity-100 blur-0"
                          : "translate-y-2 opacity-0 blur-sm"
                      }`}
                    >
                      {word}
                    </span>
                  ))}
                </h1>
              ) : (
                <p className="text-white/60">Đang nhận câu hỏi từ máy chủ...</p>
              )}
            </div>

            {/* ẢNH HIỆU ỨNG TRONG INTRO */}

            {question?.media_url?.trim() && (
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-2">
                <QuizMediaEffect
                  src={question.media_url}
                  effect={question.media_effect ?? "tiles9"}
                  progress={0}
                  seed={question.id}
                  alt="Ảnh minh họa câu hỏi"
                />
              </div>
            )}

            {/* CHỜ MỞ ĐÁP ÁN */}

            {/* 4 GIÂY XEM TRƯỚC ĐÁP ÁN */}

            {showingAnswerPreview && question ? (
              <div className="space-y-2.5 text-left">
                {question.options.map((option, index) => (
                  <div
                    key={`${question.id}-preview-${index}`}
                    style={{
                      backgroundColor: ANSWER_COLORS[index] ?? "#E5E7EB",
                    }}
                    className="
          flex min-h-22 w-full items-center gap-4
          rounded-2xl border-[3px] border-transparent
          px-4 py-4 text-left text-slate-950
          sm:min-h-24
        "
                  >
                    <span
                      className="
          grid h-11 w-11 shrink-0 place-items-center
          rounded-xl bg-white text-lg font-extrabold
        "
                    >
                      {String.fromCharCode(65 + index)}
                    </span>

                    <span
                      className="
          min-w-0 flex-1 wrap-break-word
          text-base font-bold leading-snug sm:text-lg
        "
                    >
                      {option}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-sm text-white/60">Đáp án sắp xuất hiện...</p>
            )}
          </div>
        ) : game.phase === "waiting" ? (
          /* PHÒNG CHỜ */

          <div className="space-y-4 py-12 text-center">
            <Users className="mx-auto h-12 w-12 text-emerald-300" />

            <h1 className="text-2xl font-bold">Đang chờ BTC bắt đầu</h1>

            <p className="text-white/70">Xin chào, {game.playerName}!</p>

            <p className="text-sm text-white/50">Trang sẽ tự cập nhật khi BTC mở câu hỏi.</p>

            <Loader2 className="mx-auto h-5 w-5 animate-spin text-white/50" />
          </div>
        ) : game.phase === "paused" ? (
          /* =====================================
             PAUSE - GIỮ CÂU HỎI VÀ ẢNH
          ===================================== */

          <div className="space-y-5 py-5">
            <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-5 text-center">
              <Clock3 className="mx-auto mb-3 h-10 w-10 text-amber-300" />

              <h1 className="text-2xl font-black text-amber-300">Quiz đang tạm dừng</h1>

              <p className="mt-2 text-sm text-white/70">
                Đồng hồ và hiệu ứng ảnh đã được giữ nguyên.
              </p>

              {game.pausedFromPhase === "question" && secondsLeft !== null && (
                <p className="mt-3 text-xl font-black tabular-nums text-white">
                  Còn {Math.ceil(secondsLeft)} giây
                </p>
              )}
            </div>

            {question && (
              <>
                {/* CÂU HỎI GIỮ NGUYÊN TIẾN ĐỘ */}

                <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center">
                  <p className="mb-2 text-xs font-bold uppercase tracking-widest text-emerald-300">
                    Câu {number}/{game.totalQuestions}
                  </p>

                  <h2 className="text-xl font-bold leading-relaxed">
                    {game.pausedFromPhase === "intro"
                      ? introWords.map((word, index) => (
                          <span
                            key={`${question.id}-paused-word-${index}`}
                            aria-hidden={index >= introVisibleWords}
                            className={`mr-[0.3em] inline-block ${
                              index < introVisibleWords ? "opacity-100" : "opacity-0"
                            }`}
                          >
                            {word}
                          </span>
                        ))
                      : question.title}
                  </h2>
                </div>

                {/* GIỮ NGUYÊN HIỆU ỨNG ẢNH */}

                {question.media_url?.trim() && (
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-2">
                    <QuizMediaEffect
                      src={question.media_url}
                      effect={question.media_effect ?? "tiles9"}
                      progress={quizImageProgress}
                      seed={question.id}
                      alt="Ảnh câu hỏi đang tạm dừng"
                    />
                  </div>
                )}

                {/* GIỮ CÁC ĐÁP ÁN ĐÃ HIỆN */}

                {(game.pausedFromPhase === "question" || showingPausedAnswerPreview) &&
                  question.options.length > 0 && (
                    <div className="space-y-2.5">
                      {question.options.map((option, index) => {
                        const chosen = (game.selectedIndex ?? selected) === index;

                        const hasSelection = (game.selectedIndex ?? selected) !== null;

                        return (
                          <div
                            key={`${question.id}-paused-${index}`}
                            className={`flex min-h-20 items-center gap-3 rounded-xl border-[3px] px-4 py-3 text-slate-950 ${
                              chosen
                                ? "border-white ring-2 ring-white/60"
                                : hasSelection
                                  ? "border-transparent opacity-40"
                                  : "border-transparent"
                            }`}
                            style={{
                              backgroundColor: ANSWER_COLORS[index] ?? "#E5E7EB",
                            }}
                          >
                            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-lg font-bold">
                              {String.fromCharCode(65 + index)}
                            </span>

                            <span className="min-w-0 flex-1 wrap-break-word text-base font-semibold">
                              {option}
                            </span>

                            {chosen && <CheckCircle2 className="h-5 w-5 shrink-0 text-slate-900" />}
                          </div>
                        );
                      })}
                    </div>
                  )}

                {game.pausedFromPhase === "intro" && !showingPausedAnswerPreview && (
                  <p className="text-center text-sm text-white/60">Đáp án chưa xuất hiện.</p>
                )}
              </>
            )}

            <p className="text-center text-xs text-white/50">
              Đang chờ BTC tiếp tục trận đấu. Bạn không thể gửi đáp án khi tạm dừng.
            </p>
          </div>
        ) : game.phase === "closed" ? (
          /* QUIZ ĐÃ ĐÓNG */

          <div className="py-12 text-center">
            <h1 className="text-xl font-bold">Quiz đã đóng</h1>

            <p className="mt-2 text-white/60">Không thể gửi thêm câu trả lời.</p>
          </div>
        ) : game.phase === "leaderboard" ? (
          /* ===================================
             BẢNG XẾP HẠNG
          =================================== */

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
          /* KẾT QUẢ LIVE */

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
          /* KẾT THÚC SELF-PACED */

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
          /* ===================================
             MÀN HÌNH TRẢ LỜI CÂU HỎI
          =================================== */

          <div>
            {/* HEADER CÂU HỎI */}

            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="font-semibold">{game.title}</span>

              <span className="text-xs text-white/70">
                Câu {number} / {game.totalQuestions}
              </span>
            </div>

            {/* TIẾN ĐỘ QUIZ */}

            <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white transition-all"
                style={{
                  width: `${progress}%`,
                }}
              />
            </div>

            {/* THỜI GIAN VÀ ĐIỂM */}

            <div
              className={`mb-6 mt-4 flex items-center justify-between text-xs sm:text-sm ${
                inAnswerPreview ? "invisible" : ""
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="h-4 w-4" />

                {game.mode === "live"
                  ? `${Math.ceil(answerSecondsLeft ?? 0)} giây`
                  : "Không giới hạn thời gian"}
              </span>

              <span className="inline-flex items-center gap-1.5">
                <Trophy className="h-4 w-4 text-yellow-400" />

                {game.phase === "revealed" && game.reveal
                  ? `+${game.reveal.pointsEarned.toLocaleString("vi-VN")} điểm câu này`
                  : game.score === null
                    ? "Điểm sau khi nộp"
                    : `${game.score.toLocaleString("vi-VN")} điểm`}
              </span>
            </div>

            {/* KHỐI ĐIỂM CÓ KÍCH THƯỚC CỐ ĐỊNH */}

            {game.mode === "live" && (
              <div className="mb-7 flex h-48 flex-col justify-center rounded-3xl border border-[#AAF4DE]/30 bg-[#092b2b] p-5 sm:p-6">
                {potentialPoints !== null ? (
                  <>
                    <div className="mb-3 flex items-end justify-between gap-3">
                      <span className="text-sm font-semibold text-[#AAF4DE]">
                        Điểm có thể nhận nếu trả lời đúng
                      </span>

                      <strong className="text-4xl font-black tabular-nums text-white sm:text-5xl">
                        {potentialPoints.toLocaleString("vi-VN")}
                      </strong>
                    </div>

                    <div className="h-3.5 overflow-hidden rounded-full bg-white/15">
                      <div
                        className="h-full rounded-full bg-[#AAF4DE] transition-[width] duration-100"
                        style={{
                          width: `${(potentialPoints / 1000) * 100}%`,
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-center text-sm font-semibold text-[#AAF4DE]">
                    {inAnswerPreview
                      ? "Đáp án đã xuất hiện. Chuẩn bị chọn đáp án!"
                      : game.phase === "answered"
                        ? "Đã ghi nhận đáp án của bạn"
                        : game.phase === "revealed"
                          ? "Kết quả đã được công bố"
                          : "Đang chờ kết quả câu hỏi"}
                  </p>
                )}
              </div>
            )}

            {/* CÂU HỎI */}

            <h1 className="mb-3 text-center text-2xl font-extrabold leading-snug sm:text-3xl lg:text-4xl">
              {question.title}
            </h1>

            <p className="mb-5 text-center text-xs text-white/60">Chọn một đáp án đúng</p>

            {/* ===================================
                16 HIỆU ỨNG ẢNH
            =================================== */}

            {question.media_url?.trim() && (
              <div className="mb-5 overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-2">
                <QuizMediaEffect
                  src={question.media_url}
                  effect={question.media_effect ?? "tiles9"}
                  progress={quizImageProgress}
                  seed={question.id}
                  alt="Ảnh minh họa câu hỏi"
                />
              </div>
            )}

            {/* ===================================
                DANH SÁCH ĐÁP ÁN
            =================================== */}

            <div className="space-y-2.5">
              {question.options.map((option, index) => {
                const isRevealed = game.phase === "revealed" && game.reveal != null;

                const correctChoice = isRevealed && game.reveal?.correctIndex === index;

                const wrongChoice =
                  isRevealed && game.reveal?.selectedIndex === index && !correctChoice;

                const chosen = isRevealed
                  ? game.reveal?.selectedIndex === index
                  : displayedSelectedIndex === index;

                const dimmed =
                  displayedSelectedIndex !== null &&
                  !isRevealed &&
                  displayedSelectedIndex !== index;

                return (
                  <button
                    key={`${question.id}-${index}`}
                    type="button"
                    disabled={answerDisabled}
                    onClick={() => {
                      if (game.mode === "live") {
                        void sendChoice(index);
                      } else {
                        setSelected(index);
                      }
                    }}
                    style={{
                      backgroundColor: ANSWER_COLORS[index] ?? "#E5E7EB",
                    }}
                    className={`
                        flex min-h-22 w-full items-center gap-4
                        rounded-2xl border-[3px] px-4 py-4 sm:min-h-24
                        text-left text-slate-950
                        transition-all
                        disabled:cursor-not-allowed

                        ${
                          correctChoice
                            ? "border-emerald-600 ring-2 ring-emerald-400"
                            : wrongChoice
                              ? "border-red-600 ring-2 ring-red-400"
                              : chosen
                                ? "border-white ring-2 ring-white/60"
                                : "border-transparent"
                        }

                        ${answerDisabled ? "" : "hover:brightness-105 active:scale-[0.99]"}

                        ${dimmed ? "opacity-40" : "opacity-100"}
                      `}
                  >
                    {/* KÝ TỰ A/B/C/D */}

                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-lg font-extrabold">
                      {String.fromCharCode(65 + index)}
                    </span>

                    {/* NỘI DUNG */}

                    <span className="min-w-0 flex-1 wrap-break-word text-base font-bold leading-snug sm:text-lg">
                      {option}
                    </span>

                    {/* TRẠNG THÁI */}

                    {correctChoice ? (
                      <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-700" />
                    ) : wrongChoice ? (
                      <XCircle className="h-6 w-6 shrink-0 text-red-700" />
                    ) : chosen ? (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-900/15 px-3 py-1 text-xs font-bold text-slate-900">
                        <CheckCircle2 className="h-4 w-4" />
                        Đã chọn
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* ===================================
                CÔNG BỐ KẾT QUẢ
            =================================== */}

            {game.phase === "revealed" && game.reveal && (
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

                {/* ĐÁP ÁN ĐÚNG */}

                <div className="rounded-xl bg-white/10 p-3">
                  <p className="text-xs text-white/60">Đáp án đúng</p>

                  <p className="mt-1 text-lg font-bold text-emerald-300">
                    {String.fromCharCode(65 + game.reveal.correctIndex)}
                    {" – "}
                    {question.options[game.reveal.correctIndex]}
                  </p>
                </div>

                {/* ĐÁP ÁN ĐÃ CHỌN */}

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

                {/* ĐIỂM */}

                <div className="flex items-center justify-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-300" />
                  <span className="text-xl font-bold text-yellow-300">
                    +{game.reveal.pointsEarned.toLocaleString("vi-VN")} điểm
                  </span>
                </div>

                {/* GIẢI THÍCH */}

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

            {/* ===================================
                NÚT LƯU SELF-PACED
            =================================== */}

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
                  ? "Đã ghi nhận đáp án. Đang chờ công bố kết quả."
                  : game.phase === "time_up" || (game.mode === "live" && answerSecondsLeft === 0)
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

        {/* FOOTER */}

        <p className="mt-4 text-center text-xs text-white/40">
          Joinly · Quiz tương tác cho sự kiện
        </p>
      </div>
    </main>
  );
}
