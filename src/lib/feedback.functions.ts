import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const uuid = z.string().uuid();

const formIdSchema = z.object({
  formId: uuid,
});

const eventIdSchema = z.object({
  eventId: uuid,
});

const createFormSchema = z.object({
  eventId: uuid,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(""),
});

const questionSchema = z.object({
  formId: uuid,
  questionId: uuid.optional(),
  title: z.string().trim().min(1).max(500),
  questionType: z.enum(["rating", "short_text", "long_text", "single_choice", "multi_choice"]),
  options: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  isRequired: z.boolean().default(true),
  position: z.number().int().min(0).max(1000),

  // Số đáp án tối đa được chọn.
  // null = không giới hạn.
  maxChoices: z.number().int().min(1).max(30).nullable().optional(),
});

// Tạm thời sử dụng kiểu linh hoạt vì Supabase types.ts
// chưa được cập nhật 4 bảng Feedback.
type FeedbackDb = SupabaseClient;

async function feedbackDb(): Promise<FeedbackDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  return supabaseAdmin as unknown as FeedbackDb;
}

type AuthClient = SupabaseClient<Database>;
type EventRole = "owner" | "co_owner" | "manager";

// ==========================================
// KIỂM TRA QUYỀN BTC
// ==========================================

async function assertRole(
  authClient: AuthClient,
  eventId: string,
  allowManager: boolean,
): Promise<EventRole> {
  const { data: role, error } = await authClient.rpc("get_event_role", {
    _event_id: eventId,
  });

  if (error) throw error;

  if (role !== "owner" && role !== "co_owner" && !(allowManager && role === "manager")) {
    throw new Error("Bạn không có quyền quản lý Feedback này.");
  }

  return role;
}

// ==========================================
// LẤY THÔNG TIN BIỂU MẪU
// ==========================================
// Kiểm tra form đã có người gửi Feedback chưa
async function assertFeedbackQuestionsEditable(db: FeedbackDb, formId: string) {
  const { count, error } = await db
    .from("feedback_submissions")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("form_id", formId);

  if (error) throw error;

  if ((count ?? 0) > 0) {
    throw new Error("Biểu mẫu đã có phản hồi. Không thể thay đổi câu hỏi để bảo toàn kết quả cũ.");
  }
}

async function requireForm(db: FeedbackDb, formId: string) {
  const { data: form, error } = await db
    .from("feedback_forms")
    .select("id, event_id, title, description, status, created_at")
    .eq("id", formId)
    .maybeSingle();

  if (error) throw error;

  if (!form) {
    throw new Error("Không tìm thấy biểu mẫu Feedback.");
  }

  return form as {
    id: string;
    event_id: string;
    title: string;
    description: string | null;
    status: "draft" | "open" | "closed";
    created_at: string;
  };
}

// ==========================================
// 1. BTC TẠO BIỂU MẪU FEEDBACK
// ==========================================

export const createFeedbackForm = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createFormSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase, data.eventId, false);

    const db = await feedbackDb();

    const { data: form, error } = await db
      .from("feedback_forms")
      .insert({
        event_id: data.eventId,
        title: data.title,
        description: data.description || null,
        created_by: context.userId,
        status: "draft",
      })
      .select("id")
      .single();

    if (error) throw error;

    return {
      formId: form.id as string,
    };
  });

// ==========================================
// NHÂN BẢN BIỂU MẪU FEEDBACK
// ==========================================

