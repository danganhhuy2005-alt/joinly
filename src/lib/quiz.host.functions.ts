import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getLiveOptionOrder } from "@/lib/quiz.shuffle";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type QuizDb = SupabaseClient;
type AuthClient = SupabaseClient<Database>;

type LiveStatus = "waiting" | "active" | "paused" | "finished" | "closed";

type LivePhase = "lobby" | "question" | "reveal" | "leaderboard" | "finished";

type LiveSession = {
  id: string;
  quiz_id: string;
  mode: string;
  status: LiveStatus;
  join_code: string | null;

  current_question: number;
  question_started_at: string | null;
  paused_at: string | null;
  started_at: string | null;
  finished_at: string | null;

  results_revealed: boolean;
  revealed_at: string | null;

  auto_play_enabled: boolean;
  live_phase: LivePhase;
  phase_started_at: string | null;

  reveal_seconds: number;
  leaderboard_seconds: number;
  scoring_player_count: number | null;
};

type HostQuestion = {
  id: string;
  title: string;
  options: string[];
  position: number;
  points: number;
  time_limit_seconds: number;
  correct_index: number;
  explanation: string | null;
  media_url: string | null;
};

const SESSION_COLUMNS =
  "id,quiz_id,mode,status,join_code,current_question,question_started_at,paused_at,started_at,finished_at,results_revealed,revealed_at,auto_play_enabled,live_phase,phase_started_at,reveal_seconds,leaderboard_seconds,scoring_player_count" as const;

const sessionIdSchema = z.object({
  sessionId: z.string().uuid(),
});

// Tạm giữ các action cũ để giao diện Host
// hiện tại vẫn tương thích khi build.
// Phiên Auto Play sẽ chặn thao tác thủ công.
const controlSchema = sessionIdSchema.extend({
  action: z.enum(["start", "pause", "resume", "skip", "close", "next", "reveal", "finish"]),
});

type ControlResult = {
  ok: boolean;
  session_id: string;
  status: LiveStatus;
  current_question: number;
  total_questions: number;

  question_started_at: string | null;
  results_revealed: boolean;
  revealed_at: string | null;

  started_at: string | null;
  finished_at: string | null;

  live_phase?: LivePhase;
  phase_started_at?: string | null;
  server_now?: string;
};

// ==============================================
// SUPABASE ADMIN - SERVER ONLY
// ==============================================

async function quizDb(): Promise<QuizDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  return supabaseAdmin as unknown as QuizDb;
}

// ==============================================
// KIỂM TRA QUYỀN HOST
// Owner / Co-owner / Manager
// ==============================================

