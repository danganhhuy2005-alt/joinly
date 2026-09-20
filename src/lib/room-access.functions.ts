import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,6}$/, "Mã phòng phải gồm 4–6 ký tự chữ hoa hoặc số");

// Public: verify an access code for a room. Used by the join flow.
export const verifyRoomAccessCode = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        roomId: z.string().uuid(),
        code: z.string().trim().min(1).max(10),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: room, error } = await supabaseAdmin
      .from("event_rooms")
      .select("id, access_code")
      .eq("id", data.roomId)
      .maybeSingle();
    if (error) throw error;
    if (!room) return { ok: false as const, reason: "not_found" as const };
    const stored = (room as { access_code: string | null }).access_code;
    if (!stored) return { ok: true as const }; // Room has no code; treat as open.
    const provided = data.code.trim().toUpperCase();
    return stored === provided
      ? ({ ok: true as const })
      : ({ ok: false as const, reason: "wrong_code" as const });
  });

// Organizer-only: read the current access code for a room they own.
export const getRoomAccessCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ roomId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    // Ownership check via RLS-scoped client.
    const { data: room, error } = await context.supabase
      .from("event_rooms")
      .select("id, event_id, events:event_id(organizer_id)")
      .eq("id", data.roomId)
      .maybeSingle();
    if (error) throw error;
    const evt = room?.events as { organizer_id: string } | null;
    if (!room || !evt || evt.organizer_id !== context.userId) {
      throw new Error("Forbidden");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: full, error: fullErr } = await supabaseAdmin
      .from("event_rooms")
      .select("access_code")
      .eq("id", data.roomId)
      .maybeSingle();
    if (fullErr) throw fullErr;
    return { accessCode: (full as { access_code: string | null } | null)?.access_code ?? null };
  });

// Organizer-only: set or clear the access code for a room they own.
export const updateRoomAccessCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        roomId: z.string().uuid(),
        // null / empty string clears the code (open room).
        accessCode: z.union([codeSchema, z.literal("").transform(() => null), z.null()]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: room, error } = await context.supabase
      .from("event_rooms")
      .select("id, event_id, events:event_id(organizer_id)")
      .eq("id", data.roomId)
      .maybeSingle();
    if (error) throw error;
    const evt = room?.events as { organizer_id: string } | null;
    if (!room || !evt || evt.organizer_id !== context.userId) {
      throw new Error("Forbidden");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const value = data.accessCode ? String(data.accessCode).toUpperCase() : null;
    const { error: updErr } = await supabaseAdmin
      .from("event_rooms")
      .update({ access_code: value })
      .eq("id", data.roomId);
    if (updErr) throw updErr;
    return { ok: true as const, accessCode: value };
  });
