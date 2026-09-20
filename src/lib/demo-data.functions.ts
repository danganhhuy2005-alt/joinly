import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DEMO_PREFIX = "[DEMO]";
const DEMO_ROOM_CODE = "DEMO1";

const DEMO_NAMES = [
  "Nguyễn Văn An", "Trần Thị Bình", "Lê Hoàng Cường", "Phạm Minh Dũng",
  "Hoàng Thu Hà", "Vũ Quang Huy", "Đỗ Thanh Lan", "Bùi Tuấn Khoa",
  "Ngô Bảo Ngọc", "Đinh Phương Mai", "Lý Hữu Phúc", "Trịnh Khánh Vy",
];

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, ".");
}

export const createDemoEventData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { registerParticipantCore } = await import("@/lib/participant-registration.server");

    // 1) Create the demo event (flagged so we can safely wipe later).
    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: ev, error: evErr } = await supabaseAdmin
      .from("events")
      .insert({
        organizer_id: context.userId,
        name: `${DEMO_PREFIX} Sự kiện mẫu Joinly`,
        description: "Sự kiện demo được tạo tự động để bạn xem thử dashboard và luồng tham gia.",
        location: "Hội trường Demo",
        starts_at: startsAt,
        expected_attendees: 30,
        is_demo: true,
      })
      .select("id")
      .single();
    if (evErr || !ev) throw evErr ?? new Error("Không thể tạo sự kiện demo");

    // 2) Create rooms — 2 phòng mở + 1 phòng có mã.
    const roomSeeds = [
      { name: `${DEMO_PREFIX} Hội trường chính`, position: 0, access_code: null as string | null },
      { name: `${DEMO_PREFIX} Workshop A`, position: 1, access_code: null as string | null },
      { name: `${DEMO_PREFIX} Phòng VIP`, position: 2, access_code: DEMO_ROOM_CODE },
    ];
    const { data: rooms, error: roomErr } = await supabaseAdmin
      .from("event_rooms")
      .insert(roomSeeds.map((r) => ({ ...r, event_id: ev.id })))
      .select("id, name, access_code, position")
      .order("position");
    if (roomErr || !rooms) throw roomErr ?? new Error("Không thể tạo phòng demo");

    // 3) Đăng ký người tham gia qua đúng luồng registerParticipantCore
    //    (bao gồm kiểm tra room thuộc event + kiểm tra mã phòng).
    let count = 0;
    for (let ri = 0; ri < rooms.length; ri++) {
      const room = rooms[ri] as { id: string; access_code: string | null };
      const perRoom = 4;
      for (let i = 0; i < perRoom; i++) {
        const name = DEMO_NAMES[(ri * perRoom + i) % DEMO_NAMES.length];
        const slug = slugify(name);
        const res = await registerParticipantCore({
          eventId: ev.id,
          roomId: room.id,
          fullName: `${DEMO_PREFIX} ${name}`,
          email: `${slug}.${ri}${i}@demo.joinly.vn`,
          phone: `09${String(10000000 + Math.floor(Math.random() * 89999999))}`,
          studentId: `22${String(100000 + (ri * 100 + i) * 137).slice(0, 6)}`,
          accessCode: room.access_code, // dùng đúng mã cho phòng có mã
        });
        if (res.status === "ok") count++;
      }
    }

    return { eventId: ev.id as string, participants: count, rooms: rooms.length };
  });

export const deleteDemoEventData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // ON DELETE CASCADE trên event_rooms/participants sẽ tự dọn dữ liệu con.
    const { data, error } = await supabaseAdmin
      .from("events")
      .delete()
      .eq("organizer_id", context.userId)
      .eq("is_demo", true)
      .select("id");
    if (error) throw error;
    return { deleted: data?.length ?? 0 };
  });
