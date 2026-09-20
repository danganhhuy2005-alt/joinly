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
  name: "list_participants",
  title: "List participants",
  description: "List participants for a Joinly event, optionally filtered by room. RLS ensures only events the signed-in user organizes return data.",
  inputSchema: {
    event_id: z.string().uuid().describe("The event UUID."),
    room_id: z.string().uuid().optional().describe("Optional room UUID to filter by."),
    limit: z.number().int().min(1).max(500).default(100),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ event_id, room_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    let query = supabaseForUser(ctx)
      .from("participants")
      .select("id, event_id, room_id, full_name, email, phone, student_id, created_at")
      .eq("event_id", event_id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (room_id) query = query.eq("room_id", room_id);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { participants: data ?? [], count: data?.length ?? 0 },
    };
  },
});
