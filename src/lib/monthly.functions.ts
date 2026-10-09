
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from
  "@/integrations/supabase/auth-middleware";

const createMonthlyEventSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable(),
  location: z.string().max(200).nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  checkinRadius: z.number().int().min(20).max(5000),
  startsAt: z.string().datetime({ offset: true }),
  expected: z.number().int().min(1).max(500),

  rooms: z.array(
    z.object({
      name: z.string().trim().min(1).max(80),
      accessCode: z.string()
        .regex(/^$|^[A-Z0-9]{4,6}$/),
    })
  ).min(1),
});

export const createMonthlyEvent = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    createMonthlyEventSchema.parse(data)
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: eventId, error } =
      await supabaseAdmin.rpc(
        "create_monthly_event",
        {
          p_user_id: context.userId,
          p_name: data.name,
          p_description: data.description,
          p_location: data.location,
          p_latitude: data.latitude,
          p_longitude: data.longitude,
          p_checkin_radius: data.checkinRadius,
          p_starts_at: data.startsAt,
          p_expected: data.expected,
          p_rooms: data.rooms,
        }
      );

    if (error) {
      throw new Error(error.message);
    }

    if (!eventId) {
      throw new Error(
        "Không thể tạo sự kiện bằng Monthly."
      );
    }

    return { eventId };
  });
