import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_event",
  title: "Get event details",
  description: "Fetch an event with its rooms and participant counts. Only events the signed-in user organizes are visible.",
  inputSchema: {
    event_id: z.string().uuid().describe("The event UUID."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ event_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const { data: event, error: eErr } = await sb
      .from("events")
      .select("id, name, description, location, starts_at, created_at")
      .eq("id", event_id)
      .maybeSingle();
    if (eErr) return { content: [{ type: "text", text: eErr.message }], isError: true };
    if (!event) return { content: [{ type: "text", text: "Event not found or access denied" }], isError: true };

    const { data: rooms } = await sb
      .from("event_rooms")
      .select("id, name, position")
      .eq("event_id", event_id)
      .order("position");
    const { data: participants } = await sb
      .from("participants")
      .select("id, room_id")
      .eq("event_id", event_id);

    const roomsWithCounts = (rooms ?? []).map((r) => ({
      ...r,
      participant_count: (participants ?? []).filter((p) => p.room_id === r.id).length,
    }));
    const result = { ...event, rooms: roomsWithCounts, total_participants: (participants ?? []).length };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
