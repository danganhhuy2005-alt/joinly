import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const uuid = z.string().uuid();

const quizIdSchema = z.object({
  quizId: uuid,
});

const eventIdSchema = z.object({
  eventId: uuid,
});

const createQuizSchema = z.object({
  eventId: uuid,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(""),
});

const updateQuizSchema = z.object({
  quizId: uuid,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(""),
});

const questionSchema = z.object({
  quizId: uuid,
  questionId: uuid.optional(),
  title: z.string().trim().min(1).max(1000),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(6),
  correctIndex: z.number().int().min(0).max(5),
  position: z.number().int().min(0).max(1000),
  points: z.number().int().min(1).max(10000).default(100),
  timeLimitSeconds: z.number().int().min(5).max(300).default(20),
  explanation: z.string().trim().max(2000).default(""),
});

const excelQuestionSchema = z.object({
  title: z.string().trim().min(1).max(1000),

  options: z.tuple([
    z.string().trim().min(1).max(200),
    z.string().trim().min(1).max(200),
    z.string().trim().min(1).max(200),
    z.string().trim().min(1).max(200),
  ]),

  correctIndex: z.number().int().min(0).max(3),

  timeLimitSeconds: z
    .number()
    .int()
    .refine(
      (value) => [10, 15, 20, 30, 45, 60, 90, 120].includes(value),
      "Thời gian câu hỏi không hợp lệ.",
    ),

  explanation: z.string().trim().max(2000).default(""),
});

const importExcelQuestionsSchema = z.object({
  quizId: uuid,

  questions: z.array(excelQuestionSchema).min(1).max(100, "Mỗi lần chỉ nhập tối đa 100 câu hỏi."),
});

const moveQuestionSchema = z.object({
  quizId: uuid,
  questionId: uuid,
  direction: z.enum(["up", "down"]),
});

const sessionSchema = z.object({
  quizId: uuid,
  mode: z.enum(["live", "self_paced"]),
});

type AuthClient = SupabaseClient<Database>;
type QuizDb = SupabaseClient;
type EventRole = "owner" | "co_owner" | "manager";

async function quizDb(): Promise<QuizDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Bảng Quiz chưa được thêm vào Database types.ts.
  return supabaseAdmin as unknown as QuizDb;
}

// ==========================================
// KIỂM TRA QUYỀN BTC
// ==========================================

async function assertQuizRole(
  authClient: AuthClient,
  eventId: string,
  allowManager: boolean,
): Promise<EventRole> {
  const { data: role, error } = await authClient.rpc("get_event_role", {
    _event_id: eventId,
  });

  if (error) throw error;

  if (role !== "owner" && role !== "co_owner" && !(allowManager && role === "manager")) {
    throw new Error("Bạn không có quyền thực hiện thao tác Quiz này.");
  }

  return role;
}

// ==========================================
// LẤY BỘ CÂU HỎI
// ==========================================

async function requireQuiz(db: QuizDb, quizId: string) {
  const { data, error } = await db
    .from("quizzes")
    .select("id, event_id, title, description, created_at, updated_at")
    .eq("id", quizId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error("Không tìm thấy bộ câu hỏi Quiz.");
  }

  return data;
}

// Không sửa câu hỏi khi phiên đang mở
// hoặc khi đã có người tham gia.

async function assertQuestionsEditable(db: QuizDb, quizId: string) {
  const { count: attemptCount, error: attemptError } = await db
    .from("quiz_attempts")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("quiz_id", quizId);

  if (attemptError) throw attemptError;

  if ((attemptCount ?? 0) > 0) {
    throw new Error("Quiz đã có người tham gia. Hãy tạo bản sao để sửa câu hỏi.");
  }

  const { data: active, error: sessionError } = await db
    .from("quiz_sessions")
    .select("id")
    .eq("quiz_id", quizId)
    .in("status", ["waiting", "active", "paused"])
    .limit(1);

  if (sessionError) throw sessionError;

  if ((active ?? []).length > 0) {
    throw new Error("Hãy đóng phiên Quiz đang mở trước khi sửa câu hỏi.");
  }
}

// ==========================================
// 1. TẠO QUIZ
// Owner / Co-owner
// ==========================================

