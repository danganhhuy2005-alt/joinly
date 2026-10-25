import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const uuid = z.string().uuid();
const eventInput = z.object({ eventId: uuid });
const guestInput = eventInput.extend({ ticketToken: uuid });

export type QnaQuestion = {
  id: string;
  body: string;
  status: "pending" | "approved" | "answered" | "rejected";
  created_at: string;
  is_anonymous: boolean;
  author: string;
  participant_id?: string;
};
export type QnaHand = {
  id: string;
  participant_id: string;
  author: string;
  created_at: string;
};

type QuestionRow = {
  id: string;
  body: string;
  status: QnaQuestion["status"];
  created_at: string;
  is_anonymous: boolean;
  participant_id: string;
};
type HandRow = {
  id: string;
  participant_id: string;
  created_at: string;
};

// Until generated Supabase types include the new Q&A tables, use untyped
// SupabaseClient only inside this trusted server module (as in Feedback).
type AdminClient = SupabaseClient;
async function admin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}
async function hostRole(client: SupabaseClient<Database>, eventId: string) {
  const { data, error } = await client.rpc("get_event_role", { _event_id: eventId });
  if (error || !["owner", "co_owner", "manager"].includes(data ?? "")) {
    throw new Error("Bạn không có quyền quản lý Q&A của sự kiện này.");
  }
}
async function requireActiveEvent(db: AdminClient, eventId: string) {
  const { data, error } = await db.from("events")
    .select("id, name, lifecycle_status").eq("id", eventId).maybeSingle();
  if (error) throw error;
  if (!data || data.lifecycle_status !== "active") {
    throw new Error("Sự kiện chưa kích hoạt hoặc không tồn tại.");
  }
  return data;
}
async function requireTicket(db: AdminClient, eventId: string, token: string) {
  const { data, error } = await db.from("participants")
    .select("id, full_name")
    .eq("event_id", eventId)
    .eq("confirmation_token", token)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Vé tham gia không hợp lệ. Hãy mở Q&A từ vé Joinly của bạn.");
  return data;
}
async function getSettings(db: AdminClient, eventId: string) {
  const { data, error } = await db.from("event_qna_settings")
    .select("is_open").eq("event_id", eventId).maybeSingle();
  if (error) throw error;
  return Boolean(data?.is_open);
}
async function namesFor(db: AdminClient, participantIds: string[]) {
  const ids = Array.from(new Set(participantIds));
  if (!ids.length) return new Map<string, string>();
  const { data, error } = await db.from("participants").select("id, full_name").in("id", ids);
  if (error) throw error;
  return new Map((data ?? []).map((p) => [p.id, p.full_name || "Người tham gia"]));
}
// Match names in the raised-hand queue regardless of case/extra spaces.
function nameKey(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi-VN");
}

function formatQuestion(q: QuestionRow, names: Map<string, string>, isHost: boolean): QnaQuestion {
  return {
    id: q.id,
    body: q.body,
    status: q.status,
    created_at: q.created_at,
    is_anonymous: q.is_anonymous,
    author: q.is_anonymous ? "Ẩn danh" : names.get(q.participant_id) ?? "Người tham gia",
    ...(isHost ? { participant_id: q.participant_id } : {}),
  };
}

// Guest: only a genuine participant ticket can access the event's Q&A.
// Return only approved public posts and this ticket's own posts; no email/phone is exposed.
export const getEventQnaForParticipant = createServerFn({ method: "POST" })
  .inputValidator((input) => guestInput.parse(input))
  .handler(async ({ data }) => {
    const db = await admin();
    const ev = await requireActiveEvent(db, data.eventId);
    const participant = await requireTicket(db, data.eventId, data.ticketToken);
    const isOpen = await getSettings(db, data.eventId);
    const [
      { data: published, error: e1 },
      { data: mine, error: e2 },
      { data: hand, error: e3 },
      { count: pendingCount, error: e4 },
    ] = await Promise.all([
        db.from("event_qna_questions")
          .select("id, body, status, created_at, is_anonymous, participant_id")
          .eq("event_id", data.eventId).in("status", ["approved", "answered"])
          .order("created_at", { ascending: false }).limit(100),
        db.from("event_qna_questions")
          .select("id, body, status, created_at, is_anonymous, participant_id")
          .eq("event_id", data.eventId).eq("participant_id", participant.id)
          .order("created_at", { ascending: false }).limit(25),
        db.from("event_qna_hands").select("status")
          .eq("event_id", data.eventId).eq("participant_id", participant.id).maybeSingle(),
        db.from("event_qna_questions")
          .select("id", { count: "exact", head: true })
          .eq("event_id", data.eventId).eq("participant_id", participant.id)
          .eq("status", "pending"),
      ]);
    if (e1 || e2 || e3 || e4) throw e1 || e2 || e3 || e4;
    const publicRows = (published ?? []) as QuestionRow[];
    const ownRows = (mine ?? []) as QuestionRow[];
    const names = await namesFor(db, publicRows.filter((q) => !q.is_anonymous).map((q) => q.participant_id));
    names.set(participant.id, participant.full_name || "Bạn");
    return {
      eventName: ev.name,
      isOpen,
      myName: participant.full_name,
      handRaised: hand?.status === "raised",
      pendingCount: pendingCount ?? 0,
      questions: publicRows.map((q) => formatQuestion(q, names, false)),
      mine: ownRows.map((q) => formatQuestion(q, names, false)),
    };
  });

