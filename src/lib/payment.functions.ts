import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const createPaymentSchema = z.object({
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
              plan_code
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
    }

    // ==========================================
    // 3. MONTHLY
    // Không gắn trực tiếp với một event
    // ==========================================

    if (plan.billing_type === "monthly") {
      if (data.eventId) {
        throw new Error("Gói Monthly không cần chọn sự kiện.");
      }
    }

    // ==========================================
    // 4. TẠO ORDER CODE
    // Ví dụ: JN5839201746
    // ==========================================

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

    // Retry vài lần nếu vô tình trùng order_code
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

      // 23505 = UNIQUE violation
      // Nếu trùng order_code thì sinh mã khác
      if (paymentError?.code === "23505") {
        continue;
      }

      throw paymentError;
    }

    if (!createdPayment) {
      throw new Error("Không thể tạo mã thanh toán. Vui lòng thử lại.");
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
    qrUrl.searchParams.set("showinfo", "true");
    qrUrl.searchParams.set("fullacc", "true");

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