export const createQuiz = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createQuizSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertQuizRole(context.supabase, data.eventId, false);

    const db = await quizDb();

    const { data: quiz, error } = await db
      .from("quizzes")
      .insert({
        event_id: data.eventId,
        title: data.title,
        description: data.description || null,
        created_by: context.userId,
      })
      .select("id")
      .single();

    if (error) throw error;

    return {
      quizId: quiz.id as string,
    };
  });

// ==========================================
// 2. DANH SÁCH QUIZ
// Owner / Co-owner / Manager
// ==========================================

export const listQuizzes = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => eventIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertQuizRole(context.supabase, data.eventId, true);

    const db = await quizDb();

    const { data: quizzes, error } = await db
      .from("quizzes")
      .select("id, event_id, title, description, created_at, updated_at")
      .eq("event_id", data.eventId)
      .order("created_at", {
        ascending: false,
      });

    if (error) throw error;

    return quizzes ?? [];
  });

// ==========================================
// 3. LẤY QUIZ CHO BTC CHỈNH SỬA
// KHÔNG DÙNG CHO NGƯỜI CHƠI
// ==========================================

export const getQuizEditor = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quizIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await quizDb();

    const quiz = await requireQuiz(db, data.quizId);

    const role = await assertQuizRole(context.supabase, quiz.event_id, true);

    const { data: questions, error } = await db
      .from("quiz_questions")
      .select(
        "id, title, options, correct_index, position, points, time_limit_seconds, explanation",
      )
      .eq("quiz_id", quiz.id)
      .order("position", {
        ascending: true,
      })
      .order("id", {
        ascending: true,
      });

    if (error) throw error;

    const { count: attemptCount, error: countError } = await db
      .from("quiz_attempts")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("quiz_id", quiz.id);

    if (countError) throw countError;

    const { data: active, error: activeError } = await db
      .from("quiz_sessions")
      .select("id")
      .eq("quiz_id", quiz.id)
      .in("status", ["waiting", "active", "paused"])
      .limit(1);

    if (activeError) throw activeError;

    return {
      quiz,
      questions: questions ?? [],
      role,

      canEditQuestions:
        role !== "manager" && (attemptCount ?? 0) === 0 && (active ?? []).length === 0,
    };
  });

// ==========================================
// 4. SỬA THÔNG TIN QUIZ
// Owner / Co-owner
// ==========================================

export const updateQuiz = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateQuizSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await quizDb();

    const quiz = await requireQuiz(db, data.quizId);

    await assertQuizRole(context.supabase, quiz.event_id, false);

    const { error } = await db
      .from("quizzes")
      .update({
        title: data.title,
        description: data.description || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", quiz.id);

    if (error) throw error;

    return {
      ok: true as const,
    };
  });

// ==========================================
// 5. THÊM / SỬA CÂU HỎI
// Owner / Co-owner
// ==========================================

export const saveQuizQuestion = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => questionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await quizDb();

    const quiz = await requireQuiz(db, data.quizId);

    await assertQuizRole(context.supabase, quiz.event_id, false);

    await assertQuestionsEditable(db, quiz.id);

    // Kiểm tra đáp án đúng.
    if (data.correctIndex >= data.options.length) {
      throw new Error("Đáp án đúng không nằm trong các lựa chọn.");
    }

    const options = data.options.map((option) => option.trim());

    // Không cho đáp án trùng nhau.
    if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) {
      throw new Error("Các lựa chọn không được trùng nhau.");
    }

    const values = {
      title: data.title,
      options,
      correct_index: data.correctIndex,
      position: data.position,
      points: data.points,
      time_limit_seconds: data.timeLimitSeconds,
      explanation: data.explanation || null,
    };

    // Sửa câu hỏi có sẵn.
    if (data.questionId) {
      const { data: updated, error } = await db
        .from("quiz_questions")
        .update(values)
        .eq("id", data.questionId)
        .eq("quiz_id", quiz.id)
        .select("id")
        .maybeSingle();

      if (error) throw error;

      if (!updated) {
        throw new Error("Không tìm thấy câu hỏi cần sửa.");
      }

      return {
        questionId: updated.id as string,
      };
    }

    // Thêm câu hỏi mới.
    const { data: created, error } = await db
      .from("quiz_questions")
      .insert({
        ...values,
        quiz_id: quiz.id,
      })
      .select("id")
      .single();

    if (error) throw error;

    return {
      questionId: created.id as string,
    };
  });

// ==========================================
// 6. XÓA CÂU HỎI
// Owner / Co-owner
// ==========================================

