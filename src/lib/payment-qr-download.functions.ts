import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const downloadSchema = z.object({
  paymentId: z.string().uuid(),
});

export const getPaymentQrImage = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => downloadSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Chỉ lấy đơn thanh toán của tài khoản hiện tại
    const { data: payment, error } = await supabaseAdmin
      .from("payments")
      .select("id, user_id, order_code, amount_vnd, status, expires_at")
      .eq("id", data.paymentId)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (error) throw error;

    if (
      !payment ||
      payment.status !== "pending" ||
      !payment.expires_at ||
      new Date(payment.expires_at).getTime() <= Date.now()
    ) {
      throw new Error("Đơn thanh toán đã hết hạn hoặc không còn hiệu lực.");
    }

    const bankAccount = process.env.SEPAY_BANK_ACCOUNT;
    const bankCode = process.env.SEPAY_BANK_CODE ?? "TPBank";
    const holder = process.env.SEPAY_ACCOUNT_HOLDER;

    if (!bankAccount) {
      throw new Error("Chưa cấu hình tài khoản ngân hàng.");
    }

    // Tạo ảnh QR từ dữ liệu đơn trong database
    const qrUrl = new URL("https://vietqr.app/img");

    qrUrl.searchParams.set("acc", bankAccount);
    qrUrl.searchParams.set("bank", bankCode);
    qrUrl.searchParams.set("amount", String(payment.amount_vnd));
    qrUrl.searchParams.set("des", payment.order_code);
    qrUrl.searchParams.set("template", "compact");
    qrUrl.searchParams.set("showinfo", "false");
    qrUrl.searchParams.set("fullacc", "false");

    if (holder) {
      qrUrl.searchParams.set("holder", holder);
    }

    qrUrl.searchParams.set("store", process.env.SEPAY_STORE_NAME ?? "JOINLY");

    const response = await fetch(qrUrl.toString(), {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error("Không thể lấy ảnh QR thanh toán.");
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length === 0 || buffer.length > 3000000) {
      throw new Error("Kích thước ảnh QR không hợp lệ.");
    }

    const isPng = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

    const isWebp =
      buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";

    if (!isPng && !isJpeg && !isWebp) {
      throw new Error("Dịch vụ QR trả về ảnh không hợp lệ.");
    }

    const mimeType = isPng ? "image/png" : isJpeg ? "image/jpeg" : "image/webp";

    const extension = isPng ? "png" : isJpeg ? "jpg" : "webp";

    return {
      base64: buffer.toString("base64"),
      mimeType,
      filename: `Joinly-SePay-${payment.order_code.replace(/[^a-zA-Z0-9-]/g, "")}.${extension}`,
    };
  });
