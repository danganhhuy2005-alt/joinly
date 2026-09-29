// Server-only helper that mirrors the join-form registration flow.
// Both the public register endpoint and the demo seeder go through this
// function so demo data is subject to the same room/access-code checks.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type RegisterInput = {
  eventId: string;
  roomId: string;
  fullName: string;
  email: string;
  phone: string | null;
  studentId: string | null;
  accessCode: string | null;
};

export type RegisterResult =
  | { status: "ok"; token: string }
  | { status: "invalid" }
  | { status: "wrong_code" }
  | { status: "duplicate" }
  | { status: "not_allowed" };

export async function registerParticipantCore(input: RegisterInput): Promise<RegisterResult> {
  // Chuẩn hóa dữ liệu
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedStudentId = input.studentId?.trim().toUpperCase() || null;

  const normalizedFullName = input.fullName.trim();
  const normalizedPhone = input.phone?.trim() || null;

  // =========================
  // 1. Kiểm tra phòng
  // =========================

  const { data: room, error: roomErr } = await supabaseAdmin
    .from("event_rooms")
    .select("id, event_id, access_code")
    .eq("id", input.roomId)
    .maybeSingle();

  if (roomErr) throw roomErr;

  if (!room || room.event_id !== input.eventId) {
    return { status: "invalid" };
  }

  // =========================
  // 2. Kiểm tra mã phòng
  // =========================

  const requiredCode = room.access_code;

  if (requiredCode) {
    const provided = input.accessCode ? input.accessCode.trim().toUpperCase() : null;

    if (!provided || provided !== requiredCode) {
      return { status: "wrong_code" };
    }
  }

  // =========================
  // 3. Kiểm tra Allow-list
  // =========================

  const { data: eventRow, error: eventErr } = await supabaseAdmin
    .from("events")
    .select("allowlist_enabled, allowlist_scope")
    .eq("id", input.eventId)
    .maybeSingle();

  if (eventErr) throw eventErr;

  if (!eventRow) {
    return { status: "invalid" };
  }

  if (eventRow.allowlist_enabled) {
    type AllowlistCandidate = {
      email: string | null;
      student_id: string | null;
    };

    const findCandidates = async (
      column: "email" | "student_id",
      value: string,
    ): Promise<AllowlistCandidate[]> => {
      let query = supabaseAdmin
        .from("event_allowlist")
        .select("email, student_id")
        .eq("event_id", input.eventId)
        .eq(column, value);

      if (eventRow.allowlist_scope === "room") {
        query = query.eq("room_id", input.roomId);
      } else {
        query = query.is("room_id", null);
      }

      const { data, error } = await query;

      if (error) throw error;

      return data ?? [];
    };

    const emailCandidates = await findCandidates("email", normalizedEmail);

    const studentCandidates = normalizedStudentId
      ? await findCandidates("student_id", normalizedStudentId)
      : [];

    const candidates = [...emailCandidates, ...studentCandidates];

    const isAllowed = candidates.some((entry) => {
      if (entry.email && entry.student_id) {
        return entry.email === normalizedEmail && entry.student_id === normalizedStudentId;
      }

      if (entry.email) {
        return entry.email === normalizedEmail;
      }

      if (entry.student_id) {
        return entry.student_id === normalizedStudentId;
      }

      return false;
    });

    if (!isAllowed) {
      return {
        status: "not_allowed",
      };
    }
  }

  // =========================
  // 4. Kiểm tra đăng ký trùng
  // =========================

  // Kiểm tra Email đã đăng ký trong phòng này chưa
  const { data: existingEmail, error: emailExistErr } = await supabaseAdmin
    .from("participants")
    .select("id")
    .eq("event_id", input.eventId)
    .eq("room_id", input.roomId)
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (emailExistErr) throw emailExistErr;

  if (existingEmail) {
    return { status: "duplicate" };
  }

  // Nếu có MSSV thì kiểm tra MSSV đã được dùng trong phòng này chưa
  if (normalizedStudentId) {
    const { data: existingStudent, error: studentExistErr } = await supabaseAdmin
      .from("participants")
      .select("id")
      .eq("event_id", input.eventId)
      .eq("room_id", input.roomId)
      .ilike("student_id", normalizedStudentId)
      .maybeSingle();

    if (studentExistErr) throw studentExistErr;

    if (existingStudent) {
      return { status: "duplicate" };
    }
  }

  // =========================
  // 5. Tạo participant
  // =========================

  const { data: inserted, error } = await supabaseAdmin
    .from("participants")
    .insert({
      event_id: input.eventId,
      room_id: input.roomId,
      full_name: normalizedFullName,
      email: normalizedEmail,
      phone: normalizedPhone,
      student_id: normalizedStudentId,
    })
    .select("confirmation_token")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { status: "duplicate" };
    }

    throw error;
  }

  return {
    status: "ok",
    token: inserted.confirmation_token,
  };
}
