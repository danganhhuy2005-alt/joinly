import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  eventId: z.string().uuid(),
  roomId: z.string().uuid(),
  count: z.number().int().min(1).max(700),
});
const deleteSchema = z.object({ eventId: z.string().uuid() });

export const addEventDemoParticipants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("id, organizer_id, lifecycle_status, attendee_limit")
      .eq("id", data.eventId)
      .maybeSingle();
    if (eventError) throw new Error(eventError.message);
    if (!event || event.organizer_id !== context.userId) {
      throw new Error("Chỉ Owner của sự kiện được thêm người demo.");
    }
    if (event.lifecycle_status !== "active") {
      throw new Error("Chỉ thêm người demo vào sự kiện đã kích hoạt.");
    }

    const { data: room, error: roomError } = await supabaseAdmin
      .from("event_rooms")
      .select("id")
      .eq("id", data.roomId)
      .eq("event_id", data.eventId)
      .maybeSingle();
    if (roomError) throw new Error(roomError.message);
    if (!room) throw new Error("Phòng không thuộc sự kiện này.");

    // Đếm email riêng biệt trên TOÀN sự kiện, kể cả nhiều phòng.
    const emails = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const { data: rows, error } = await supabaseAdmin
        .from("participants")
        .select("email")
        .eq("event_id", data.eventId)
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      for (const row of rows ?? []) {
        emails.add(row.email.trim().toLowerCase());
      }
      if (!rows || rows.length < 1000) break;
    }

    const remaining = Math.max(0, event.attendee_limit - emails.size);
    if (data.count > remaining) {
      throw new Error(`Sự kiện chỉ còn ${remaining} suất (giới hạn ${event.attendee_limit}).`);
    }

    const batch = crypto.randomUUID().replace(/-/g, "");
    const prefix = `joinly-demo-${data.eventId.replace(/-/g, "")}-${batch}`;
    const newRows = Array.from({ length: data.count }, (_, i) => ({
      event_id: data.eventId,
      room_id: data.roomId,
      full_name: `[DEMO] Người tham gia ${String(i + 1).padStart(3, "0")}`,
      email: `${prefix}-${i + 1}@example.invalid`,
      phone: null,
      student_id: `DM${batch.slice(0, 8).toUpperCase()}${String(i + 1).padStart(4, "0")}`,
    }));

    // Một INSERT: thành công tất cả hoặc rollback tất cả.
    // Trigger enforce_participant_limit vẫn kiểm tra giới hạn trên DB.
    const { error: insertError } = await supabaseAdmin
      .from("participants")
      .insert(newRows);
    if (insertError) throw new Error(insertError.message);
    return { added: data.count, remaining: remaining - data.count };
  });

export const deleteEventDemoParticipants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => deleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("organizer_id")
      .eq("id", data.eventId)
      .maybeSingle();
    if (eventError) throw new Error(eventError.message);
    if (!event || event.organizer_id !== context.userId) {
      throw new Error("Chỉ Owner được xóa người demo.");
    }

    const prefix = `joinly-demo-${data.eventId.replace(/-/g, "")}-%@example.invalid`;
    const { data: deleted, error } = await supabaseAdmin
      .from("participants")
      .delete()
      .eq("event_id", data.eventId)
      .like("email", prefix)
      .like("full_name", "[DEMO] %")
      .select("id");
    if (error) throw new Error(error.message);
    return { deleted: deleted?.length ?? 0 };
  });
