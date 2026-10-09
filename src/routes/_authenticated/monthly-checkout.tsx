import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createPayment } from "@/lib/payment.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/monthly-checkout")({
  component: MonthlyCheckout,
});

type PaymentOrder = Awaited<ReturnType<typeof createPayment>>;

function MonthlyCheckout() {
  const navigate = useNavigate();

  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [clock, setClock] = useState(Date.now());

  // Tải đơn Monthly. Nếu còn hạn, backend dùng lại.
  useEffect(() => {
    let cancelled = false;

    setOrder(null);
    setLoading(true);
    setErrorMessage("");

    const load = async () => {
      try {
        const payment = await createPayment({
          data: { planCode: "monthly" },
        });

        if (cancelled) return;

        setOrder(payment);
        setStatus("pending");
      } catch (error) {
        if (cancelled) return;

        setErrorMessage(
          error instanceof Error ? error.message : "Không thể tạo thanh toán Monthly.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Đồng hồ cập nhật mỗi giây
  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  // Tự kiểm tra thanh toán mỗi 5 giây
  useEffect(() => {
    if (!order) return;

    let cancelled = false;
    let completed = false;

    const checkPayment = async () => {
      if (cancelled || completed) return;

      const { data, error } = await supabase
        .from("payments")
        .select("status")
        .eq("id", order.id)
        .maybeSingle();

      if (cancelled || completed || error || !data) return;

      setStatus(data.status);

      if (data.status === "paid") {
        const { data: subscription, error: subError } = await supabase
          .from("user_subscriptions")
          .select("id, starts_at, expires_at")
          .eq("payment_id", order.id)
          .maybeSingle();

        if (cancelled || completed) return;

        if (subError || !subscription) {
          if (subError) {
            console.error("Verify Monthly error:", subError);
          }

          setStatus("activating");
          return;
        }

        completed = true;
        setStatus("paid");

        const scheduled = new Date(subscription.starts_at).getTime() > Date.now();

        toast.success(
          scheduled
            ? "Gia hạn thành công! Chu kỳ Monthly tiếp theo đã được lên lịch."
            : "Thanh toán thành công! Monthly đã được kích hoạt.",
        );

        await navigate({ to: "/plans" });
      }
    };

    void checkPayment();

    const timer = window.setInterval(() => {
      void checkPayment();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [order, navigate]);

  const remainingMs = order?.expiresAt
    ? Math.max(0, new Date(order.expiresAt).getTime() - clock)
    : 0;

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const countdown = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const expired = remainingMs <= 0 || status === "expired" || status === "cancelled";

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Đã sao chép!");
    } catch {
      toast.error("Không thể sao chép.");
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-lg space-y-5">
        <Link
          to="/plans"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Quay lại gói dịch vụ
        </Link>

        <div className="space-y-5 rounded-2xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-2xl font-bold">Thanh toán Monthly</h1>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Đang tải mã thanh toán...</span>
            </div>
          ) : errorMessage ? (
            <div className="space-y-4">
              <p className="text-sm text-destructive">{errorMessage}</p>

              <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                Thử lại
              </Button>
            </div>
          ) : order ? (
            <>
              <p className="text-3xl font-bold text-primary">
                {order.amountVnd.toLocaleString("vi-VN")}đ
              </p>

              {status === "pending" && !expired ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Đang chờ thanh toán · Kiểm tra mỗi 5 giây
                  </p>

                  <div className="rounded-xl bg-secondary/50 p-4">
                    <p className="text-sm text-muted-foreground">Thời gian thanh toán còn lại</p>

                    <p
                      className={`mt-2 text-4xl font-bold tabular-nums ${
                        remainingMs <= 5 * 60 * 1000 ? "text-destructive" : "text-primary"
                      }`}
                    >
                      {countdown}
                    </p>
                  </div>

                  <img
                    src={order.qrUrl}
                    alt="QR thanh toán Monthly SePay"
                    className="mx-auto w-full max-w-72 rounded-xl"
                  />

                  <div className="space-y-3 text-left">
                    {[
                      {
                        label: "Ngân hàng",
                        value: order.bank.bankCode,
                      },
                      {
                        label: "Số tài khoản",
                        value: order.bank.accountNumber,
                      },
                      {
                        label: "Chủ tài khoản",
                        value: order.bank.accountHolder,
                      },
                      {
                        label: "Nội dung chuyển khoản",
                        value: order.orderCode,
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center justify-between gap-3 rounded-xl bg-secondary p-3"
                      >
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">{item.label}</p>
                          <p className="break-all font-semibold">{item.value}</p>
                        </div>

                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void copyValue(item.value)}
                        >
                          <Copy className="h-4 w-4" />
                          Sao chép
                        </Button>
                      </div>
                    ))}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Chuyển đúng số tiền và nội dung. Không cần tải lại trang.
                  </p>
                </>
              ) : status === "activating" ? (
                <div className="space-y-3 py-4 text-center">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />

                  <p className="font-semibold">Đang xác nhận quyền Monthly...</p>

                  <p className="text-sm text-muted-foreground">
                    Giao dịch đã được ghi nhận. Hệ thống đang kiểm tra việc kích hoạt gói. Vui lòng
                    không chuyển khoản thêm lần nữa.
                  </p>
                </div>
              ) : status === "paid" ? (
                <p className="text-sm text-primary">Đã xác nhận thanh toán.</p>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-destructive">
                    Mã thanh toán đã hết hạn hoặc bị hủy. Gói của bạn chưa được kích hoạt.
                  </p>

                  <Button className="w-full" onClick={() => setAttempt((n) => n + 1)}>
                    <RefreshCw className="h-4 w-4" />
                    Tạo mã thanh toán mới
                  </Button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