export const submitEventQnaQuestion = createServerFn({ method: "POST" })
  .inputValidator((input) => guestInput.extend({
    body: z.string().trim().min(5, "Câu hỏi cần tối thiểu 5 ký tự.").max(400),
    isAnonymous: z.boolean(),
  }).parse(input))
  .handler(async ({ data }) => {
    const db = await admin();
    await requireActiveEvent(db, data.eventId);
    const p = await requireTicket(db, data.eventId, data.ticketToken);
    if (!(await getSettings(db, data.eventId))) throw new Error("BTC đang đóng nhận câu hỏi.");

    // At most 3 questions are pending for this ticket at a time.
    // Approved, answered and rejected questions no longer occupy a slot.
    const { count, error: countError } = await db.from("event_qna_questions")
      .select("id", { count: "exact", head: true })
      .eq("event_id", data.eventId).eq("participant_id", p.id)
      .eq("status", "pending");
    if (countError) throw countError;
    if ((count ?? 0) >= 3) {
      throw new Error("Bạn đang có 3 câu hỏi chờ duyệt. Hãy đợi BTC xử lý trước khi gửi thêm.");
    }

    // This check gives a readable message. The SQL trigger is the final,
    // concurrency-safe authority if several requests arrive together.
    const { error } = await db.from("event_qna_questions").insert({
      event_id: data.eventId,
      participant_id: p.id,
      body: data.body,
      is_anonymous: data.isAnonymous,
      status: "pending",
    });
    if (error?.message?.includes("QNA_QUESTION_LIMIT_REACHED")) {
      throw new Error("Bạn đang có 3 câu hỏi chờ duyệt. Hãy đợi BTC xử lý trước khi gửi thêm.");
    }
    if (error?.code === "23505") throw new Error("Câu hỏi bị trùng. Vui lòng thử lại.");
    if (error) throw error;
    return { ok: true };
  });

export const setEventQnaHand = createServerFn({ method: "POST" })
  .inputValidator((input) => guestInput.extend({ raised: z.boolean() }).parse(input))
  .handler(async ({ data }) => {
    const db = await admin();
    await requireActiveEvent(db, data.eventId);
    const p = await requireTicket(db, data.eventId, data.ticketToken);
    if (!(await getSettings(db, data.eventId))) throw new Error("BTC đang đóng tương tác trực tiếp.");
    const { data: prev, error: readError } = await db.from("event_qna_hands")
      .select("status, updated_at").eq("event_id", data.eventId).eq("participant_id", p.id).maybeSingle();
    if (readError) throw readError;
    if (prev && Date.now() - new Date(prev.updated_at).getTime() < 2000) {
      throw new Error("Vui lòng chờ một chút trước khi đổi trạng thái giơ tay.");
    }
    const { error } = await db.from("event_qna_hands").upsert({
      event_id: data.eventId,
      participant_id: p.id,
      status: data.raised ? "raised" : "lowered",
      updated_at: new Date().toISOString(),
    }, { onConflict: "event_id,participant_id" });
    if (error) throw error;
    return { ok: true };
  });

