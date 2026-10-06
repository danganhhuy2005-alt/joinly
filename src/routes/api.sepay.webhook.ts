import { createFileRoute } from "@tanstack/react-router";

type SePayWebhookPayload = {
  id: number;
  gateway: string;
  transactionDate: string;
  accountNumber: string;
  subAccount?: string | null;
  code?: string | null;
  content: string;
  transferType: "in" | "out";
  description?: string;
  transferAmount: number;
  accumulated?: number;
  referenceCode?: string;
};

export const Route = createFileRoute("/api/sepay/webhook")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          success: true,
          service: "Joinly SePay Webhook",
          status: "online",
        });
      },

      POST: async ({ request }) => {
        try {
          // ======================================
          // 1. ĐỌC RAW BODY
          // Không dùng request.json() trước HMAC
          // ======================================

          const rawBody = await request.text();

          const signature = request.headers.get("x-sepay-signature") ?? "";

          const timestampHeader = request.headers.get("x-sepay-timestamp") ?? "";

          const timestamp = Number(timestampHeader);

          const secret = process.env.SEPAY_WEBHOOK_SECRET;

          if (!secret) {
            console.error("[SePay] Missing SEPAY_WEBHOOK_SECRET");

            return Response.json(
              {
                success: false,
                message: "Server configuration error",
              },
              { status: 500 },
            );
          }

          // ======================================
          // 2. CHỐNG REPLAY
          // Chỉ chấp nhận request trong ±5 phút
          // ======================================

          if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
            return Response.json(
              {
                success: false,
                message: "Request expired",
              },
              { status: 401 },
            );
          }

          // ======================================
          // 3. VERIFY HMAC SHA256
          // ======================================

          const { createHmac, timingSafeEqual } = await import("node:crypto");

          const expectedSignature =
            "sha256=" +
            createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

          const receivedBuffer = Buffer.from(signature);

          const expectedBuffer = Buffer.from(expectedSignature);

          if (
            receivedBuffer.length !== expectedBuffer.length ||
            !timingSafeEqual(receivedBuffer, expectedBuffer)
          ) {
            return Response.json(
              {
                success: false,
                message: "Invalid signature",
              },
              { status: 401 },
            );
          }

          // ======================================
          // 4. PARSE PAYLOAD SAU KHI VERIFY
          // ======================================

          const payload = JSON.parse(rawBody) as SePayWebhookPayload;

          // Chỉ xử lý tiền VÀO
          if (payload.transferType !== "in") {
            return Response.json({
              success: true,
            });
          }

          // ======================================
          // 5. KIỂM TRA ĐÚNG TÀI KHOẢN TPBANK
          // ======================================

          const bankAccount = process.env.SEPAY_BANK_ACCOUNT;

          if (bankAccount && payload.accountNumber !== bankAccount) {
            console.warn("[SePay] Wrong bank account:", payload.accountNumber);

            return Response.json({
              success: true,
            });
          }

          // ======================================
          // 6. TÌM MÃ JNxxxxxxxxxx
          // ======================================

          const searchText = [payload.code ?? "", payload.content ?? ""].join(" ").toUpperCase();

          const match = searchText.match(/\bJN\d{10}\b/);

          const orderCode = match?.[0];

          if (!orderCode) {
            // Không phải giao dịch của Joinly
            return Response.json({
              success: true,
            });
          }

          // ======================================
          // 7. XỬ LÝ PAYMENT TRONG DATABASE
          // ======================================

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data, error } = await supabaseAdmin.rpc("process_sepay_payment", {
            p_order_code: orderCode,
            p_transaction_id: payload.id,
            p_transfer_amount: payload.transferAmount,
            p_gateway: payload.gateway,
            p_reference_code: payload.referenceCode ?? "",
          });

          if (error) {
            console.error("[SePay] Payment processing error:", error);

            // Trả 500 để SePay retry
            return Response.json(
              {
                success: false,
                message: "Payment processing failed",
              },
              { status: 500 },
            );
          }

          console.log("[SePay] Payment result:", data);

          // ======================================
          // 8. BÁO SEPAY ĐÃ NHẬN THÀNH CÔNG
          // ======================================

          return Response.json({
            success: true,
          });
        } catch (error) {
          console.error("[SePay] Webhook error:", error);

          return Response.json(
            {
              success: false,
              message: "Internal server error",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
