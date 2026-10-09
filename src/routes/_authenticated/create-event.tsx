import { useEffect, useState } from "react";
import { createPayment } from "@/lib/payment.functions";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Plus, X, DoorOpen, Copy } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EventLocationPicker } from "@/components/EventLocationPicker";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/create-event")({
  validateSearch: (search: Record<string, unknown>): { resumeId?: string } => ({
    resumeId: typeof search.resumeId === "string" ? search.resumeId : undefined,
  }),

  head: () => ({
    meta: [{ title: "Tạo sự kiện — Joinly" }],
  }),
  component: CreateEvent,
});

const roomSchema = z.object({
  name: z.string().trim().min(1, "Tên phòng không được trống").max(80),
  accessCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4,6}$/, "Mã tham gia phải gồm 4–6 ký tự chữ hoa hoặc số")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

const schema = z.object({
  name: z.string().trim().min(1, "Vui lòng nhập tên sự kiện").max(120),
  description: z.string().trim().max(2000).optional(),
  location: z.string().trim().max(200).optional(),
  startsAt: z.string().min(1, "Vui lòng chọn thời gian bắt đầu"),
  expected: z.number().int().min(1, "Số người dự kiến phải ít nhất 1").max(100000),
  rooms: z.array(roomSchema).min(1, "Cần ít nhất một phòng"),
});

const EVENT_PLANS = [
  { code: "free", name: "Free", limit: 50, price: 0 },
  { code: "small", name: "Small", limit: 100, price: 50000 },
  { code: "standard", name: "Standard", limit: 300, price: 88000 },
  { code: "pro", name: "Pro", limit: 700, price: 199000 },
] as const;

type EventPlanCode = (typeof EVENT_PLANS)[number]["code"];