// Host endpoints always require real Supabase Auth and event-scoped management role.
export const getEventQnaForHost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => eventInput.parse(input))
  .handler(async ({ data, context }) => {
    await hostRole(context.supabase, data.eventId);
    const db = await admin();
    const { data: ev, error: evError } = await db.from("events")
      .select("name, lifecycle_status").eq("id", data.eventId).single();
    if (evError) throw evError;
    const isOpen = await getSettings(db, data.eventId);
    const [{ data: questions, error: e1 }, { data: hands, error: e2 }] = await Promise.all([
      db.from("event_qna_questions")
        .select("id, body, status, created_at, is_anonymous, participant_id")
        .eq("event_id", data.eventId).order("created_at", { ascending: false }).limit(150),
      db.from("event_qna_hands")
        .select("id, participant_id, created_at")
        .eq("event_id", data.eventId).eq("status", "raised")
        .order("updated_at", { ascending: true }).limit(100),
    ]);
    if (e1 || e2) throw e1 || e2;
    const qs = (questions ?? []) as QuestionRow[];
    const hs = (hands ?? []) as HandRow[];
    const names = await namesFor(db, [...qs.map((q) => q.participant_id), ...hs.map((h) => h.participant_id)]);

    // If two people in the current raised-hand queue share the same name,
    // show ONLY the last 3 phone digits to the authenticated event staff.
    // Do not expose phone details to the participant/public Q&A response.
    const nameCounts = new Map<string, number>();
    for (const hand of hs) {
      const key = nameKey(names.get(hand.participant_id) ?? "Người tham gia");
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    const duplicateIds = hs
      .filter((hand) => (nameCounts.get(nameKey(names.get(hand.participant_id) ?? "Người tham gia")) ?? 0) > 1)
      .map((hand) => hand.participant_id);

    const phoneEnds = new Map<string, string>();
    if (duplicateIds.length) {
      const { data: people, error: phoneError } = await db.from("participants")
        .select("id, phone")
        .eq("event_id", data.eventId)
        .in("id", duplicateIds);
      if (phoneError) throw phoneError;
      for (const person of people ?? []) {
        const digits = String(person.phone ?? "").replace(/\D/g, "");
        if (digits.length >= 3) phoneEnds.set(person.id, digits.slice(-3));
      }
    }

    return {
      eventName: ev.name,
      eventActive: ev.lifecycle_status === "active",
      isOpen,
      questions: qs.map((q) => formatQuestion(q, names, true)),
      hands: hs.map((h): QnaHand => {
        const name = names.get(h.participant_id) ?? "Người tham gia";
        const duplicated = (nameCounts.get(nameKey(name)) ?? 0) > 1;
        const phoneEnd = phoneEnds.get(h.participant_id);
        return {
          id: h.id,
          participant_id: h.participant_id,
          created_at: h.created_at,
          author: duplicated
            ? `${name} · ${phoneEnd ? `SĐT ***${phoneEnd}` : "chưa có SĐT"}`
            : name,
        };
      }),
    };
  });

export const changeEventQnaOpen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => eventInput.extend({ isOpen: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    await hostRole(context.supabase, data.eventId);
    const db = await admin();
    await requireActiveEvent(db, data.eventId);
    const { error } = await db.from("event_qna_settings")
      .upsert({ event_id: data.eventId, is_open: data.isOpen, updated_at: new Date().toISOString() },
        { onConflict: "event_id" });
    if (error) throw error;
    return { ok: true };
  });

export const moderateEventQnaQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => eventInput.extend({
    questionId: uuid,
    action: z.enum(["approve", "answer", "reject"]),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await hostRole(context.supabase, data.eventId);
    const db = await admin();
    const { data: q, error: readError } = await db.from("event_qna_questions")
      .select("id, status").eq("id", data.questionId).eq("event_id", data.eventId).maybeSingle();
    if (readError) throw readError;
    if (!q) throw new Error("Không tìm thấy câu hỏi thuộc sự kiện này.");
    if (data.action === "approve" && q.status !== "pending") throw new Error("Chỉ duyệt câu hỏi đang chờ.");
    if (data.action === "answer" && q.status !== "approved") throw new Error("Chỉ đánh dấu đã trả lời cho câu đã duyệt.");
    if (data.action === "reject" && q.status === "answered") throw new Error("Không thể ẩn câu đã trả lời.");
    const newStatus = data.action === "approve" ? "approved" : data.action === "answer" ? "answered" : "rejected";
    const { error } = await db.from("event_qna_questions").update({ status: newStatus })
      .eq("id", data.questionId).eq("event_id", data.eventId).eq("status", q.status);
    if (error) throw error;
    return { ok: true };
  });

export const resolveEventQnaHand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => eventInput.extend({ handId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    await hostRole(context.supabase, data.eventId);
    const db = await admin();
    const { error } = await db.from("event_qna_hands")
      .update({ status: "handled", updated_at: new Date().toISOString() })
      .eq("id", data.handId).eq("event_id", data.eventId);
    if (error) throw error;
    return { ok: true };
  });