// ==========================================
// NHẬP HÀNG LOẠT CÂU HỎI TỪ EXCEL
// Owner / Co-owner
// ==========================================

export const importQuizQuestions = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => importExcelQuestionsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await quizDb();

    // 1. Kiểm tra bộ Quiz tồn tại.
    const quiz = await requireQuiz(db, data.quizId);

    // 2. Chỉ Owner / Co-owner được nhập.
    await assertQuizRole(context.supabase, quiz.event_id, false);

    // 3. Không nhập nếu Quiz đã có
    // người tham gia hoặc phiên đang mở.
    await assertQuestionsEditable(db, quiz.id);

    // 4. Đọc câu hỏi hiện có để kiểm tra
    // trùng nội dung và tìm vị trí tiếp theo.
    const { data: existing, error: existingError } = await db
      .from("quiz_questions")
      .select("title,position")
      .eq("quiz_id", quiz.id)
      .order("position", {
        ascending: true,
      });

    if (existingError) {
      throw existingError;
    }

    const currentQuestions = existing ?? [];

    const normalize = (value: string) => value.trim().normalize("NFC").toLocaleLowerCase("vi-VN");

    const titles = new Set(currentQuestions.map((item) => normalize(item.title as string)));

    let nextPosition =
      currentQuestions.reduce((max, item) => Math.max(max, item.position as number), -1) + 1;

    if (nextPosition + data.questions.length - 1 > 1000) {
      throw new Error("Bộ Quiz đã vượt giới hạn thứ tự câu hỏi (0–1000).");
    }

    // 5. Kiểm tra toàn bộ dữ liệu
    // TRƯỚC KHI lưu vào Supabase.
    const rows = data.questions.map((question, index) => {
      const title = question.title.trim();
      const normalizedTitle = normalize(title);

      if (titles.has(normalizedTitle)) {
        throw new Error(`Câu ${index + 1}: Nội dung bị trùng: "${title}".`);
      }

      titles.add(normalizedTitle);

      const options = question.options.map((value) => value.trim());

      const uniqueOptions = new Set(options.map(normalize));

      if (uniqueOptions.size !== options.length) {
        throw new Error(`Câu ${index + 1}: Các đáp án A/B/C/D bị trùng.`);
      }

      return {
        quiz_id: quiz.id,
        title,
        options,
        correct_index: question.correctIndex,
        time_limit_seconds: question.timeLimitSeconds,
        explanation: question.explanation.trim() || null,

        // Điểm tự động, không cần nhập Excel.
        points: 1000,

        position: nextPosition++,
      };
    });

    // 6. Ghi tất cả bằng một INSERT.
    // PostgreSQL xử lý statement này
    // theo tính nguyên tử: thành công
    // toàn bộ hoặc thất bại toàn bộ.
    const { error: insertError } = await db.from("quiz_questions").insert(rows);

    if (insertError) {
      throw new Error(`Không thể nhập câu hỏi: ${insertError.message}`);
    }

    return {
      ok: true as const,
      imported: rows.length,
    };
  });

// ==========================================
// ĐỔI THỨ TỰ CÂU HỎI QUIZ
// Owner / Co-owner
// ==========================================

export const moveQuizQuestion = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => moveQuestionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await quizDb();

    // 1. Kiểm tra bộ Quiz tồn tại.
    const quiz = await requireQuiz(db, data.quizId);

    // 2. Chỉ Owner / Co-owner được đổi thứ tự.
    await assertQuizRole(context.supabase, quiz.event_id, false);

    // 3. Không cho đổi nếu Quiz đã có
    // người tham gia hoặc phiên đang mở.
    await assertQuestionsEditable(db, quiz.id);

    // 4. Gọi hàm PostgreSQL để đổi
    // thứ tự trong một giao dịch.
    const { data: result, error } = await db.rpc("quiz_move_question", {
      p_quiz_id: quiz.id,
      p_question_id: data.questionId,
      p_direction: data.direction,
    });

    if (error) {
      throw new Error(`Không thể đổi thứ tự câu hỏi: ${error.message}`);
    }

    const output = result as {
      ok?: boolean;
      moved?: boolean;
      position?: number;
    } | null;

    if (!output?.ok) {
      throw new Error("Không thể cập nhật thứ tự câu hỏi.");
    }

    return {
      ok: true as const,
      moved: output.moved === true,
      position: typeof output.position === "number" ? output.position : null,
    };
  });