async function requireLiveHost(authClient: AuthClient, sessionId: string) {
  const db = await quizDb();

  const { data: session, error: sessionError } = await db
    .from("quiz_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) throw sessionError;

  if (!session) {
    throw new Error("Không tìm thấy phiên Quiz hoặc bạn không có quyền.");
  }

  const { data: quiz, error: quizError } = await db
    .from("quizzes")
    .select("id,event_id,title,description")
    .eq("id", session.quiz_id)
    .maybeSingle();

  if (quizError) throw quizError;

  if (!quiz) {
    throw new Error("Không tìm thấy bộ Quiz.");
  }

  // Kiểm tra vai trò bằng Supabase Auth thật,
  // không sử dụng service_role để xác thực BTC.

  const { data: role, error: roleError } = await authClient.rpc("get_event_role", {
    _event_id: quiz.event_id,
  });

  if (roleError) throw roleError;

  if (role !== "owner" && role !== "co_owner" && role !== "manager") {
    throw new Error("Bạn không có quyền điều khiển Live Quiz này.");
  }

  if (session.mode !== "live") {
    throw new Error("Phiên này không phải Live Quiz.");
  }

  return {
    db,
    session: session as LiveSession,
    quiz: {
      id: quiz.id as string,
      eventId: quiz.event_id as string,
      title: quiz.title as string,
      description: quiz.description as string | null,
    },
    role,
  };
}

// ==============================================
// ĐẾM SỐ NGƯỜI ĐÃ TRẢ LỜI
// CHỈ TÍNH TRONG PHIÊN HIỆN TẠI
// ==============================================

async function getCurrentAnswerCounts(
  db: QuizDb,
  sessionId: string,
  questionId: string,
  optionCount: number,
) {
  const answerCounts = Array<number>(optionCount).fill(0);

  let answeredCount = 0;

  // Phân trang để không bị giới hạn
  // 1.000 dòng mặc định của Supabase.

  for (let offset = 0; ; offset += 500) {
    const { data: players, error: playerError } = await db
      .from("quiz_attempts")
      .select("id")
      .eq("session_id", sessionId)
      .order("id", {
        ascending: true,
      })
      .range(offset, offset + 499);

    if (playerError) throw playerError;

    const playerIds = (players ?? []).map((player) => player.id as string);

    for (let i = 0; i < playerIds.length; i += 150) {
      const batch = playerIds.slice(i, i + 150);

      const { data: answers, error: answerError } = await db
        .from("quiz_answers")
        .select("selected_index")
        .eq("question_id", questionId)
        .in("attempt_id", batch);

      if (answerError) throw answerError;

      for (const answer of answers ?? []) {
        const selected = answer.selected_index as number;

        if (Number.isInteger(selected) && selected >= 0 && selected < optionCount) {
          answerCounts[selected]++;
          answeredCount++;
        }
      }
    }

    if (playerIds.length < 500) {
      break;
    }
  }

  return {
    answerCounts,
    answeredCount,
  };
}

// ==============================================
// TÍNH THỜI GIAN CÒN LẠI
// ==============================================

function secondsRemaining(startAt: string | null, duration: number, stopAt: number) {
  if (!startAt) {
    return null;
  }

  return Math.max(0, Math.ceil((Date.parse(startAt) + duration * 1000 - stopAt) / 1000));
}

// ==============================================
// 1. LẤY TRẠNG THÁI HOST
// TỰ ĐỒNG BỘ AUTO PLAY
// ==============================================

export const getLiveQuizHostState = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => sessionIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const authorized = await requireLiveHost(context.supabase, data.sessionId);

    const { db, quiz, role } = authorized;

    let session = authorized.session;

    // ======================================
    // TỰ CẬP NHẬT GIAI ĐOẠN
    // ======================================

    // Chỉ Host có quyền mới kích hoạt tick.
    // Đồng hồ và trạng thái xử lý trong DB.

    if (session.auto_play_enabled && session.status === "active") {
      const { error: tickError } = await db.rpc("quiz_live_auto_control", {
        p_session_id: session.id,
        p_action: "tick",
      });

      if (tickError) {
        throw new Error(tickError.message);
      }

      // Sau tick, DB có thể đã tự chuyển
      // sang Reveal, Leaderboard hoặc câu mới.
      // Bắt buộc đọc lại trạng thái mới.

      const { data: latest, error: latestError } = await db
        .from("quiz_sessions")
        .select(SESSION_COLUMNS)
        .eq("id", session.id)
        .single();

      if (latestError) {
        throw latestError;
      }

      session = latest as LiveSession;
    }

    // ======================================
    // TỔNG SỐ CÂU HỎI
    // ======================================

    const { count: totalQuestions, error: questionCountError } = await db
      .from("quiz_questions")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("quiz_id", quiz.id);

    if (questionCountError) {
      throw questionCountError;
    }

    // ======================================
    // SỐ NGƯỜI THAM GIA
    // ======================================

    const { count: playerCount, error: playerCountError } = await db
      .from("quiz_attempts")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("session_id", session.id);

    if (playerCountError) {
      throw playerCountError;
    }

    // ======================================
    // CÂU HỎI HIỆN TẠI
    // ======================================

    // correct_index chỉ được trả về cho Host
    // sau khi đã xác thực quyền ở trên.

    const { data: questionData, error: questionError } = await db
      .from("quiz_questions")
      .select(
        "id,title,options,position,points,time_limit_seconds,correct_index,explanation,media_url",
      )
      .eq("quiz_id", quiz.id)
      .order("position", {
        ascending: true,
      })
      .order("id", {
        ascending: true,
      })
      .range(session.current_question, session.current_question)
      .maybeSingle();

    if (questionError) {
      throw questionError;
    }

    const originalQuestion = (questionData as HostQuestion | null) ?? null;

    // Xác định thứ tự đáp án riêng cho phiên Live.
    // Cùng sessionId + questionId sẽ luôn có cùng thứ tự.
    const optionOrder = originalQuestion
      ? getLiveOptionOrder(session.id, originalQuestion.id, originalQuestion.options.length)
      : [];

    // Đáp án đúng chỉ được phép công bố khi:
    // 1. Đã hết thời gian trả lời.
    // 2. Database xác nhận công bố kết quả.
    const questionDeadlineMs =
      originalQuestion && session.question_started_at
        ? Date.parse(session.question_started_at) + originalQuestion.time_limit_seconds * 1000
        : null;

    const canRevealAnswer =
      questionDeadlineMs !== null &&
      Date.now() >= questionDeadlineMs &&
      (session.results_revealed || session.status === "finished");

    // Câu hỏi được gửi cho Host.
    // Không sửa dữ liệu gốc trong database.
    const question: HostQuestion | null = originalQuestion
      ? {
          ...originalQuestion,

          options: optionOrder.map((originalIndex) => originalQuestion.options[originalIndex]),

          // -1 nghĩa là chưa được công bố.
          // Không gửi đáp án đúng sớm cho trình duyệt.
          correct_index: canRevealAnswer ? optionOrder.indexOf(originalQuestion.correct_index) : -1,

          explanation: canRevealAnswer ? originalQuestion.explanation : null,
        }
      : null;

    // ======================================
    // TOP 10 NGƯỜI CHƠI
    // ======================================

    const { data: leaders, error: leadersError } = await db
      .from("quiz_attempts")
      .select("id,player_name,score,correct_count,joined_at")
      .eq("session_id", session.id)
      .order("score", {
        ascending: false,
      })
      .order("correct_count", {
        ascending: false,
      })
      .order("joined_at", {
        ascending: true,
      })
      .order("id", {
        ascending: true,
      })
      .limit(10);

    if (leadersError) {
      throw leadersError;
    }

    // ======================================
    // THỐNG KÊ LƯỢT TRẢ LỜI
    // ======================================

    let answeredCount = 0;
    let answerCounts: number[] = [];

    if (question) {
      const options = Array.isArray(question.options) ? question.options : [];

      if (session.status === "waiting") {
        answerCounts = Array<number>(options.length).fill(0);
      } else {
        const stats = await getCurrentAnswerCounts(db, session.id, question.id, options.length);

        answeredCount = stats.answeredCount;

        // Database lưu lượt chọn theo đáp án gốc.
        // Chuyển thống kê sang thứ tự Host đang hiển thị.
        answerCounts = optionOrder.map((originalIndex) => stats.answerCounts[originalIndex] ?? 0);
      }
    }

    // ======================================
    // ĐỒNG HỒ
    // ======================================

    const now = Date.now();

    // Khi Pause, dùng thời điểm dừng,
    // không dùng thời điểm hiện tại.

    const stopAt =
      session.status === "paused" && session.paused_at ? Date.parse(session.paused_at) : now;

    // Đồng hồ câu hỏi cũ,
    // giữ để tương thích với Host hiện tại.

    let secondsLeft: number | null = null;

    if (question) {
      if (session.status === "finished") {
        secondsLeft = 0;
      } else if (session.status === "active" || session.status === "paused") {
        secondsLeft =
          session.auto_play_enabled && session.live_phase !== "question"
            ? 0
            : secondsRemaining(session.question_started_at, question.time_limit_seconds, stopAt);
      }
    }

    // Đồng hồ riêng cho từng giai đoạn:
    // question / reveal / leaderboard.

    let phaseDuration: number | null = null;

    if (session.live_phase === "question" && question) {
      phaseDuration = question.time_limit_seconds;
    } else if (session.live_phase === "reveal") {
      phaseDuration = session.reveal_seconds;
    } else if (session.live_phase === "leaderboard") {
      phaseDuration = session.leaderboard_seconds;
    }

    const phaseSecondsLeft =
      session.auto_play_enabled && phaseDuration !== null
        ? secondsRemaining(session.phase_started_at, phaseDuration, stopAt)
        : null;

    // ======================================
    // TRẢ KẾT QUẢ
    // ======================================

    return {
      quiz,
      role,

      session: {
        id: session.id,
        status: session.status,

        joinCode: session.join_code,

        currentQuestion: session.current_question,

        questionNumber: question ? session.current_question + 1 : 0,

        totalQuestions: totalQuestions ?? 0,

        startedAt: session.started_at,
        finishedAt: session.finished_at,

        resultsRevealed: session.results_revealed,

        revealedAt: session.revealed_at,

        // Trường mới cho Host Auto Play.

        autoPlayEnabled: session.auto_play_enabled,

        livePhase: session.live_phase,

        phaseStartedAt: session.phase_started_at,

        pausedAt: session.paused_at,

        revealSeconds: session.reveal_seconds,

        leaderboardSeconds: session.leaderboard_seconds,

        scoringPlayerCount: session.scoring_player_count,
      },

      playerCount: playerCount ?? 0,

      answeredCount,
      answerCounts,

      question,

      secondsLeft,
      phaseSecondsLeft,

      serverNow: new Date().toISOString(),

      leaderboard: (leaders ?? []).map((player, index) => ({
        rank: index + 1,

        playerName: player.player_name as string,

        score: player.score as number,

        correctCount: player.correct_count as number,
      })),
    };
  });

