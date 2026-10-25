import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getLiveOptionOrder, toOriginalOptionIndex } from "@/lib/quiz.shuffle";

// Các bảng Quiz chưa được thêm vào types.ts.
type QuizDb = SupabaseClient;

async function quizDb(): Promise<QuizDb> {
  // Chỉ import Supabase Admin ở server.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  return supabaseAdmin as unknown as QuizDb;
}

const joinCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6,8}$/);

const tokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
const uuid = z.string().uuid();

const codeInput = z.object({
  joinCode: joinCodeSchema,
});

const joinInput = z.object({
  joinCode: joinCodeSchema,
  playerName: z.string().trim().min(1).max(100),
});

const playerInput = z.object({
  attemptId: uuid,
  playerToken: tokenSchema,
});

const answerInput = playerInput.extend({
  questionId: uuid,
  selectedIndex: z.number().int().min(0).max(5),
});

type GameMode = "live" | "self_paced";

type Session = {
  id: string;
  quiz_id: string;
  mode: "live" | "self_paced";
  status: string;
  current_question: number;
  question_started_at: string | null;
  results_revealed: boolean;

  auto_play_enabled: boolean;
  live_phase: "lobby" | "intro" | "question" | "reveal" | "leaderboard" | "finished";

  phase_started_at: string | null;
  paused_at: string | null;
  revealed_at: string | null;
  reveal_seconds: number;
  leaderboard_seconds: number;
  scoring_player_count: number | null;
};

type Attempt = {
  id: string;
  quiz_id: string;
  session_id: string;
  player_name: string;
  score: number;
  correct_count: number;
  status: string;
};

type PublicQuestion = {
  id: string;
  title: string;
  options: string[];
  position: number;
  points: number;
  time_limit_seconds: number;

  // Ảnh/GIF minh họa.
  media_url: string | null;

  // Hiệu ứng BTC đã chọn khi tạo câu hỏi.
  media_effect: string;
};

// Tuyệt đối không lấy correct_index
// và explanation cho người chơi.

const PUBLIC_QUESTION_COLUMNS =
  "id,title,options,position,points,time_limit_seconds,media_url,media_effect";

// ======================================
// CÁC HÀM NỘI BỘ
// ======================================

async function getSessionByCode(db: QuizDb, joinCode: string) {
  const { data, error } = await db
    .from("quiz_sessions")
    .select("id,quiz_id,mode,status,current_question,question_started_at")
    .eq("join_code", joinCode)
    .maybeSingle();

  if (error) throw error;

  return data as Session | null;
}

async function getSession(db: QuizDb, attempt: Attempt) {
  const { data, error } = await db
    .from("quiz_sessions")
    .select(
      "id,quiz_id,mode,status,current_question,question_started_at,results_revealed,auto_play_enabled,live_phase,phase_started_at,paused_at,revealed_at,reveal_seconds,leaderboard_seconds,scoring_player_count",
    )

    .eq("id", attempt.session_id)
    .eq("quiz_id", attempt.quiz_id)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error("Phiên Quiz không còn tồn tại.");
  }

  return data as Session;
}

async function requirePlayer(db: QuizDb, attemptId: string, playerToken: string): Promise<Attempt> {
  const { createHash } = await import("node:crypto");

  const tokenHash = createHash("sha256").update(playerToken).digest("hex");

  const { data, error } = await db
    .from("quiz_attempts")
    .select("id,quiz_id,session_id,player_name,score,correct_count,status")
    .eq("id", attemptId)
    .eq("player_token_hash", tokenHash)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error("Phiên người chơi không hợp lệ. Hãy tham gia lại.");
  }

  return data as Attempt;
}

async function requireQuizTitle(db: QuizDb, quizId: string) {
  const { data, error } = await db
    .from("quizzes")
    .select("title,description")
    .eq("id", quizId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error("Không tìm thấy bộ Quiz.");
  }

  return {
    title: data.title as string,
    description: data.description as string | null,
  };
}