export const duplicateFeedbackForm = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => formIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await feedbackDb();

    // Lấy thông tin form gốc
    const original = await requireForm(db, data.formId);

    // Chỉ Owner / Co-owner được nhân bản
    await assertRole(context.supabase, original.event_id, false);

    // Tải toàn bộ câu hỏi, tránh giới hạn 1000 dòng
    const questions: Array<{
      title: string;
      question_type: string;
      options: unknown;
      is_required: boolean;
      position: number;
      max_choices: number | null;
    }> = [];

    for (let offset = 0; ; offset += 500) {
      const { data: batch, error } = await db
        .from("feedback_questions")
        .select("title,question_type,options,is_required,position,max_choices")
        .eq("form_id", original.id)
        .order("position", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + 499);

      if (error) throw error;

      questions.push(...(batch ?? []));

      if ((batch ?? []).length < 500) break;
    }

    const suffix = " (bản sao)";

    const copiedTitle = original.title.slice(0, 200 - suffix.length).trimEnd() + suffix;

    // Tạo form mới luôn ở trạng thái nháp
    const { data: copiedForm, error: formError } = await db
      .from("feedback_forms")
      .insert({
        event_id: original.event_id,
        title: copiedTitle,
        description: original.description,
        status: "draft",
        created_by: context.userId,
      })
      .select("id")
      .single();

    if (formError) throw formError;

    try {
      // Sao chép câu hỏi, không sao chép phản hồi
      for (let offset = 0; offset < questions.length; offset += 100) {
        const batch = questions.slice(offset, offset + 100).map((question) => ({
          form_id: copiedForm.id,
          title: question.title,
          question_type: question.question_type,
          options: question.options,
          is_required: question.is_required,
          position: question.position,
          max_choices: question.max_choices,
        }));

        const { error } = await db.from("feedback_questions").insert(batch);

        if (error) throw error;
      }

      return {
        formId: copiedForm.id as string,
        questionCount: questions.length,
      };
    } catch (error) {
      // Nếu sao chép câu hỏi lỗi, cố gắng xóa bản nháp dở
      const { error: cleanupError } = await db
        .from("feedback_forms")
        .delete()
        .eq("id", copiedForm.id);

      if (cleanupError) {
        console.error("Không thể dọn form nhân bản lỗi:", cleanupError);
      }

      throw new Error("Không thể nhân bản biểu mẫu Feedback.");
    }
  });

// ==========================================
// 2. CHỈNH SỬA BIỂU MẪU
// ==========================================

export const updateFeedbackForm = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        formId: uuid,
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await feedbackDb();

    const form = await requireForm(db, data.formId);

    await assertRole(context.supabase, form.event_id, false);

    const { error } = await db
      .from("feedback_forms")
      .update({
        title: data.title,
        description: data.description || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", form.id);

    if (error) throw error;

    return { ok: true as const };
  });

// ==========================================
// 3. XÓA BIỂU MẪU NHÁP
// ==========================================

export const deleteDraftFeedbackForm = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => formIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await feedbackDb();

    const form = await requireForm(db, data.formId);

    await assertRole(context.supabase, form.event_id, false);

    if (form.status !== "draft") {
      throw new Error("Chỉ có thể xóa biểu mẫu nháp.");
    }

    const { error } = await db
      .from("feedback_forms")
      .delete()
      .eq("id", form.id)
      .eq("status", "draft");

    if (error) throw error;

    return { ok: true as const };
  });

// ==========================================
// 4. DANH SÁCH BIỂU MẪU CỦA SỰ KIỆN
// ==========================================

export const listFeedbackForms = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => eventIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase, data.eventId, true);

    const db = await feedbackDb();

    const { data: forms, error } = await db
      .from("feedback_forms")
      .select("id, event_id, title, description, status, created_at")
      .eq("event_id", data.eventId)
      .order("created_at", {
        ascending: false,
      });

    if (error) throw error;

    return forms ?? [];
  });

// ==========================================
// 5. LẤY BIỂU MẪU ĐỂ BTC CHỈNH SỬA
// ==========================================

export const getFeedbackEditor = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => formIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await feedbackDb();

    const form = await requireForm(db, data.formId);

    await assertRole(context.supabase, form.event_id, true);

    const { data: questions, error } = await db
      .from("feedback_questions")
      .select("id, title, question_type, options, is_required, position, max_choices")
      .eq("form_id", form.id)
      .order("position", {
        ascending: true,
      });

    if (error) throw error;

    const { count: responseCount, error: countError } = await db
      .from("feedback_submissions")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("form_id", form.id);

    if (countError) throw countError;

    return {
      form,
      questions: questions ?? [],
      responseCount: responseCount ?? 0,
    };
  });

// ==========================================
// 6. THÊM HOẶC SỬA CÂU HỎI
// ==========================================