function CreateEvent() {
  const { resumeId } = Route.useSearch();
  const copyPaymentValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Đã sao chép!");
    } catch (error) {
      console.error("Copy error:", error);
      toast.error("Không thể sao chép!");
    }
  };
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState<Awaited<
    ReturnType<typeof createPayment>
  > | null>(null);

  const [paymentStatus, setPaymentStatus] = useState("pending");
  const [remainingMs, setRemainingMs] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [checkinRadius, setCheckinRadius] = useState("200");
  const [startsAt, setStartsAt] = useState("");
  const currentYear = new Date().getFullYear();
  const minStartsAt = (() => {
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  })();
  const maxStartsAt = `${currentYear + 1}-12-31T23:59`;

  const [expected, setExpected] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<EventPlanCode>("free");

  type MonthlyInfo = {
    subscription_id: string;
    expires_at: string;
    event_limit: number;
    events_used: number;
    events_remaining: number;
  };

  const [monthlyInfo, setMonthlyInfo] = useState<MonthlyInfo | null>(null);

  const [monthlyLoading, setMonthlyLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadMonthly = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) return;

        const { data, error } = await supabase.rpc("get_active_monthly_subscription", {
          p_user_id: user.id,
        });

        if (error) throw error;

        if (!cancelled) {
          setMonthlyInfo(data?.[0] ?? null);
        }
      } catch (error) {
        console.error("Load Monthly error:", error);
      } finally {
        if (!cancelled) {
          setMonthlyLoading(false);
        }
      }
    };

    void loadMonthly();

    return () => {
      cancelled = true;
    };
  }, []);

  const expectedNumber = Number(expected);

  const recommendedPlan = EVENT_PLANS.find(
    (plan) => expectedNumber > 0 && expectedNumber <= plan.limit,
  );

  const currentPlan = EVENT_PLANS.find((plan) => plan.code === selectedPlan)!;

  const exceedsPlan = expected.trim() !== "" && expectedNumber > currentPlan.limit;
  type RoomInput = { name: string; accessCode: string };
  const [rooms, setRooms] = useState<RoomInput[]>([{ name: "Hội trường chính", accessCode: "" }]);

  useEffect(() => {
    if (!resumeId) return;

    let cancelled = false;

    const resumePayment = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error("Vui lòng đăng nhập lại.");
        }

        const { data: draft, error } = await supabase
          .from("events")
          .select("organizer_id, lifecycle_status, requested_plan_code")
          .eq("id", resumeId)
          .maybeSingle();

        if (error || !draft || draft.organizer_id !== user.id) {
          throw new Error("Không tìm thấy bản nháp hợp lệ.");
        }

        if (draft.lifecycle_status !== "draft") {
          if (!cancelled) {
            navigate({
              to: "/manage-event/$id",
              params: { id: resumeId },
            });
          }
          return;
        }

        const planCode = draft.requested_plan_code;

        if (planCode !== "small" && planCode !== "standard" && planCode !== "pro") {
          throw new Error("Bản nháp chưa có gói thanh toán hợp lệ.");
        }

        const payment = await createPayment({
          data: {
            planCode,
            eventId: resumeId,
          },
        });

        if (cancelled) return;

        setPaymentOrder(payment);
        setPaymentStatus("pending");
      } catch (error) {
        if (cancelled) return;

        toast.error(error instanceof Error ? error.message : "Không thể tiếp tục thanh toán.");

        navigate({ to: "/my-events" });
      }
    };

    void resumePayment();

    return () => {
      cancelled = true;
    };
  }, [resumeId, navigate]);

  const updateRoomName = (i: number, v: string) =>
    setRooms((r) => r.map((x, idx) => (idx === i ? { ...x, name: v } : x)));
  const updateRoomCode = (i: number, v: string) =>
    setRooms((r) => r.map((x, idx) => (idx === i ? { ...x, accessCode: v.toUpperCase() } : x)));
  const addRoom = () => setRooms((r) => [...r, { name: "", accessCode: "" }]);
  const removeRoom = (i: number) => setRooms((r) => r.filter((_, idx) => idx !== i));

  useEffect(() => {
    const copyPaymentValue = async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        toast.success("Đã sao chép!");
      } catch {
        toast.error("Không thể sao chép. Vui lòng thử lại.");
      }
    };
    if (!paymentOrder) return;

    let stopped = false;

    const checkPayment = async () => {
      if (stopped) return;

      const { data, error } = await supabase
        .from("payments")
        .select("status")
        .eq("id", paymentOrder.id)
        .maybeSingle();

      if (stopped || error || !data) return;

      setPaymentStatus(data.status);

      if (data.status === "paid") {
        stopped = true;

        toast.success("Thanh toán thành công! Gói đã được kích hoạt.");

        if (paymentOrder.eventId) {
          navigate({
            to: "/manage-event/$id",
            params: { id: paymentOrder.eventId },
          });
        }
      }
    };

    void checkPayment();

    const timer = window.setInterval(() => {
      void checkPayment();
    }, 5000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [paymentOrder, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (latitude === null || longitude === null) {
      alert("Vui lòng lấy vị trí sự kiện trước khi tạo");
      return;
    }

    const radius = Number(checkinRadius);

    if (!radius || radius < 20 || radius > 5000) {
      alert("Bán kính check-in phải từ 20m đến 5000m");
      return;
    }
    if (!expected.trim()) {
      toast.error("Vui lòng nhập số người dự kiến.");
      return;
    }
    const parsed = schema.safeParse({
      name,
      description: description || undefined,
      location: location || undefined,
      startsAt,
      expected: Number(expected),
      rooms: rooms
        .map((r) => ({ name: r.name.trim(), accessCode: r.accessCode.trim() || undefined }))
        .filter((r) => r.name.length > 0),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
      return;
    }

    const when = new Date(parsed.data.startsAt);
    if (isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      toast.error("Ngày sự kiện phải ở tương lai");
      return;
    }
    const year = when.getFullYear();
    if (year < currentYear || year > currentYear + 1) {
      toast.error(`Năm sự kiện phải từ ${currentYear} đến ${currentYear + 1}`);
      return;
    }
    if (exceedsPlan) {
      toast.error(`Gói ${currentPlan.name} chỉ hỗ trợ tối đa ${currentPlan.limit} người.`);
      return;
    }

    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Phiên đăng nhập đã hết hạn");
      navigate({ to: "/" });
      return;
    }

    const { count, error: countError } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("organizer_id", user.id)
      .eq("lifecycle_status", "draft");

    if (countError) {
      setLoading(false);
      toast.error("Không thể kiểm tra giới hạn bản nháp.");
      return;
    }

    if ((count ?? 0) >= 3) {
      setLoading(false);

      toast.error(
        "Bạn đã có 3 bản nháp chưa thanh toán. Hãy hoàn tất hoặc xóa một bản nháp trước.",
      );

      navigate({ to: "/my-events" });
      return;
    }

    const { data: ev, error } = await supabase
      .from("events")
      .insert({
        organizer_id: user.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        location: parsed.data.location ?? null,

        latitude: latitude,
        longitude: longitude,
        checkin_radius: Number(checkinRadius),
        starts_at: new Date(parsed.data.startsAt).toISOString(),
        expected_attendees: parsed.data.expected,
        lifecycle_status: selectedPlan === "free" ? "active" : "draft",

        requested_plan_code: selectedPlan === "free" ? null : selectedPlan,
      })
      .select("id")
      .single();

    if (error || !ev) {
      setLoading(false);
      toast.error("Không thể tạo sự kiện. Vui lòng thử lại.");
      return;
    }

    const { error: roomErr } = await supabase.from("event_rooms").insert(
      parsed.data.rooms.map((rm, idx) => ({
        event_id: ev.id,
        name: rm.name,
        position: idx,
        access_code: rm.accessCode ?? null,
      })),
    );

    if (roomErr) {
      setLoading(false);
      toast.error("Không thể tạo phòng. Vui lòng thử lại.");
      return;
    }

    if (selectedPlan === "free") {
      setLoading(false);

      toast.success("Đã tạo sự kiện miễn phí!");

      navigate({
        to: "/manage-event/$id",
        params: { id: ev.id },
      });

      return;
    }

    try {
      const payment = await createPayment({
        data: {
          planCode: selectedPlan,
          eventId: ev.id,
        },
      });

      setPaymentOrder(payment);
      setPaymentStatus("pending");
      setLoading(false);

      toast.success("Đã tạo đơn thanh toán!");
    } catch (error) {
      setLoading(false);

      console.error("Create payment error:", error);

      toast.error(
        "Đã lưu sự kiện nhưng không thể tạo đơn thanh toán. Bạn có thể nâng cấp lại sau.",
      );

      navigate({
        to: "/manage-event/$id",
        params: { id: ev.id },
      });
    }
  };

  useEffect(() => {
    if (!paymentOrder?.expiresAt) return;

    const updateCountdown = () => {
      const expires = new Date(paymentOrder.expiresAt!).getTime();
      const remaining = Math.max(0, expires - Date.now());

      setRemainingMs(remaining);
    };

    updateCountdown();

    const timer = window.setInterval(updateCountdown, 1000);

    return () => window.clearInterval(timer);
  }, [paymentOrder?.expiresAt]);

  const totalSeconds = Math.ceil(remainingMs / 1000);

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const countdownText =
    `${String(minutes).padStart(2, "0")}:` + `${String(seconds).padStart(2, "0")}`;

  const isExpired = Boolean(
    paymentOrder?.expiresAt && Date.now() >= new Date(paymentOrder.expiresAt).getTime(),
  );

  if (resumeId && !paymentOrder) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />

        <p className="text-sm text-muted-foreground">Đang mở lại thanh toán cho bản nháp...</p>

        <Button asChild variant="outline">
          <Link to="/my-events">Quay lại</Link>
        </Button>
      </main>
    );
  }

  if (paymentOrder) {
    return (
      <main className="min-h-screen bg-background px-4 py-12">
        <div className="mx-auto max-w-lg space-y-6 rounded-2xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-2xl font-bold">
            Thanh toán gói {paymentOrder.planCode.toUpperCase()}
          </h1>

          <p className="text-3xl font-bold text-primary">
            {paymentOrder.amountVnd.toLocaleString("vi-VN")}đ
          </p>
          <div className="flex items-center justify-center gap-2 text-sm">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />

            <span className="font-medium">Đang chờ thanh toán</span>
          </div>
          {paymentOrder.expiresAt && paymentStatus === "pending" && (
            <div className="rounded-2xl border border-border bg-secondary/40 p-5 text-center">
              <p className="text-sm font-medium text-muted-foreground">
                Thời gian thanh toán còn lại
              </p>

              <p
                className={`mt-2 text-4xl font-bold tabular-nums ${
                  isExpired
                    ? "text-destructive"
                    : remainingMs <= 5 * 60 * 1000
                      ? "text-destructive"
                      : "text-primary"
                }`}
              >
                {isExpired ? "00:00" : countdownText}
              </p>

              <p className="mt-2 text-xs text-muted-foreground">
                {isExpired
                  ? "Đơn thanh toán đã hết hạn."
                  : "Vui lòng hoàn tất chuyển khoản trước khi hết giờ."}
              </p>
            </div>
          )}

          {paymentStatus === "pending" && !isExpired ? (
            <>
              <img
                src={paymentOrder.qrUrl}
                alt="QR thanh toán SePay"
                className="mx-auto w-full max-w-72 rounded-xl"
              />

              <div className="space-y-3 text-sm text-left">
                {[
                  {
                    label: "Ngân hàng",
                    value: paymentOrder.bank.bankCode,
                  },
                  {
                    label: "Số tài khoản",
                    value: paymentOrder.bank.accountNumber,
                  },
                  {
                    label: "Chủ tài khoản",
                    value: paymentOrder.bank.accountHolder,
                  },
                  {
                    label: "Nội dung chuyển khoản",
                    value: paymentOrder.orderCode,
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
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-2"
                      onClick={() => copyPaymentValue(item.value)}
                    >
                      <Copy className="h-4 w-4" />
                      Sao chép
                    </Button>
                  </div>
                ))}
              </div>

              <p className="text-sm text-muted-foreground">
                Vui lòng chuyển đúng số tiền và nội dung. Không cần tải lại trang.
              </p>
            </>
          ) : paymentStatus === "pending" && isExpired ? (
            <div className="space-y-4">
              <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
                Đơn thanh toán đã hết hạn. Bản nháp của bạn vẫn được lưu.
              </p>

              <Button asChild className="w-full">
                <Link to="/my-events">Quay lại bản nháp để tạo mã mới</Link>
              </Button>
            </div>
          ) : (
            <p className="rounded-lg bg-secondary p-4">Trạng thái đơn: {paymentStatus}</p>
          )}

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              if (paymentOrder.eventId) {
                navigate({
                  to: "/manage-event/$id",
                  params: { id: paymentOrder.eventId },
                });
              }
            }}
          >
            Trở về quản lý sự kiện
          </Button>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-secondary/30 px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <Link
          to="/my-events"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Quay lại
        </Link>
        <div className="mt-6 rounded-2xl border border-border bg-card p-8 shadow-sm">
          <h1 className="font-display text-2xl font-bold">Tạo sự kiện mới</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Điền thông tin để khởi tạo phòng QR cho sự kiện.
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="name">Tên sự kiện *</Label>

              <Input
                id="name"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Workshop UI/UX cơ bản"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="desc">Mô tả</Label>
              <Textarea
                id="desc"
                rows={4}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Mô tả ngắn về sự kiện..."
              />
            </div>

            {/* NGÀY & GIỜ */}
            <div className="space-y-1.5">
              <Label htmlFor="when">Ngày & giờ *</Label>

              <Input
                id="when"
                type="datetime-local"
                required
                min={minStartsAt}
                max={maxStartsAt}
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>

            {/* ĐỊA ĐIỂM TỔ CHỨC */}
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div>
                <Label>Địa điểm tổ chức</Label>

                <p className="text-xs text-muted-foreground">
                  Tìm địa điểm bằng VietMap. Bạn cũng có thể kéo ghim hoặc bấm trên bản đồ để chỉnh
                  lại vị trí.
                </p>
              </div>

              <EventLocationPicker
                latitude={latitude}
                longitude={longitude}
                address={location}
                onChange={(lat, lng, newAddress) => {
                  setLatitude(lat);
                  setLongitude(lng);

                  if (newAddress) {
                    setLocation(newAddress);
                  }
                }}
              />

              <div className="space-y-1.5">
                <Label htmlFor="checkin-radius">Bán kính check-in *</Label>

                <div className="flex items-center gap-2">
                  <Input
                    id="checkin-radius"
                    type="number"
                    required
                    min={20}
                    max={5000}
                    value={checkinRadius}
                    onChange={(e) => setCheckinRadius(e.target.value)}
                    placeholder="200"
                  />

                  <span className="text-sm text-muted-foreground">mét</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expected">Số người dự kiến *</Label>

              <Input
                id="expected"
                type="number"
                required
                min={1}
                max={100000}
                value={expected}
                onChange={(e) => {
                  const value = e.target.value;
                  setExpected(value);

                  const count = Number(value);
                  const recommended = EVENT_PLANS.find((plan) => count > 0 && count <= plan.limit);

                  setSelectedPlan(recommended?.code ?? "free");
                }}
                placeholder="VD: 120"
              />
            </div>

            <div className="space-y-3 rounded-xl border border-border p-4">
              <h3 className="font-semibold">Gói dịch vụ sự kiện</h3>

              {monthlyLoading ? (
                <p className="text-sm text-muted-foreground">Đang kiểm tra quyền Monthly...</p>
              ) : monthlyInfo ? (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-primary">Monthly đang hoạt động</p>

                    <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
                      Đã kích hoạt
                    </span>
                  </div>

                  <p className="mt-2 text-sm">
                    Đã sử dụng{" "}
                    <strong>
                      {monthlyInfo.events_used}/{monthlyInfo.event_limit}
                    </strong>{" "}
                    sự kiện
                  </p>

                  <p className="mt-1 text-sm">
                    Còn lại: <strong>{monthlyInfo.events_remaining} sự kiện</strong>
                  </p>

                  <p className="mt-1 text-sm text-muted-foreground">
                    Tối đa 500 người mỗi sự kiện.
                  </p>

                  <p className="mt-2 text-xs text-muted-foreground">
                    Hết hạn: {new Date(monthlyInfo.expires_at).toLocaleString("vi-VN")}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Chưa có gói Monthly đang hoạt động.</p>
              )}

              {recommendedPlan ? (
                <p className="text-sm text-muted-foreground">
                  Gói đề xuất:{" "}
                  <span className="font-semibold text-primary">{recommendedPlan.name}</span> — tối
                  đa {recommendedPlan.limit} người.
                </p>
              ) : expectedNumber > 700 ? (
                <p className="text-sm text-destructive">
                  Hiện Joinly hỗ trợ tối đa 700 người/sự kiện.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nhập số người dự kiến để nhận đề xuất.
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                {EVENT_PLANS.map((plan) => (
                  <button
                    key={plan.code}
                    type="button"
                    onClick={() => setSelectedPlan(plan.code)}
                    className={`rounded-xl border p-3 text-left transition ${
                      selectedPlan === plan.code
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <p className="font-semibold">{plan.name}</p>
                    <p className="text-sm text-muted-foreground">{plan.limit} người</p>
                    <p className="mt-1 text-sm font-medium">
                      {plan.price.toLocaleString("vi-VN")}đ
                    </p>
                  </button>
                ))}
              </div>

              {exceedsPlan && (
                <p className="text-sm text-destructive">
                  Gói {currentPlan.name} chỉ hỗ trợ tối đa {currentPlan.limit} người. Vui lòng chọn
                  gói cao hơn hoặc giảm số người dự kiến.
                </p>
              )}

              {selectedPlan !== "free" && !exceedsPlan && (
                <p className="text-sm text-muted-foreground">
                  Gói trả phí sẽ được kích hoạt sau khi thanh toán thành công.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5">
                  <DoorOpen className="h-4 w-4 text-primary" /> Phòng (rooms) *
                </Label>
                <span className="text-xs text-muted-foreground">{rooms.length} phòng</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Mỗi phòng có thể là một khu vực, lớp học hoặc workshop con của sự kiện.
              </p>
              <div className="space-y-3">
                {rooms.map((r, i) => (
                  <div key={i} className="rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="flex items-center gap-2">
                      <Input
                        value={r.name}
                        maxLength={80}
                        onChange={(e) => updateRoomName(i, e.target.value)}
                        placeholder={
                          i === 0 ? "Hội trường chính" : i === 1 ? "Phòng 2" : "Workshop A"
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRoom(i)}
                        disabled={rooms.length === 1}
                        aria-label="Xoá phòng"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-2 grid gap-1">
                      <Label htmlFor={`code-${i}`} className="text-xs text-muted-foreground">
                        Mã tham gia (tuỳ chọn) — 4–6 ký tự chữ hoa hoặc số. Để trống nếu phòng mở.
                      </Label>
                      <Input
                        id={`code-${i}`}
                        value={r.accessCode}
                        maxLength={6}
                        onChange={(e) => updateRoomCode(i, e.target.value)}
                        placeholder="VD: A1B2"
                        className="uppercase"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <Button type="button" variant="outline" size="sm" onClick={addRoom}>
                <Plus className="h-4 w-4" /> Thêm phòng
              </Button>
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={loading || exceedsPlan || expectedNumber > 700}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Tạo sự kiện
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