async function getQuestionCount(db: QuizDb, quizId: string) {
  const { count, error } = await db
    .from("quiz_questions")
    .select("id", {
      head: true,
      count: "exact",
    })
    .eq("quiz_id", quizId);

  if (error) throw error;

  return count ?? 0;
}

async function questionAt(db: QuizDb, quizId: string, index: number) {
  const { data, error } = await db
    .from("quiz_questions")
    .select(PUBLIC_QUESTION_COLUMNS)
    .eq("quiz_id", quizId)
    .order("position", { ascending: true })
    .order("id", { ascending: true })
    .range(index, index)
    .maybeSingle();

  if (error) throw error;

  return (data as PublicQuestion | null) ?? null;
}

// ======================================
// 1. LẤY THÔNG TIN PHÒNG QUIZ
// KHÔNG CẦN ĐĂNG NHẬP
// ======================================

export const getPublicQuizRoom = createServerFn({
  method: "POST",
})
  .inputValidator((input) => codeInput.parse(input))
  .handler(async ({ data }) => {
    const db = await quizDb();

    const session = await getSessionByCode(db, data.joinCode);

    if (!session || !["waiting", "active", "paused"].includes(session.status)) {
      return {
        status: "unavailable" as const,
      };
    }

    const quiz = await requireQuizTitle(db, session.quiz_id);

    const totalQuestions = await getQuestionCount(db, session.quiz_id);

    return {
      status: "ok" as const,
      title: quiz.title,
      description: quiz.description,
      mode: session.mode,
      sessionStatus: session.status,
      totalQuestions,
    };
  });

// ======================================
// 2. NGƯỜI CHƠI THAM GIA QUIZ
// TẠO TOKEN BẢO MẬT
// ======================================