export const deleteQuizQuestion = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        quizId: uuid,
        questionId: uuid,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await quizDb();

    const quiz = await requireQuiz(db, data.quizId);

    await assertQuizRole(context.supabase, quiz.event_id, false);

    await assertQuestionsEditable(db, quiz.id);

    const { data: deleted, error } = await db
      .from("quiz_questions")
      .delete()
      .eq("id", data.questionId)
      .eq("quiz_id", quiz.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;

    if (!deleted) {
      throw new Error("Không tìm thấy câu hỏi cần xóa.");
    }

    return {
      ok: true as const,
    };
  });

// ==========================================
// 7. XÓA QUIZ CHƯA CÓ PHIÊN CHƠI
// Owner / Co-owner
// ==========================================

export const deleteUnusedQuiz = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quizIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await quizDb();

    const quiz = await requireQuiz(db, data.quizId);

    await assertQuizRole(context.supabase, quiz.event_id, false);

    const { count, error: countError } = await db
      .from("quiz_sessions")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("quiz_id", quiz.id);

    if (countError) throw countError;

    if ((count ?? 0) > 0) {
      throw new Error("Quiz đã có phiên chơi, không thể xóa dữ liệu.");
    }

    const { error } = await db.from("quizzes").delete().eq("id", quiz.id);

    if (error) throw error;

    return {
      ok: true as const,
    };
  });

// ==========================================
// 8. TẠO PHIÊN CHƠI
// LIVE / SELF-PACED
// ==========================================

export const createQuizSession = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => sessionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await quizDb();

    const quiz = await requireQuiz(db, data.quizId);

    // Manager được tạo phiên chơi.
    await assertQuizRole(context.supabase, quiz.event_id, true);

    // Quiz phải có câu hỏi.
    const { count, error: questionError } = await db
      .from("quiz_questions")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("quiz_id", quiz.id);

    if (questionError) throw questionError;

    if (!count) {
      throw new Error("Hãy tạo ít nhất một câu hỏi trước.");
    }

    // Không tạo hai phiên đang mở cùng chế độ.

    const { randomBytes } = await import("node:crypto");

    // Live bắt đầu ở phòng chờ.
    // Self-paced mở làm bài ngay.
    const status = data.mode === "live" ? "waiting" : "active";

    // Sinh mã phòng ngẫu nhiên.
    // Nếu trùng mã, tự sinh lại.
    for (let attempt = 0; attempt < 5; attempt++) {
      const joinCode = randomBytes(4).toString("hex").toUpperCase();

      const { data: session, error } = await db
        .from("quiz_sessions")
        .insert({
          quiz_id: quiz.id,
          mode: data.mode,
          status,
          join_code: joinCode,
          created_by: context.userId,

          started_at: data.mode === "self_paced" ? new Date().toISOString() : null,
        })
        .select("id, mode, status, join_code")
        .single();

      if (!error && session) {
        return {
          sessionId: session.id as string,
          mode: session.mode as "live" | "self_paced",
          status: session.status as string,
          joinCode: session.join_code as string,
        };
      }

      // 23505 = unique constraint violation.
      if (error?.code === "23505") {
        const { data: collision, error: lookupError } = await db
          .from("quiz_sessions")
          .select("id")
          .eq("join_code", joinCode)
          .maybeSingle();

        if (lookupError) throw lookupError;

        if (collision) {
          continue;
        }

        throw new Error("Không thể tạo phiên Quiz. Vui lòng thử lại.");
      }

      if (error) throw error;

      throw new Error("Không thể tạo phiên Quiz.");
    }

    throw new Error("Không thể tạo mã phòng Quiz. Vui lòng thử lại.");
  });

// ==========================================
// 9. DANH SÁCH CÁC PHIÊN QUIZ
// Owner / Co-owner / Manager
// ==========================================

export const listQuizSessions = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quizIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await quizDb();

    const quiz = await requireQuiz(db, data.quizId);

    await assertQuizRole(context.supabase, quiz.event_id, true);

    const { data: sessions, error } = await db
      .from("quiz_sessions")
      .select("id, mode, status, join_code, current_question, created_at, started_at, finished_at")
      .eq("quiz_id", quiz.id)
      .order("created_at", {
        ascending: false,
      });

    if (error) throw error;

    return sessions ?? [];
  });
