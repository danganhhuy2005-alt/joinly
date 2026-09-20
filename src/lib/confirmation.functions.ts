import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getParticipantConfirmation = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ token: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("participants")
      .select(
        "id, full_name, email, event_id, room_id, events:event_id(name, description, location, starts_at), event_rooms:room_id(name)",
      )
      .eq("confirmation_token", data.token)
      .maybeSingle();
    if (error) throw error;
    if (!row) return null;
    const event = row.events as { name: string; description: string | null; location: string | null; starts_at: string | null } | null;
    const room = row.event_rooms as { name: string } | null;
    return {
      participant_id: row.id,
      full_name: row.full_name,
      email: row.email,
      event_id: row.event_id,
      event_name: event?.name ?? "",
      event_description: event?.description ?? null,
      event_location: event?.location ?? null,
      event_starts_at: event?.starts_at ?? null,
      room_id: row.room_id,
      room_name: room?.name ?? "",
    };
  });

const registerSchema = z.object({
  eventId: z.string().uuid(),
  roomId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^\d*$/)
    .optional()
    .transform((v) => (v ? v : null)),
  studentId: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => (v ? v : null)),
  accessCode: z
    .string()
    .trim()
    .max(10)
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
});

export const registerParticipant = createServerFn({ method: "POST" })
  .inputValidator((data) => registerSchema.parse(data))
  .handler(async ({ data }) => {
    const { registerParticipantCore } = await import("@/lib/participant-registration.server");
    return registerParticipantCore({
      eventId: data.eventId,
      roomId: data.roomId,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      studentId: data.studentId,
      accessCode: data.accessCode,
    });
  });