export const joinQuizRoom = createServerFn({
  method: "POST",
})
  .inputValidator((input) => joinInput.parse(input))
  .handler(async ({ data }) => {
    const db = await quizDb();

    const session = await getSessionByCode(db, data.joinCode);

    if (!session) {
      throw new Error("Mã phòng Quiz không tồn tại.");
    }

    // Live chỉ cho tham gia khi đang chờ.
    if (session.mode === "live" && session.status !== "waiting") {
      throw new Error("Live Quiz đã bắt đầu hoặc phòng chờ đã đóng.");
    }

    // Self-paced phải đang mở.
    if (session.mode === "self_paced" && session.status !== "active") {
      throw new Error("Quiz này chưa mở hoặc đã kết thúc.");
    }

    const questionCount = await getQuestionCount(db, session.quiz_id);

    if (questionCount === 0) {
      throw new Error("Quiz chưa có câu hỏi.");
    }

    const { randomBytes, createHash } = await import("node:crypto");

    const playerToken = randomBytes(32).toString("hex");

    const tokenHash = createHash("sha256").update(playerToken).digest("hex");

    const { data: attempt, error } = await db
      .from("quiz_attempts")
      .insert({
        quiz_id: session.quiz_id,
        session_id: session.id,
        player_name: data.playerName,
        player_token_hash: tokenHash,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Join Quiz error:", error.code);

      throw new Error("Không thể tham gia Quiz. Vui lòng thử lại.");
    }

    return {
      attemptId: attempt.id as string,
      playerToken,
      playerName: data.playerName,
      mode: session.mode,
    };
  });

// ======================================
// 3. LẤY TRẠNG THÁI NGƯỜI CHƠI
// VÀ CÂU HỎI HIỆN TẠI
// ======================================

// ======================================
// THỐNG KÊ ĐÚNG PHIÊN LIVE
// ======================================

async function countLiveAnswers(db: QuizDb, sessionId: string, questionId: string) {
  // JOIN qua quiz_attempts để không đếm
  // người chơi từ phiên Live khác.

  const { count, error } = await db
    .from("quiz_answers")
    .select("id,quiz_attempts!inner(session_id)", {
      count: "exact",
      head: true,
    })
    .eq("question_id", questionId)
    .eq("quiz_attempts.session_id", sessionId);

  if (error) throw error;

  return count ?? 0;
}

// ======================================
// TOP 10 TRONG ĐÚNG PHIÊN
// ======================================

async function getLiveLeaderboard(db: QuizDb, sessionId: string) {
  const { data, error } = await db
    .from("quiz_attempts")
    .select("id,player_name,score,correct_count")
    .eq("session_id", sessionId)
    .order("score", { ascending: false })
    .order("correct_count", { ascending: false })
    .order("joined_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(10);

  if (error) throw error;

  return (data ?? []).map((item, index) => ({
    rank: index + 1,
    playerName: item.player_name as string,
    score: item.score as number,
    correctCount: item.correct_count as number,
  }));
}

// ======================================
// ĐỒNG HỒ TỪ SERVER
// ======================================

function calculateLiveImageProgress(session: Session, question: PublicQuestion | null): number {
  if (!question || !session.question_started_at) {
    return 0;
  }

  const startedAt = Date.parse(session.question_started_at);

  // Khi Pause, lấy thời điểm đã dừng.
  // Khi chơi bình thường, lấy hiện tại.
  let stoppedAt =
    session.status === "paused" && session.paused_at ? Date.parse(session.paused_at) : Date.now();

  // =====================================
  // ĐÃ REVEAL
  // =====================================

  if (session.results_revealed && session.revealed_at) {
    stoppedAt = Date.parse(session.revealed_at);

    // Sau Resume, SQL dịch question_started_at
    // và phase_started_at cùng nhau.
    // Dùng cùng hệ thời gian với Host.

    if (session.auto_play_enabled && session.phase_started_at) {
      const phaseStartedMs = Date.parse(session.phase_started_at);

      if (Number.isFinite(phaseStartedMs)) {
        if (session.live_phase === "reveal") {
          stoppedAt = phaseStartedMs;
        } else if (session.live_phase === "leaderboard") {
          stoppedAt = phaseStartedMs - session.reveal_seconds * 1000;
        }
      }
    }
  }

  if (!Number.isFinite(startedAt) || !Number.isFinite(stoppedAt)) {
    return 0;
  }

  const durationMs = Math.max(1, question.time_limit_seconds) * 1000;

  return Math.max(0, Math.min(1, (stoppedAt - startedAt) / durationMs));
}

function remainingPhaseSeconds(session: Session, duration: number): number | null {
  if (!session.phase_started_at) {
    return null;
  }

  const now =
    session.status === "paused" && session.paused_at ? Date.parse(session.paused_at) : Date.now();

  return Math.max(0, (Date.parse(session.phase_started_at) + duration * 1000 - now) / 1000);
}

// ======================================
// 3. LẤY TRẠNG THÁI NGƯỜI CHƠI
// ======================================

export const getQuizPlayerState = createServerFn({ method: "POST" })
  .inputValidator((input) => playerInput.parse(input))
  .handler(async ({ data }) => {
    const db = await quizDb();

    // Xác thực bằng token người chơi.
    const attempt = await requirePlayer(db, data.attemptId, data.playerToken);

    let session = await getSession(db, attempt);

    // ==========================================
    // LIVE AUTO PLAY - ĐỒNG BỘ KHI HOST OFFLINE
    // ==========================================

    // Người chơi có quyền xem phiên của mình
    // và có thể kích hoạt đồng bộ khi một
    // giai đoạn đã thực sự hết thời gian.
    //
    // Database quyết định chuyển giai đoạn.
    // Client không được quyết định đáp án đúng.

    // ==========================================
    // LIVE QUIZ - ĐỒNG BỘ GIAI ĐOẠN
    // ==========================================

    if (
      session.mode === "live" &&
      session.auto_play_enabled &&
      session.status === "active" &&
      session.phase_started_at
    ) {
      let duration: number | null = null;

      let currentQuestion: PublicQuestion | null = null;

      // ======================================
      // XÁC ĐỊNH THỜI LƯỢNG GIAI ĐOẠN
      // ======================================

      if (session.live_phase === "intro") {
        duration = 9;
      } else if (session.live_phase === "question") {
        currentQuestion = await questionAt(db, attempt.quiz_id, session.current_question);

        duration = currentQuestion?.time_limit_seconds ?? null;
      } else if (session.live_phase === "reveal") {
        duration = session.reveal_seconds;
      } else if (session.live_phase === "leaderboard") {
        duration = session.leaderboard_seconds;
      }

      const startedAt = Date.parse(session.phase_started_at);

      const timeExpired =
        duration !== null &&
        duration > 0 &&
        Number.isFinite(startedAt) &&
        Date.now() >= startedAt + duration * 1000;

      // ======================================
      // TẤT CẢ ĐÃ TRẢ LỜI?
      // ======================================

      let everyoneAnswered = false;

      if (
        !timeExpired &&
        session.live_phase === "question" &&
        currentQuestion &&
        session.scoring_player_count !== null &&
        session.scoring_player_count > 0
      ) {
        const answeredCount = await countLiveAnswers(db, session.id, currentQuestion.id);

        everyoneAnswered = answeredCount >= session.scoring_player_count;
      }

      // ======================================
      // YÊU CẦU DATABASE CHUYỂN GIAI ĐOẠN
      // ======================================

      if (timeExpired || everyoneAnswered) {
        const { error: tickError } = await db.rpc("quiz_live_auto_control", {
          p_session_id: session.id,
          p_action: "tick",
        });

        if (tickError) {
          throw new Error(`Không thể đồng bộ Live Quiz: ${tickError.message}`);
        }

        // Luôn đọc lại trạng thái thật.
        // Không tự suy đoán câu tiếp theo.
        session = await getSession(db, attempt);
      }
    }

    const quiz = await requireQuizTitle(db, attempt.quiz_id);

    const totalQuestions = await getQuestionCount(db, attempt.quiz_id);

    const isLive = session.mode === "live";
    const auto = isLive && session.auto_play_enabled;

    // Lấy câu hỏi hiện tại để xác định chính xác
    // thời điểm được phép công bố đáp án.

    const currentLiveQuestion =
      isLive && session.question_started_at
        ? await questionAt(db, attempt.quiz_id, session.current_question)
        : null;

    const liveDeadlineMs =
      currentLiveQuestion && session.question_started_at
        ? Date.parse(session.question_started_at) + currentLiveQuestion.time_limit_seconds * 1000
        : null;

    const revealTimeReached = liveDeadlineMs !== null && Date.now() >= liveDeadlineMs;

    const canRevealNow =
      isLive &&
      session.results_revealed &&
      (auto
        ? session.live_phase === "reveal" ||
          session.live_phase === "leaderboard" ||
          session.live_phase === "finished"
        : revealTimeReached);

    const canSeeScore = isLive && (session.status === "finished" || canRevealNow);

    const base = {
      title: quiz.title,
      mode: session.mode,
      sessionStatus: session.status,
      playerName: attempt.player_name,
      totalQuestions,
      score: canSeeScore ? attempt.score : null,
      serverNow: new Date().toISOString(),
      livePhase: auto ? session.live_phase : null,
    };

    // ==================================
    // QUIZ ĐÃ KẾT THÚC
    // ==================================

    if (attempt.status === "submitted" || session.status === "finished") {
      return {
        ...base,
        phase: "finished" as const,
        question: null,
        leaderboard: isLive ? await getLiveLeaderboard(db, session.id) : null,
      };
    }

    if (session.status === "closed") {
      return {
        ...base,
        phase: "closed" as const,
        question: null,
      };
    }

    // ========================================
    // PAUSE - GIỮ NGUYÊN CÂU HỎI VÀ ẢNH
    // ========================================

    if (session.status === "paused") {
      if (!isLive || !auto) {
        return {
          ...base,
          phase: "paused" as const,
          question: null,
        };
      }

      const pausedQuestion = await questionAt(db, attempt.quiz_id, session.current_question);

      if (!pausedQuestion) {
        return {
          ...base,
          phase: "paused" as const,
          question: null,
        };
      }

      const pausedInIntro = session.live_phase === "intro";

      const optionOrder = getLiveOptionOrder(
        session.id,
        pausedQuestion.id,
        pausedQuestion.options.length,
      );

      const displayedQuestion = {
        ...pausedQuestion,

        // Pause trong Intro:
        // không được gửi đáp án.
        options: pausedInIntro
          ? []
          : optionOrder.map((originalIndex) => pausedQuestion.options[originalIndex]),
      };

      // Khôi phục đáp án người chơi đã chọn,
      // không tiết lộ đáp án đúng.
      const { data: savedAnswer, error } = await db
        .from("quiz_answers")
        .select("selected_index,points_earned")
        .eq("attempt_id", attempt.id)
        .eq("question_id", pausedQuestion.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      const originalSelected = savedAnswer?.selected_index;

      const displaySelected =
        !pausedInIntro && typeof originalSelected === "number"
          ? optionOrder.indexOf(originalSelected)
          : -1;

      // Đồng hồ đóng băng tại paused_at.
      let frozenSeconds: number | null = null;

      if (session.live_phase === "intro") {
        frozenSeconds = remainingPhaseSeconds(session, 9);
      } else if (session.live_phase === "question") {
        frozenSeconds = remainingPhaseSeconds(session, pausedQuestion.time_limit_seconds);
      } else if (session.live_phase === "reveal") {
        frozenSeconds = remainingPhaseSeconds(session, session.reveal_seconds);
      } else if (session.live_phase === "leaderboard") {
        frozenSeconds = remainingPhaseSeconds(session, session.leaderboard_seconds);
      }

      return {
        ...base,

        phase: "paused" as const,

        pausedFromPhase: session.live_phase,

        question: displayedQuestion,

        questionNumber: session.current_question + 1,

        selectedIndex: displaySelected >= 0 ? displaySelected : null,

        // Tiến độ ảnh được cố định tại lúc Pause.
        imageProgress: calculateLiveImageProgress(session, pausedQuestion),

        phaseSecondsLeft: frozenSeconds,
      };
    }

    if (session.status === "waiting" || session.status === "draft") {
      return {
        ...base,
        phase: "waiting" as const,
        question: null,
      };
    }

    if (session.status !== "active") {
      return {
        ...base,
        phase: "closed" as const,
        question: null,
      };
    }

    // ==================================
    // LIVE QUIZ
    // ==================================

    if (isLive) {
      // ======================================
      // GIAI ĐOẠN CHUẨN BỊ CÂU HỎI - 5 GIÂY
      // ======================================

      if (auto && session.live_phase === "intro") {
        const introQuestion = await questionAt(db, attempt.quiz_id, session.current_question);

        const introRemaining = remainingPhaseSeconds(session, 9);

        // 5 giây đầu chỉ hiện câu hỏi.
        // 4 giây cuối mới gửi đáp án.
        const showOptions = introRemaining !== null && introRemaining <= 4;

        const optionOrder = introQuestion
          ? getLiveOptionOrder(session.id, introQuestion.id, introQuestion.options.length)
          : [];

        return {
          ...base,

          phase: "intro" as const,

          question: introQuestion
            ? {
                ...introQuestion,

                options: showOptions
                  ? optionOrder.map((index) => introQuestion.options[index])
                  : [],
              }
            : null,

          questionNumber: session.current_question + 1,

          endsAt: session.phase_started_at
            ? new Date(Date.parse(session.phase_started_at) + 9000).toISOString()
            : null,

          phaseSecondsLeft: introRemaining,

          potentialPoints: null,
        };
      }

      if (!session.question_started_at) {
        return {
          ...base,
          phase: "waiting" as const,
          question: null,
        };
      }

      // ==================================
      // BẢNG XẾP HẠNG
      // ==================================

      if (auto && session.live_phase === "leaderboard") {
        // Nếu Host Skip quá sớm, người chơi
        // không được xem bảng điểm trước khi
        // thời gian câu hỏi ban đầu kết thúc.

        if (!canRevealNow) {
          return {
            ...base,
            phase: "time_up" as const,
            question: currentLiveQuestion,
            questionNumber: session.current_question + 1,
            endsAt: liveDeadlineMs === null ? null : new Date(liveDeadlineMs).toISOString(),
          };
        }

        return {
          ...base,
          phase: "leaderboard" as const,
          question: null,
          questionNumber: session.current_question + 1,
          phaseSecondsLeft: remainingPhaseSeconds(session, session.leaderboard_seconds),
          leaderboard: await getLiveLeaderboard(db, session.id),
        };
      }

      // ==================================
      // CÂU HỎI HIỆN TẠI
      // ==================================

      const question = currentLiveQuestion;

      if (!question) {
        return {
          ...base,
          phase: "waiting" as const,
          question: null,
        };
      }

      const optionOrder = getLiveOptionOrder(session.id, question.id, question.options.length);

      const displayedQuestion = {
        ...question,
        options: optionOrder.map((originalIndex) => question.options[originalIndex]),
      };

      const { data: previous, error: previousError } = await db
        .from("quiz_answers")
        .select("selected_index, points_earned")
        .eq("attempt_id", attempt.id)
        .eq("question_id", question.id)
        .maybeSingle();

      if (previousError) {
        throw previousError;
      }

      const endsAtMs = Date.parse(session.question_started_at) + question.time_limit_seconds * 1000;

      const endsAt = new Date(endsAtMs).toISOString();

      const questionNumber = session.current_question + 1;

      // ==================================
      // CÔNG BỐ ĐÁP ÁN
      // ==================================

      if (canRevealNow) {
        // Chỉ truy vấn đáp án đúng sau khi
        // database đã công bố kết quả.

        const { data: key, error: keyError } = await db
          .from("quiz_questions")
          .select("correct_index,explanation")
          .eq("id", question.id)
          .eq("quiz_id", attempt.quiz_id)
          .single();

        if (keyError) {
          throw keyError;
        }

        // Database lưu vị trí đáp án gốc.
        const originalSelectedIndex = previous?.selected_index ?? null;

        const originalCorrectIndex = key.correct_index as number;

        // Chuyển sang thứ tự đang hiển thị.

        const selectedIndex =
          originalSelectedIndex === null ? null : optionOrder.indexOf(originalSelectedIndex);

        const correctIndex = optionOrder.indexOf(originalCorrectIndex);

        return {
          ...base,
          imageProgress: calculateLiveImageProgress(session, question),

          phase: "revealed" as const,

          question: displayedQuestion,
          questionNumber,

          // Nếu công bố sớm, đồng hồ trả lời
          // phải dừng ngay tại mốc Reveal.
          endsAt: auto && canRevealNow ? (session.phase_started_at ?? endsAt) : endsAt,

          phaseSecondsLeft: auto ? remainingPhaseSeconds(session, session.reveal_seconds) : null,

          reveal: {
            correctIndex,
            selectedIndex,
            pointsEarned: previous?.points_earned ?? 0,

            wasCorrect: selectedIndex === null ? null : selectedIndex === correctIndex,

            explanation: key.explanation as string | null,
          },
        };
      }

      // ==================================
      // NGƯỜI CHƠI ĐANG TRẢ LỜI
      // ==================================

      const phase =
        auto && session.live_phase !== "question"
          ? ("time_up" as const)
          : previous
            ? ("answered" as const)
            : Date.now() >= endsAtMs
              ? ("time_up" as const)
              : ("question" as const);

      // ==========================================
      // KHÔI PHỤC ĐÁP ÁN ĐÃ CHỌN
      // ==========================================

      // Supabase lưu chỉ số đáp án gốc.
      // Live Quiz đã xáo trộn A/B/C/D nên
      // phải đổi về vị trí đang hiển thị.
      const selectedDisplayIndex =
        previous && typeof previous.selected_index === "number"
          ? optionOrder.indexOf(previous.selected_index)
          : -1;

      const result = {
        ...base,

        phase,
        question: displayedQuestion,
        questionNumber,
        endsAt,

        // Chỉ trả vị trí đáp án của người này.
        // Không trả correct_index hoặc
        // thông tin đúng/sai khi chưa Reveal.
        selectedIndex:
          phase === "answered" && selectedDisplayIndex >= 0 ? selectedDisplayIndex : null,
      };

      // Giữ tương thích phiên Live cũ.
      if (!auto) {
        return result;
      }

      // ==================================
      // SỐ NGƯỜI ĐÃ TRẢ LỜI
      // ==================================

      const answeredCount = await countLiveAnswers(db, session.id, question.id);

      const playersAtStart = Math.max(1, session.scoring_player_count ?? 1);

      const crowdRatio = Math.min(1, answeredCount / playersAtStart);

      // ==================================
      // ĐIỂM GIẢM THEO THỜI GIAN
      // ==================================

      const elapsed = Math.max(0, (Date.now() - Date.parse(session.question_started_at)) / 1000);

      // 0,5 giây đầu là khoảng được 1000 điểm.
      // Không xét tỷ lệ người đã trả lời trước.
      const timeRatio = Math.max(0, 1 - Math.max(0, elapsed - 0.5) / question.time_limit_seconds);

      const potentialPoints =
        elapsed <= 0.5
          ? 1000
          : Math.min(
              1000,
              Math.max(200, Math.floor(1000 * timeRatio * (1 - 0.7 * crowdRatio ** 2))),
            );

      return {
        ...result,
        imageProgress: calculateLiveImageProgress(session, question),

        answeredCount,
        playerCount: playersAtStart,

        potentialPoints: phase === "question" ? potentialPoints : null,

        phaseSecondsLeft: remainingPhaseSeconds(session, question.time_limit_seconds),
      };
    }

    // ==================================
    // SELF-PACED GIỮ NGUYÊN
    // ==================================

    const { count: answeredCount, error: countError } = await db
      .from("quiz_answers")
      .select("id", {
        head: true,
        count: "exact",
      })
      .eq("attempt_id", attempt.id);

    if (countError) {
      throw countError;
    }

    const answered = answeredCount ?? 0;

    if (answered >= totalQuestions) {
      return {
        ...base,

        phase: "ready_to_finish" as const,

        question: null,
        answeredCount: answered,
      };
    }

    // Self-paced: mỗi người chơi có tiến độ riêng.
// "answered" được đếm từ quiz_answers theo attempt.id.
    const question = await questionAt(db, attempt.quiz_id, answered);

    if (!question) {
      throw new Error("Không thể tải câu hỏi tiếp theo.");
    }

    return {
      ...base,

      phase: "question" as const,

      question,
      questionNumber: answered + 1,
      answeredCount: answered,

      endsAt: null,
    };
  });

// ======================================
// 4. NGƯỜI CHƠI GỬI ĐÁP ÁN
// CHẤM ĐIỂM TRONG DATABASE
// ======================================

export const submitQuizPlayerAnswer = createServerFn({
  method: "POST",
})
  .inputValidator((input) => answerInput.parse(input))
  .handler(async ({ data }) => {
    const receivedAtServer = new Date().toISOString();

    const db = await quizDb();

    // Xác thực người chơi bằng token.
    const attempt = await requirePlayer(db, data.attemptId, data.playerToken);

    let session = await getSession(db, attempt);

    // Điện thoại có thể mở nút trả lời đúng mốc
    // kết thúc Intro mà chưa nhận được trạng thái
    // Question mới từ lượt polling tiếp theo.
    //
    // Nếu server đã đủ 9 giây, chuyển phase trong
    // database trước khi xử lý câu trả lời.

    if (
      session.mode === "live" &&
      session.auto_play_enabled &&
      session.status === "active" &&
      session.live_phase === "intro" &&
      session.phase_started_at &&
      Date.now() >= Date.parse(session.phase_started_at) + 9000
    ) {
      const { error: tickError } = await db.rpc("quiz_live_auto_control", {
        p_session_id: session.id,
        p_action: "tick",
      });

      if (tickError) {
        throw new Error("Không thể mở lượt trả lời. Vui lòng thử lại.");
      }

      session = await getSession(db, attempt);
    }

    let selectedIndexForDatabase = data.selectedIndex;

    // ==================================
    // LIVE QUIZ: CHUYỂN ĐÁP ÁN VỀ GỐC
    // ==================================

    if (session.mode === "live") {
      const { data: questionData, error: questionError } = await db
        .from("quiz_questions")
        .select("id,options")
        .eq("id", data.questionId)
        .eq("quiz_id", attempt.quiz_id)
        .single();

      if (questionError) {
        throw questionError;
      }

      const options = questionData.options;

      if (!Array.isArray(options) || options.length < 2 || options.length > 6) {
        throw new Error("Danh sách đáp án không hợp lệ.");
      }

      selectedIndexForDatabase = toOriginalOptionIndex(
        session.id,
        data.questionId,
        options.length,
        data.selectedIndex,
      );
    }

    // ==================================
    // SELF-PACED: GIỮ NGUYÊN ĐÁP ÁN GỐC
    // ==================================

    const { createHash } = await import("node:crypto");

    const tokenHash = createHash("sha256").update(data.playerToken).digest("hex");

    // ==================================
    // DATABASE CHẤM ĐIỂM
    // ==================================

    const { data: result, error } = await db.rpc("quiz_submit_answer_received", {
      p_attempt_id: data.attemptId,
      p_token_hash: tokenHash,
      p_question_id: data.questionId,
      p_selected_index: selectedIndexForDatabase,
      p_received_at: receivedAtServer,
    });

    if (error) {
      console.error("Submit Quiz error:", error.code);

      throw new Error("Không thể gửi đáp án. Vui lòng thử lại.");
    }

    const answerResult = result as {
      status: string;
      answered_count?: number;
      total_questions?: number;
    };

    // ======================================
    // NGƯỜI CHƠI VỪA GỬI ĐÁP ÁN
    // ======================================

    // Sau khi database chấm điểm thành công,
    // yêu cầu kiểm tra xem tất cả người chơi
    // trong phiên đã trả lời hay chưa.
    //
    // Chỉ database mới được chuyển giai đoạn.
    // Nếu tick lỗi, không hủy câu trả lời
    // đã được ghi nhận thành công.

    if (session.mode === "live" && session.auto_play_enabled && answerResult.status === "ok") {
      const { error: tickError } = await db.rpc("quiz_live_auto_control", {
        p_session_id: session.id,
        p_action: "tick",
      });

      if (tickError) {
        console.error("Live Quiz auto tick failed:", tickError.message);
      }
    }

    return answerResult;
  });

// ======================================
// 5. NỘP BÀI VÀ LẤY KẾT QUẢ
// ======================================

export const finishQuizPlayerAttempt = createServerFn({
  method: "POST",
})
  .inputValidator((input) => playerInput.parse(input))
  .handler(async ({ data }) => {
    const db = await quizDb();

    const { createHash } = await import("node:crypto");

    const tokenHash = createHash("sha256").update(data.playerToken).digest("hex");

    const { data: result, error } = await db.rpc("quiz_finish_attempt", {
      p_attempt_id: data.attemptId,
      p_token_hash: tokenHash,
    });

    if (error) {
      console.error("Finish Quiz error:", error.code);

      throw new Error("Không thể lấy kết quả Quiz. Vui lòng thử lại.");
    }

    return result as {
      status: string;
      score?: number;
      correct_count?: number;
      total_questions?: number;
      answered_count?: number;
    };
  });
