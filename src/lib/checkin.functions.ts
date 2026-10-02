import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const scanTicketSchema = z.object({
  eventId: z.string().uuid(),
  token: z.string().uuid(),

  mode: z.enum(["check_in", "check_out"]),
});

export const scanParticipantTicket = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => scanTicketSchema.parse(data))
  .handler(async ({ data, context }) => {
    // =========================
    // 1. Kiểm tra quyền
    // =========================

    const { data: role, error: roleError } = await context.supabase.rpc("get_event_role", {
      _event_id: data.eventId,
    });

    if (roleError) {
      throw roleError;
    }

    const canOperate = role === "owner" || role === "co_owner" || role === "manager";

    if (!canOperate) {
      return {
        status: "no_permission" as const,
      };
    }

    // =========================
    // 2. Tìm participant
    // =========================

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: participant, error: participantError } = await supabaseAdmin
      .from("participants")
      .select(
        `
                id,
                full_name,
                event_id,
                room_id,
                checked_in,
                checked_in_at,
                checked_out_at,
                event_rooms:room_id(name)
              `,
      )
      .eq("event_id", data.eventId)
      .eq("confirmation_token", data.token)
      .maybeSingle();

    if (participantError) {
      throw participantError;
    }

    if (!participant) {
      return {
        status: "invalid_ticket" as const,
      };
    }

    const room = participant.event_rooms as {
      name: string;
    } | null;

    const participantInfo = {
      id: participant.id,

      fullName: participant.full_name,

      roomId: participant.room_id,

      roomName: room?.name ?? "",

      checkedInAt: participant.checked_in_at,

      checkedOutAt: participant.checked_out_at,
    };

    // =========================
    // 3. CHECK-IN
    // =========================

    if (data.mode === "check_in") {
      // Đã check-out rồi
      // thì không check-in lại
      if (participant.checked_out_at) {
        return {
          status: "already_checked_out" as const,

          participant: participantInfo,
        };
      }

      // Đã check-in rồi
      if (participant.checked_in_at) {
        return {
          status: "already_checked_in" as const,

          participant: participantInfo,
        };
      }

      const now = new Date().toISOString();

      const { error: updateError } = await supabaseAdmin
        .from("participants")
        .update({
          checked_in: true,
          checked_in_at: now,
          checked_in_by: context.userId,
        })
        .eq("id", participant.id);

      if (updateError) {
        throw updateError;
      }

      return {
        status: "checked_in" as const,

        participant: {
          ...participantInfo,

          checkedInAt: now,
        },
      };
    }

    // =========================
    // 4. CHECK-OUT
    // =========================

    if (participant.checked_out_at) {
      return {
        status: "already_checked_out" as const,

        participant: participantInfo,
      };
    }

    if (!participant.checked_in_at) {
      return {
        status: "not_checked_in" as const,

        participant: participantInfo,
      };
    }

    const now = new Date().toISOString();

    const { error: updateError } = await supabaseAdmin
      .from("participants")
      .update({
        checked_out_at: now,
        checked_out_by: context.userId,
      })
      .eq("id", participant.id);

    if (updateError) {
      throw updateError;
    }

    return {
      status: "checked_out" as const,

      participant: {
        ...participantInfo,

        checkedOutAt: now,
      },
    };
  });
