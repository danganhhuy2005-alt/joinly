import { createFileRoute, Link } from "@tanstack/react-router";

import { ArrowLeft, Check, Crown, Sparkles, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/plans")({
  head: () => ({
    meta: [
      {
        title: "Gói dịch vụ — Joinly",
      },
    ],
  }),

  component: PlansPage,
});

function PlansPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-6 py-10">
        {/* BACK */}
        <Link
          to="/my-events"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Quay lại
        </Link>

        {/* HEADER */}
        <div className="mx-auto mt-8 max-w-3xl text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <Crown className="h-6 w-6 text-primary" />
          </div>

          <h1 className="mt-5 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Chọn gói phù hợp với sự kiện
          </h1>

          <p className="mt-3 text-muted-foreground">
            Nâng cấp khi bạn cần tổ chức sự kiện lớn hơn. Không có phí ẩn.
          </p>
        </div>

        {/* EVENT PLANS */}
        <section className="mt-12">
          <div>
            <h2 className="text-xl font-semibold">Gói theo sự kiện</h2>

            <p className="mt-1 text-sm text-muted-foreground">Mỗi gói áp dụng cho một sự kiện.</p>
          </div>

          <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {/* FREE */}
            <div className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Free</p>

                <div className="mt-3 flex items-end gap-1">
                  <span className="text-3xl font-bold">0đ</span>
                </div>

                <p className="mt-2 text-sm text-muted-foreground">Dành cho sự kiện nhỏ.</p>
              </div>

              <div className="my-5 h-px bg-border" />

              <div className="flex-1 space-y-3 text-sm">
                <Feature text="Tối đa 50 người tham dự" />
                <Feature text="QR check-in / check-out" />
                <Feature text="Dashboard sự kiện" />
                <Feature text="Allow-list" />
              </div>

              <Button type="button" variant="outline" className="mt-6 w-full" disabled>
                Gói miễn phí
              </Button>
            </div>

            {/* SMALL */}
            <div className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:border-primary/40">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Small</p>

                <div className="mt-3 flex items-end gap-1">
                  <span className="text-3xl font-bold">50.000đ</span>

                  <span className="pb-1 text-sm text-muted-foreground">/ sự kiện</span>
                </div>

                <p className="mt-2 text-sm text-muted-foreground">Phù hợp workshop và CLB nhỏ.</p>
              </div>

              <div className="my-5 h-px bg-border" />

              <div className="flex-1 space-y-3 text-sm">
                <Feature text="Tối đa 100 người tham dự" />
                <Feature text="Toàn bộ tính năng Free" />
                <Feature text="Quản lý đội ngũ" />
                <Feature text="Export dữ liệu CSV" />
              </div>

              <Button type="button" variant="outline" className="mt-6 w-full">
                Chọn Small
              </Button>
            </div>

            {/* STANDARD */}
            <div className="relative flex flex-col rounded-2xl border-2 border-primary bg-card p-6 shadow-md">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  <Sparkles className="h-3 w-3" />
                  Phổ biến
                </span>
              </div>

              <div>
                <p className="text-sm font-medium text-primary">Standard</p>

                <div className="mt-3 flex items-end gap-1">
                  <span className="text-3xl font-bold">88.000đ</span>

                  <span className="pb-1 text-sm text-muted-foreground">/ sự kiện</span>
                </div>

                <p className="mt-2 text-sm text-muted-foreground">
                  Phù hợp seminar và sự kiện vừa.
                </p>
              </div>

              <div className="my-5 h-px bg-border" />

              <div className="flex-1 space-y-3 text-sm">
                <Feature text="Tối đa 300 người tham dự" />
                <Feature text="Toàn bộ tính năng Small" />
                <Feature text="Check-in realtime" />
                <Feature text="Quản lý nhiều phòng" />
              </div>

              <Button type="button" className="mt-6 w-full">
                Chọn Standard
              </Button>
            </div>

            {/* PRO */}
            <div className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:border-primary/40">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  Pro
                  <Zap className="h-4 w-4 text-primary" />
                </p>

                <div className="mt-3 flex items-end gap-1">
                  <span className="text-3xl font-bold">199.000đ</span>

                  <span className="pb-1 text-sm text-muted-foreground">/ sự kiện</span>
                </div>

                <p className="mt-2 text-sm text-muted-foreground">Cho sự kiện quy mô lớn.</p>
              </div>

              <div className="my-5 h-px bg-border" />

              <div className="flex-1 space-y-3 text-sm">
                <Feature text="Tối đa 700 người tham dự" />
                <Feature text="Toàn bộ tính năng Standard" />
                <Feature text="Quản lý dữ liệu quy mô lớn" />
                <Feature text="Phù hợp hội thảo lớn" />
              </div>

              <Button type="button" variant="outline" className="mt-6 w-full">
                Chọn Pro
              </Button>
            </div>
          </div>
        </section>

        {/* MONTHLY */}
        <section className="mt-10">
          <div className="overflow-hidden rounded-3xl border border-primary/30 bg-primary/5">
            <div className="grid gap-8 p-7 md:grid-cols-[1fr_auto] md:items-center md:p-8">
              <div>
                <div className="flex items-center gap-2">
                  <Crown className="h-5 w-5 text-primary" />

                  <h2 className="text-xl font-semibold">Monthly</h2>

                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                    Theo tháng
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-2">
                  <span className="text-4xl font-bold">150.000đ</span>

                  <span className="pb-1 text-muted-foreground">/ 30 ngày</span>
                </div>

                <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
                  Dành cho cá nhân hoặc CLB thường xuyên tổ chức nhiều sự kiện.
                </p>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <Feature text="Tối đa 3 sự kiện trong 30 ngày" />
                  <Feature text="Quản lý gói theo tài khoản" />
                </div>
              </div>

              <Button type="button" size="lg" className="w-full md:w-auto">
                Chọn Monthly
              </Button>
            </div>
          </div>
        </section>

        {/* NOTE */}
        <p className="mt-8 text-center text-xs text-muted-foreground">
          Thanh toán qua chuyển khoản ngân hàng. Gói sẽ được kích hoạt tự động sau khi Joinly xác
          nhận thanh toán.
        </p>
      </div>
    </main>
  );
}

function Feature({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10">
        <Check className="h-3 w-3 text-primary" />
      </span>

      <span>{text}</span>
    </div>
  );
}