export const saveFeedbackQuestion = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => questionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await feedbackDb();

    const form = await requireForm(db, data.formId);

    await assertRole(context.supabase, form.event_id, false);

    await assertFeedbackQuestionsEditable(db, form.id);

    const isChoice = data.questionType === "single_choice" || data.questionType === "multi_choice";

    const normalizedOptions = data.options.map((v) => v.trim());

    if (isChoice) {
      if (normalizedOptions.length < 2) {
        throw new Error("Câu hỏi lựa chọn cần ít nhất 2 đáp án.");
      }

      if (
        new Set(normalizedOptions.map((v) => v.toLocaleLowerCase())).size !==
        normalizedOptions.length
      ) {
        throw new Error("Các phương án trả lời không được trùng nhau.");
      }
    } else if (normalizedOptions.length > 0) {
      throw new Error("Loại câu hỏi này không sử dụng danh sách lựa chọn.");
    }

    // Kiểm tra giới hạn lựa chọn
    const maxChoices = data.questionType === "multi_choice" ? (data.maxChoices ?? null) : null;

    if (data.questionType === "multi_choice") {
      if (maxChoices !== null && maxChoices > normalizedOptions.length) {
        throw new Error("Số đáp án tối đa không được lớn hơn số phương án.");
      }
    }

    // Lưu cấu hình câu hỏi
    const values = {
      title: data.title,
      question_type: data.questionType,
      options: normalizedOptions,
      is_required: data.isRequired,
      position: data.position,
      max_choices: maxChoices,
    };

    if (data.questionId) {
      const { data: updated, error } = await db
        .from("feedback_questions")
        .update(values)
        .eq("id", data.questionId)
        .eq("form_id", form.id)
        .select("id")
        .maybeSingle();

      if (error) throw error;

      if (!updated) {
        throw new Error("Không tìm thấy câu hỏi.");
      }

      return {
        questionId: updated.id as string,
      };
    }

    const { data: inserted, error } = await db
      .from("feedback_questions")
      .insert({
        ...values,
        form_id: form.id,
      })
      .select("id")
      .single();

    if (error) throw error;

    return {
      questionId: inserted.id as string,
    };
  });

// ==========================================
// 7. XÓA CÂU HỎI
// ==========================================

export const deleteFeedbackQuestion = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        formId: uuid,
        questionId: uuid,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await feedbackDb();

    const form = await requireForm(db, data.formId);

    // Chỉ Owner / Co-owner được xóa
    await assertRole(context.supabase, form.event_id, false);

    // Form đã có phản hồi không được sửa câu hỏi
    await assertFeedbackQuestionsEditable(db, form.id);

    // Không cho xóa câu hỏi cuối cùng
    // khi Feedback đang mở
    if (form.status === "open") {
      const { count, error: countError } = await db
        .from("feedback_questions")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("form_id", form.id);

      if (countError) throw countError;

      if ((count ?? 0) <= 1) {
        throw new Error(
          "Không thể xóa câu hỏi cuối cùng khi Feedback đang mở. Hãy thêm câu hỏi khác hoặc đóng Feedback trước.",
        );
      }
    }

    // Xóa câu hỏi
    const { data: deleted, error } = await db
      .from("feedback_questions")
      .delete()
      .eq("id", data.questionId)
      .eq("form_id", form.id)
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
// 8. MỞ / ĐÓNG FEEDBACK
// ==========================================

