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

const quizMediaEffectSchema = z.enum([
  "full",
  "tiles4",
  "tiles9",
  "tiles16",
  "random",
  "flip",
  "blur",
  "pixel",
  "left",
  "right",
  "down",
  "up",
  "center",
  "circle",
  "zoom",
  "spotlight",
]);

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
  mediaEffect: quizMediaEffectSchema.optional(),
  mediaUrl: z.string().url().max(2048).nullable().optional(),
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
const deleteSessionSchema = z.object({
  sessionId: uuid,
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
        "id, title, options, correct_index, position, points, time_limit_seconds, explanation, media_url, media_effect",
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

export const copyQuizToEdit = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quizIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await quizDb();

    const original = await requireQuiz(db, data.quizId);

    await assertQuizRole(context.supabase, original.event_id, false);

    // Lấy toàn bộ câu hỏi gốc.
    const { data: questions, error: questionError } = await db
      .from("quiz_questions")
      .select(
        "title,options,correct_index,position,points,time_limit_seconds,explanation,media_url,media_effect",
      )
      .eq("quiz_id", original.id)
      .order("position", { ascending: true });

    if (questionError) throw questionError;

    // Tạo bộ Quiz mới.
    const suffix = " (Bản chỉnh sửa)";

    const copyTitle = original.title.slice(0, 200 - suffix.length) + suffix;

    const { data: newQuiz, error: createError } = await db
      .from("quizzes")
      .insert({
        event_id: original.event_id,
        title: copyTitle,
        description: original.description,
        created_by: context.userId,
      })
      .select("id")
      .single();

    if (createError) throw createError;

    // Sao chép ảnh để bản mới có thể hoạt động
    // độc lập với Storage của Quiz cũ.
    const storage = db.storage.from("quiz-question-media");

    const sourcePrefix = storage.getPublicUrl(`${original.event_id}/${original.id}/`).data
      .publicUrl;

    const copiedImages: string[] = [];

    try {
      const { randomUUID } = await import("node:crypto");

      const rows = [];

      for (const question of questions ?? []) {
        let mediaUrl = question.media_url as string | null;

        if (mediaUrl?.startsWith(sourcePrefix)) {
          const filename = mediaUrl.slice(sourcePrefix.length);

          if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i.test(filename)) {
            throw new Error("Ảnh trong Quiz cũ không có đường dẫn hợp lệ.");
          }

          const extension = filename.split(".").pop();

          const from = `${original.event_id}/${original.id}/${filename}`;

          const to = `${original.event_id}/${newQuiz.id}/${randomUUID()}.${extension}`;

          const { error: imageError } = await storage.copy(from, to);

          if (imageError) {
            throw new Error(`Không sao chép được ảnh: ${imageError.message}`);
          }

          copiedImages.push(to);

          mediaUrl = storage.getPublicUrl(to).data.publicUrl;
        }

        rows.push({
          quiz_id: newQuiz.id,
          title: question.title,
          options: question.options,
          correct_index: question.correct_index,
          position: question.position,
          points: question.points,
          time_limit_seconds: question.time_limit_seconds,
          explanation: question.explanation,
          media_url: mediaUrl,
          media_effect: question.media_effect ?? "tiles9",
        });
      }

      if (rows.length > 0) {
        const { error: insertError } = await db.from("quiz_questions").insert(rows);

        if (insertError) throw insertError;
      }
    } catch (error) {
      // Dọn dữ liệu mới nếu sao chép thất bại.
      if (copiedImages.length > 0) {
        await storage.remove(copiedImages);
      }

      await db.from("quizzes").delete().eq("id", newQuiz.id);

      throw error;
    }

    return {
      quizId: newQuiz.id as string,
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
    // Chỉ cho phép lưu ảnh của chính bộ Quiz này.
    if (data.mediaUrl) {
      const { data: urlData } = db.storage
        .from("quiz-question-media")
        .getPublicUrl(`${quiz.event_id}/${quiz.id}/`);

      const prefix = urlData.publicUrl;

      const imageName = data.mediaUrl.startsWith(prefix) ? data.mediaUrl.slice(prefix.length) : "";

      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/i.test(
          imageName,
        )
      ) {
        throw new Error("Đường dẫn ảnh Quiz không hợp lệ.");
      }
    }

    const values = {
      title: data.title,
      options,
      correct_index: data.correctIndex,
      position: data.position,
      points: data.points,
      time_limit_seconds: data.timeLimitSeconds,
      explanation: data.explanation || null,

      // Ảnh hoặc GIF của câu hỏi.
      ...(data.mediaUrl !== undefined ? { media_url: data.mediaUrl } : {}),

      // Hiệu ứng ảnh do BTC lựa chọn.
      // Không truyền thì giữ hiệu ứng cũ khi sửa.
      // Câu mới sẽ dùng mặc định tiles9 từ database.
      ...(data.mediaEffect !== undefined ? { media_effect: data.mediaEffect } : {}),
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

// =============================================
// JOINLY QUIZ - CẤP QUYỀN TẢI ẢNH/GIF
// Chỉ Owner / Co-owner
// =============================================

const quizImageUploadSchema = z.object({
  quizId: uuid,
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024, "Ảnh không được vượt quá 5 MB."),
});

export const requestQuizImageUpload = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quizImageUploadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await quizDb();

    // Kiểm tra bộ Quiz và quyền sửa.
    const quiz = await requireQuiz(db, data.quizId);

    await assertQuizRole(context.supabase, quiz.event_id, false);

    await assertQuestionsEditable(db, quiz.id);

    // Không dùng tên file từ người dùng
    // để tránh tên trùng hoặc đường dẫn lạ.
    const extensionMap = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
    } as const;

    const extension = extensionMap[data.mimeType];

    const { randomUUID } = await import("node:crypto");

    const objectPath = [quiz.event_id, quiz.id, `${randomUUID()}.${extension}`].join("/");

    const bucket = "quiz-question-media";

    // Tạo quyền upload tạm thời.
    // Không gửi service-role key ra browser.
    const { data: signed, error } = await db.storage.from(bucket).createSignedUploadUrl(objectPath);

    if (error || !signed?.token) {
      throw new Error("Không thể tạo quyền tải ảnh lên. Kiểm tra Storage bucket.");
    }

    const { data: publicFile } = db.storage.from(bucket).getPublicUrl(objectPath);

    return {
      bucket,
      path: objectPath,
      token: signed.token,
      publicUrl: publicFile.publicUrl,
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

//
// ==========================================
// 7. XÓA BỘ QUIZ KHÔNG CÒN SỬ DỤNG
// OWNER / CO-OWNER
// ==========================================
//

export const deleteUnusedQuiz = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        quizId: uuid,
        confirmActive: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await quizDb();

    const quiz = await requireQuiz(db, data.quizId);

    // Chỉ Owner và Co-owner được xóa.
    await assertQuizRole(context.supabase, quiz.event_id, false);

    const { error } = await db.rpc("quiz_delete_confirmed", {
      p_quiz_id: quiz.id,
      p_confirm_active: data.confirmActive,
    });

    if (error) {
      if (error.message.includes("QUIZ_CONFIRM_ACTIVE_REQUIRED")) {
        throw new Error(
          "Trạng thái phiên đã thay đổi. Hãy tải lại danh sách và xác nhận xóa lần nữa.",
        );
      }

      throw error;
    }

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

//
// ==========================================
// 10. XÓA PHIÊN QUIZ CŨ
// OWNER / CO-OWNER
// ==========================================
//

export const deleteQuizSession = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => deleteSessionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await quizDb();

    // Tìm phiên cần xóa.
    const { data: session, error: sessionError } = await db
      .from("quiz_sessions")
      .select("id, quiz_id, status")
      .eq("id", data.sessionId)
      .maybeSingle();

    if (sessionError) throw sessionError;

    if (!session) {
      throw new Error("Không tìm thấy phiên Quiz.");
    }

    // Kiểm tra Quiz và quyền BTC.
    const quiz = await requireQuiz(db, session.quiz_id);

    // false = chỉ Owner / Co-owner.
    await assertQuizRole(context.supabase, quiz.event_id, false);

    // Không cho xóa phiên đang chơi.
    if (session.status !== "finished" && session.status !== "closed") {
      throw new Error("Chỉ xóa phiên đã kết thúc hoặc đã đóng. Hãy đóng phòng chờ trước.");
    }

    // Xóa phiên có điều kiện để tránh
    // xóa nhầm khi trạng thái vừa thay đổi.
    //
    // Database đã có ON DELETE CASCADE:
    // - quiz_attempts
    // - quiz_answers
    //
    // Không xóa bộ câu hỏi Quiz.
    const { data: deleted, error: deleteError } = await db
      .from("quiz_sessions")
      .delete()
      .eq("id", session.id)
      .eq("quiz_id", quiz.id)
      .in("status", ["finished", "closed"])
      .select("id")
      .maybeSingle();

    if (deleteError) throw deleteError;

    if (!deleted) {
      throw new Error("Phiên đã thay đổi trạng thái hoặc vừa bị xóa. Hãy tải lại danh sách.");
    }

    return {
      ok: true as const,
    };
  });
