import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const cancelPaymentSchema = z.object({
  eventId: z.string().uuid(),
  paymentId: z.string().uuid(),
});

// Mark as cancelled rather than DELETE. The old order code must remain
// available for late-transfer investigation; cancelled payments cannot
// be recreated or granted a plan through the regular webhook flow.
export const cancelEventPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => cancelPaymentSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("organizer_id")
      .eq("id", data.eventId)
      .maybeSingle();

    if (eventError) throw eventError;
    if (!event || event.organizer_id !== context.userId) {
      throw new Error("Chỉ Owner mới được hủy đơn của sự kiện.");
    }

    // Atomic conditional update: if webhook completed first, cancellation
    // cannot overwrite 'paid'. Do not delete the row or recycle the order code.
    const { data: cancelled, error } = await supabaseAdmin
      .from("payments")
      .update({ status: "cancelled" })
      .eq("id", data.paymentId)
      .eq("event_id", data.eventId)
      .eq("user_id", context.userId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!cancelled) {
      throw new Error("Đơn không còn ở trạng thái chờ. Hãy tải lại trang để kiểm tra.");
    }

    return { cancelled: true };
  });

const createPaymentSchema = z.object({
  renewQr: z.boolean().optional(),
  planCode: z.enum(["small", "standard", "pro", "monthly"]),

  // Small / Standard / Pro bắt buộc có eventId
  // Monthly không cần eventId
  eventId: z.string().uuid().optional(),
});