export const setFeedbackStatus = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        formId: uuid,
        status: z.enum(["open", "closed"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await feedbackDb();

    const form = await requireForm(db, data.formId);

    await assertRole(context.supabase, form.event_id, false);

    if (data.status === "open") {
      const { count, error } = await db
        .from("feedback_questions")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("form_id", form.id);

      if (error) throw error;

      if (!count) {
        throw new Error("Cần tạo ít nhất một câu hỏi trước khi mở form.");
      }
    } else if (form.status === "draft") {
      throw new Error("Biểu mẫu vẫn là bản nháp, chưa cần đóng.");
    }

    const { error } = await db
      .from("feedback_forms")
      .update({
        status: data.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", form.id);

    if (error) throw error;

    return {
      status: data.status,
    };
  });

// ==========================================
// 9. LẤY THÔNG TIN FEEDBACK CÔNG KHAI
// ==========================================

export const getPublicFeedbackForm = createServerFn({
  method: "POST",
})
  .inputValidator((input) => formIdSchema.parse(input))
  .handler(async ({ data }) => {
    const db = await feedbackDb();

    const { data: form, error } = await db
      .from("feedback_forms")
      .select("id, title, description, status")
      .eq("id", data.formId)
      .maybeSingle();

    if (error) throw error;

    if (!form || form.status !== "open") {
      return null;
    }

    return {
      id: form.id as string,
      title: form.title as string,
      description: (form.description as string | null) ?? null,
    };
  });

// ==========================================
// 10. KIỂM TRA EMAIL ĐÃ ĐĂNG KÝ
// ==========================================

export const checkFeedbackEmail = createServerFn({
  method: "POST",
})
  .inputValidator((input) =>
    z
      .object({
        formId: uuid,
        email: z.string().trim().email().max(320),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = await feedbackDb();

    const form = await requireForm(db, data.formId);

    if (form.status !== "open") {
      return {
        status: "closed" as const,
      };
    }

    const email = data.email.trim().toLowerCase();

    const { data: participants, error: participantError } = await db
      .from("participants")
      .select("id, email")
      .eq("event_id", form.event_id)
      .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
      .limit(20);

    if (participantError) {
      throw participantError;
    }

    const participant = (participants ?? []).find(
      (p: { id: string; email: string }) => p.email.trim().toLowerCase() === email,
    );

    if (!participant) {
      return {
        status: "not_registered" as const,
      };
    }

    const { data: old, error: oldError } = await db
      .from("feedback_submissions")
      .select("id")
      .eq("form_id", form.id)
      .eq("email_normalized", email)
      .limit(1)
      .maybeSingle();

    if (oldError) throw oldError;

    if (old) {
      return {
        status: "already_submitted" as const,
      };
    }

    const { data: questions, error } = await db
      .from("feedback_questions")
      .select("id, title, question_type, options, is_required, position, max_choices")
      .eq("form_id", form.id)
      .order("position", {
        ascending: true,
      });

    if (error) throw error;

    return {
      status: "eligible" as const,

      form: {
        id: form.id,
        title: form.title,
        description: form.description,
      },

      questions: questions ?? [],
    };
  });

// ==========================================
// 11. GỬI CÂU TRẢ LỜI FEEDBACK
// ==========================================

const responseValue = z.union([
  z.number().int().min(1).max(5),
  z.string().max(2000),
  z.array(z.string().min(1).max(200)).max(30),
]);

export const submitFeedback = createServerFn({
  method: "POST",
})
  .inputValidator((input) =>
    z
      .object({
        formId: uuid,
        email: z.string().trim().email().max(320),
        answers: z
          .array(
            z.object({
              questionId: uuid,
              value: responseValue,
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = await feedbackDb();

    const email = data.email.trim().toLowerCase();

    // Lưu Feedback của BTC trước
    const { data: result, error } = await db.rpc("submit_feedback_response", {
      p_form_id: data.formId,
      p_email: email,
      p_answers: data.answers.map((answer) => ({
        question_id: answer.questionId,
        value: answer.value,
      })),
    });

    if (error) {
      console.error("Submit feedback error:", error.code);
      throw new Error("Không thể gửi Feedback. Vui lòng thử lại.");
    }

    const feedbackResult = result as {
      status: "ok" | "closed" | "not_registered" | "already_submitted" | "invalid_answers";
    };

    // Feedback BTC không thành công thì dừng
    if (feedbackResult.status !== "ok") {
      return feedbackResult;
    }

    // Chỉ tạo lời mời đánh giá Joinly
    // sau khi Feedback BTC đã được lưu.
    try {
      const { data: submission, error: findError } = await db
        .from("feedback_submissions")
        .select("id")
        .eq("form_id", data.formId)
        .eq("email_normalized", email)
        .single();

      if (findError || !submission) {
        throw new Error("Không tìm thấy lượt Feedback.");
      }

      const { randomBytes, createHash } = await import("node:crypto");

      const token = randomBytes(32).toString("hex");

      // Database chỉ lưu hash, không lưu token gốc
      const tokenHash = createHash("sha256").update(token).digest("hex");

      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      const { error: inviteError } = await db.from("joinly_app_review_invites").insert({
        submission_id: submission.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
      });

      if (inviteError) {
        throw inviteError;
      }

      return {
        status: "ok" as const,
        appReviewToken: token,
      };
    } catch {
      // Lỗi tạo lời mời đánh giá Joinly không được
      // làm mất kết quả Feedback BTC đã lưu.
      console.error("Không thể tạo lời mời đánh giá Joinly.");

      return feedbackResult;
    }
  });

// ==========================================
// 12. GỬI ĐÁNH GIÁ ỨNG DỤNG JOINLY
// ==========================================

const appReviewSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),

  rating: z.number().int().min(1).max(5),

  comment: z.string().trim().max(1000).default(""),
});

export const submitJoinlyAppReview = createServerFn({
  method: "POST",
})
  .inputValidator((input) => appReviewSchema.parse(input))
  .handler(async ({ data }) => {
    const db = await feedbackDb();

    const { createHash } = await import("node:crypto");

    const tokenHash = createHash("sha256").update(data.token).digest("hex");

    const { data: result, error } = await db.rpc("submit_joinly_app_review", {
      p_token_hash: tokenHash,
      p_rating: data.rating,
      p_comment: data.comment || null,
    });

    if (error) {
      console.error("Joinly app review error:", error.code);

      throw new Error("Không thể gửi đánh giá Joinly.");
    }

    return result as {
      status: "ok" | "unavailable" | "already_reviewed" | "invalid_rating" | "invalid_comment";
    };
  });