// ==============================================
// 2. ĐIỀU KHIỂN LIVE QUIZ
// ==============================================

export const controlLiveQuiz = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => controlSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { db, session } = await requireLiveHost(context.supabase, data.sessionId);

    // ======================================
    // START: CẦN CÓ NGƯỜI CHƠI
    // ======================================

    if (data.action === "start") {
      const { count, error } = await db
        .from("quiz_attempts")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("session_id", session.id);

      if (error) throw error;

      if (!count) {
        throw new Error("Cần ít nhất một người chơi để bắt đầu.");
      }
    }

    // ======================================
    // TƯƠNG THÍCH PHIÊN CŨ
    // ======================================

    // Đóng phòng chờ vẫn dùng RPC cũ.
    // Phiên Live thủ công cũ vẫn hoạt động
    // theo cách điều khiển trước đây.

    const legacyAction =
      data.action === "close" || (!session.auto_play_enabled && session.status !== "waiting");

    if (legacyAction) {
      if (session.auto_play_enabled) {
        throw new Error("Live Quiz tự động chỉ hỗ trợ Tạm dừng, Tiếp tục và Bỏ qua.");
      }

      if (data.action === "skip") {
        throw new Error("Phiên Live cũ không hỗ trợ Bỏ qua tự động.");
      }

      const { data: result, error } = await db.rpc("quiz_host_control", {
        p_session_id: session.id,
        p_action: data.action,
      });

      if (error) {
        throw new Error(error.message);
      }

      return result as ControlResult;
    }

    // ======================================
    // CHẶN ĐIỀU KHIỂN THỦ CÔNG
    // ======================================

    if (data.action === "next" || data.action === "reveal" || data.action === "finish") {
      throw new Error(
        "Live Quiz tự động chuyển câu và công bố đáp án; Host không cần thao tác này.",
      );
    }

    // ======================================
    // ĐIỀU KHIỂN AUTO PLAY
    // ======================================

    // Chỉ còn:
    // start, pause, resume, skip

    const { data: result, error } = await db.rpc("quiz_live_auto_control", {
      p_session_id: session.id,
      p_action: data.action,
    });

    if (error) {
      throw new Error(error.message);
    }

    return result as ControlResult;
  });