export const createPayment = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => createPaymentSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // ==========================================
    // 1. LẤY GIÁ GÓI TỪ DATABASE
    // Không bao giờ lấy amount từ frontend
    // ==========================================

    const { data: plan, error: planError } = await supabaseAdmin
      .from("billing_plans")
      .select(
        `
            code,
            name,
            price_vnd,
            billing_type,
            attendee_limit,
            event_limit,
            duration_days
          `,
      )
      .eq("code", data.planCode)
      .eq("is_active", true)
      .maybeSingle();

    if (planError) {
      throw planError;
    }

    if (!plan) {
      throw new Error("Gói thanh toán không tồn tại.");
    }

    if (plan.price_vnd <= 0) {
      throw new Error("Gói này không cần thanh toán.");
    }

    // Server-side SePay orders are authoritative: the browser NEVER sends an amount.
    const { randomInt } = await import("node:crypto");

    let createdPayment: {
      id: string;
      order_code: string;
      amount_vnd: number;
      plan_code: string;
      event_id: string | null;
      status: string;
      expires_at: string | null;
    } | null = null;

    // ==========================================
    // 2. GÓI THEO SỰ KIỆN
    // Small / Standard / Pro
    // ==========================================

    if (plan.billing_type === "event") {
      if (!data.eventId) {
        throw new Error("Vui lòng chọn sự kiện cần nâng cấp.");
      }

      const { data: event, error: eventError } = await supabaseAdmin
        .from("events")
        .select(
          `
              id,
              name,
              organizer_id,
              plan_code,
              lifecycle_status,
              requested_plan_code
            `,
        )
        .eq("id", data.eventId)
        .maybeSingle();

      if (eventError) {
        throw eventError;
      }

      if (!event) {
        throw new Error("Không tìm thấy sự kiện.");
      }

      // Chỉ Owner được mua/nâng gói cho event
      if (event.organizer_id !== context.userId) {
        throw new Error("Chỉ Owner của sự kiện mới có thể mua gói.");
      }

      if (event.lifecycle_status === "draft" && event.requested_plan_code !== plan.code) {
        throw new Error("Gói thanh toán không khớp với bản nháp. Vui lòng kiểm tra lại.");
      }

      // Paid active events ONLY use a locked SQL transaction to calculate the
      // difference from the CURRENT plan; never insert a full-price order here.
      if (event.plan_code !== "free") {
        if (data.renewQr) {
          throw new Error("Làm mới QR ở đây chỉ dành cho bản nháp sự kiện.");
        }

        // New function is additive to the live database; its result is parsed
        // at runtime until regenerated Supabase types are committed.
        type UpgradeOrderArgs = {
          p_event_id: string;
          p_user_id: string;
          p_plan_code: string;
          p_order_code: string;
          p_expires_at: string;
        };
        const createUpgradeOrder = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
          name: "create_event_upgrade_payment",
          args: UpgradeOrderArgs,
        ) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;

        const upgradePaymentSchema = z.object({
          id: z.string().uuid(),
          order_code: z.string().regex(/^JN\d{10}$/),
          amount_vnd: z.number().int().positive(),
          plan_code: z.enum(["small", "standard", "pro"]),
          event_id: z.string().uuid(),
          status: z.literal("pending"),
          expires_at: z.string(),
        });

        for (let attempt = 0; attempt < 5; attempt++) {
          const orderCode = `JN${randomInt(1_000_000_000, 10_000_000_000)}`;
          const { data: upgradeOrder, error } = await createUpgradeOrder(
            "create_event_upgrade_payment",
            {
              p_event_id: event.id,
              p_user_id: context.userId,
              p_plan_code: plan.code,
              p_order_code: orderCode,
              p_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            },
          );
          if (!error) {
            createdPayment = upgradePaymentSchema.parse(upgradeOrder);
            break;
          }
          if (error.code === "23505") continue;
          throw new Error(error.message || "Không thể tạo đơn nâng cấp.");
        }
        if (!createdPayment) {
          throw new Error("Không thể tạo mã nâng cấp. Vui lòng thử lại.");
        }
      }
    }

    // ==========================================
    // 3. MONTHLY
    // Không gắn trực tiếp với một event
    // ==========================================

    if (plan.billing_type === "monthly") {
      if (data.eventId) {
        throw new Error("Gói Monthly không cần chọn sự kiện.");
      }

      const now = new Date().toISOString();

      const { data: scheduled, error: subError } = await supabaseAdmin
        .from("user_subscriptions")
        .select("id")
        .eq("user_id", context.userId)
        .eq("plan_code", "monthly")
        .eq("status", "active")
        .gt("starts_at", now)
        .limit(1);

      if (subError) throw subError;

      if (scheduled && scheduled.length > 0) {
        throw new Error("Bạn đã gia hạn Monthly cho chu kỳ tiếp theo.");
      }
    }

    // ==========================================
    // 4. TẠO ORDER CODE
    // Ví dụ: JN5839201746
    // ==========================================

    // Paid-event upgrades already have an atomically created/reused order.
    // Tìm đơn pending cũ của bản nháp / sự kiện Free
    if (plan.billing_type === "event" && data.eventId && !createdPayment) {
      const { data: oldPayment, error: lookupError } = await supabaseAdmin
        .from("payments")
        .select("id, order_code, amount_vnd, plan_code, event_id, status, expires_at")
        .eq("event_id", data.eventId)
        .eq("status", "pending")
        .maybeSingle();

      if (lookupError) throw lookupError;

      if (oldPayment) {
        const stillValid =
          oldPayment.expires_at !== null && new Date(oldPayment.expires_at).getTime() > Date.now();

        if (stillValid) {
          if (oldPayment.plan_code !== plan.code) {
            throw new Error("Sự kiện đang có đơn thanh toán gói khác. Vui lòng hủy đơn cũ trước.");
          }

          // Tái sử dụng đơn cũ
          createdPayment = oldPayment;
        } else {
          // Đơn hết hạn, không tái sử dụng
          const { error: expireError } = await supabaseAdmin
            .from("payments")
            .update({ status: "expired" })
            .eq("id", oldPayment.id)
            .eq("status", "pending");

          if (expireError) throw expireError;
        }
      }
    }

    if (data.renewQr === true) {
      if (plan.billing_type !== "event" || !data.eventId) {
        throw new Error("Chỉ có thể làm mới QR cho bản nháp sự kiện.");
      }

      const newOrderCode = `JN${randomInt(1_000_000_000, 10_000_000_000)}`;

      const { data: newPayment, error: renewError } = await supabaseAdmin.rpc(
        "replace_pending_payment",
        {
          p_event_id: data.eventId,
          p_user_id: context.userId,
          p_plan_code: plan.code,
          p_order_code: newOrderCode,
          p_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
      );

      if (renewError) throw renewError;
      if (!newPayment) {
        throw new Error("Không thể tạo lại mã QR thanh toán.");
      }

      createdPayment = newPayment as NonNullable<typeof createdPayment>;
    }

    if (plan.billing_type === "monthly") {
      const { data: oldMonthly, error: lookupError } = await supabaseAdmin
        .from("payments")
        .select("id, order_code, amount_vnd, plan_code, event_id, status, expires_at")
        .eq("user_id", context.userId)
        .eq("plan_code", "monthly")
        .eq("status", "pending")
        .maybeSingle();

      if (lookupError) throw lookupError;

      if (oldMonthly) {
        const stillValid =
          oldMonthly.expires_at !== null && new Date(oldMonthly.expires_at).getTime() > Date.now();

        if (stillValid) {
          if (oldMonthly.amount_vnd !== plan.price_vnd) {
            throw new Error("Đơn Monthly cũ có giá khác. Cần đối soát trước khi tiếp tục.");
          }

          createdPayment = oldMonthly;
        } else {
          const { error: expireError } = await supabaseAdmin
            .from("payments")
            .update({ status: "expired" })
            .eq("id", oldMonthly.id)
            .eq("status", "pending");

          if (expireError) throw expireError;
        }
      }
    }

    // Retry vài lần nếu vô tình trùng order_code
    if (!createdPayment) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const number = randomInt(1_000_000_000, 10_000_000_000);

        const orderCode = `JN${number}`;

        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

        const { data: payment, error: paymentError } = await supabaseAdmin
          .from("payments")
          .insert({
            user_id: context.userId,

            event_id: plan.billing_type === "event" ? data.eventId! : null,

            plan_code: plan.code,

            order_code: orderCode,

            amount_vnd: plan.price_vnd,

            status: "pending",

            expires_at: expiresAt,
          })
          .select(
            `
              id,
              order_code,
              amount_vnd,
              plan_code,
              event_id,
              status,
              expires_at
            `,
          )
          .single();

        if (!paymentError && payment) {
          createdPayment = payment;

          break;
        }

        if (paymentError?.code === "23505") {
          if (plan.billing_type === "monthly") {
            const { data: existing, error: existingError } = await supabaseAdmin
              .from("payments")
              .select("id, order_code, amount_vnd, plan_code, event_id, status, expires_at")
              .eq("user_id", context.userId)
              .eq("plan_code", "monthly")
              .eq("status", "pending")
              .maybeSingle();

            if (existingError) throw existingError;

            if (
              existing &&
              existing.amount_vnd === plan.price_vnd &&
              existing.expires_at &&
              new Date(existing.expires_at).getTime() > Date.now()
            ) {
              createdPayment = existing;
              break;
            }

            if (existing) {
              throw new Error("Đơn Monthly đang được cập nhật. Vui lòng thử lại.");
            }
          }

          continue;
        }

        throw paymentError;
      }

      if (!createdPayment) {
        throw new Error("Không thể tạo mã thanh toán. Vui lòng thử lại.");
      }
    }

    // ==========================================
    // 5. TẠO VIETQR TPBANK
    // ==========================================

    const bankAccount = process.env.SEPAY_BANK_ACCOUNT;
    const bankCode = process.env.SEPAY_BANK_CODE ?? "TPBank";
    const accountHolder = process.env.SEPAY_ACCOUNT_HOLDER;
    const storeName = process.env.SEPAY_STORE_NAME ?? "JOINLY";

    if (!bankAccount) {
      throw new Error("Server chưa cấu hình SEPAY_BANK_ACCOUNT.");
    }

    const qrUrl = new URL("https://vietqr.app/img");

    qrUrl.searchParams.set("acc", bankAccount);
    qrUrl.searchParams.set("bank", bankCode);

    qrUrl.searchParams.set("amount", String(createdPayment.amount_vnd));

    qrUrl.searchParams.set("des", createdPayment.order_code);

    qrUrl.searchParams.set("template", "compact");
    qrUrl.searchParams.set("showinfo", "false");
    qrUrl.searchParams.set("fullacc", "false");

    if (accountHolder) {
      qrUrl.searchParams.set("holder", accountHolder);
    }

    qrUrl.searchParams.set("store", storeName);
    // ==========================================
    // 6. TRẢ KẾT QUẢ CHO FRONTEND
    // ==========================================

    return {
      id: createdPayment.id,

      planCode: createdPayment.plan_code,

      amountVnd: createdPayment.amount_vnd,

      orderCode: createdPayment.order_code,

      eventId: createdPayment.event_id,

      expiresAt: createdPayment.expires_at,

      qrUrl: qrUrl.toString(),

      bank: {
        bankCode,
        accountNumber: bankAccount,
        accountHolder: accountHolder ?? "",
      },
    };
  });
