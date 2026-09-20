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
  | { status: "duplicate" };

export async function registerParticipantCore(input: RegisterInput): Promise<RegisterResult> {
  const { data: room, error: roomErr } = await supabaseAdmin
    .from("event_rooms")
    .select("id, event_id, access_code")
    .eq("id", input.roomId)
    .maybeSingle();
  if (roomErr) throw roomErr;
  if (!room || room.event_id !== input.eventId) return { status: "invalid" };

  const requiredCode = (room as { access_code: string | null }).access_code;
  if (requiredCode) {
    const provided = input.accessCode ? input.accessCode.trim().toUpperCase() : null;
    if (!provided || provided !== requiredCode) return { status: "wrong_code" };
  }

  const { data: existing, error: existErr } = await supabaseAdmin
    .from("participants")
    .select("id")
    .eq("event_id", input.eventId)
    .eq("room_id", input.roomId)
    .ilike("email", input.email)
    .maybeSingle();
  if (existErr) throw existErr;
  if (existing) return { status: "duplicate" };

  const { data: inserted, error } = await supabaseAdmin
    .from("participants")
    .insert({
      event_id: input.eventId,
      room_id: input.roomId,
      full_name: input.fullName,
      email: input.email,
      phone: input.phone,
      student_id: input.studentId,
    })
    .select("confirmation_token")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return { status: "duplicate" };
    throw error;
  }
  return { status: "ok", token: inserted.confirmation_token as string };
}
