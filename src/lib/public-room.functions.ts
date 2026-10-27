import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Public, read-only landing for a room QR link.
 * A paid/activated event may accept registration BEFORE its run starts.
 * Uses the server client to avoid depending on the caller's anon RLS, but
 * returns only the small whitelist of fields needed to render the form.
 * Access codes, contacts, attendee lists and management data stay private.
 */
export const getPublicRoomLanding = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      eventId: z.string().uuid(),
      roomId: z.string().uuid(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("*")
      .eq("id", data.eventId)
      .maybeSingle();
    if (eventError) throw eventError;
    if (!event) return { status: "invalid" as const };
    if (event.lifecycle_status !== "active") {
      return { status: "not_active" as const };
    }
    if ((event as typeof event & { run_ended_at?: string | null }).run_ended_at) {
      return { status: "ended" as const };
    }

    const { data: room, error: roomError } = await supabaseAdmin
      .from("event_rooms")
      .select("id, name, event_id, has_access_code")
      .eq("id", data.roomId)
      .eq("event_id", data.eventId)
      .maybeSingle();
    if (roomError) throw roomError;
    if (!room) return { status: "invalid" as const };

    return {
      status: "ok" as const,
      event: {
        id: event.id,
        name: event.name,
        description: event.description,
        location: event.location,
        starts_at: event.starts_at,
      },
      room: {
        id: room.id,
        name: room.name,
        event_id: room.event_id,
        has_access_code: Boolean(room.has_access_code),
      },
    };
  });
