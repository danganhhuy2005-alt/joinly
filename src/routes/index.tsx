import { useEffect, useState } from "react";
import { CalendarPlus } from "lucide-react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import {
  ArrowRight,
  BarChart3,
  Crown,
  QrCode,
  Sparkles,
  ShieldCheck,
  DoorOpen,
  FileDown,
  Users,
} from "lucide-react";

import { AuthModal } from "@/components/AuthModal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AppLogo } from "@/components/AppLogo";

import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: "Joinly — Quản lý sự kiện & người tham gia bằng QR",
      },
      {
        name: "description",
        content:
          "Joinly giúp ban tổ chức tạo sự kiện, quản lý người tham gia bằng QR theo từng phòng và xem dữ liệu trong một dashboard duy nhất.",
      },
    ],
  }),

  component: Landing,
});

type AuthActionsProps = {
  loggedIn: boolean;
  loading: boolean;
  onLogin: () => void;
  onCreateEvent: () => void;
};

function Landing() {
  const { user, loading } = useAuth();

  const navigate = useNavigate();

  const [authModalOpen, setAuthModalOpen] = useState(false);

  const [authNextPath, setAuthNextPath] = useState("/my-events");

  const openLoginModal = () => {
    setAuthNextPath("/my-events");
    setAuthModalOpen(true);
  };

  const openCreateEventModal = () => {
    setAuthNextPath("/create-event");
    setAuthModalOpen(true);
  };

  useEffect(() => {
    if (!loading && user) {
      navigate({
        to: "/my-events",
        replace: true,
      });
    }
  }, [loading, user, navigate]);

  // Đang kiểm tra phiên đăng nhập
  // hoặc đã đăng nhập và đang chuyển sang /my-events
  if (loading || user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Đang tải...</p>
      </div>
    );
  }

  // Chỉ người CHƯA đăng nhập mới thấy landing page
  return (
    <>
      <div className="min-h-screen bg-background text-foreground">
        <Header
          loggedIn={false}
          loading={false}
          onLogin={openLoginModal}
          onCreateEvent={openCreateEventModal}
        />

        <main>
          <Hero
            loggedIn={false}
            loading={false}
            onLogin={openLoginModal}
            onCreateEvent={openCreateEventModal}
          />

          <Features />

          <HowItWorks />

          <Pricing onCreateEvent={openCreateEventModal} />

          <CTA
            loggedIn={false}
            loading={false}
            onLogin={openLoginModal}
            onCreateEvent={openCreateEventModal}
          />
        </main>

        <Footer />
      </div>

      <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} nextPath={authNextPath} />
    </>
  );
}

function Header({ loggedIn, loading, onLogin, onCreateEvent }: AuthActionsProps) {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        {/* LOGO */}
        <Link to={loggedIn ? "/my-events" : "/"} className="flex items-center">
          <AppLogo />
        </Link>

        {/* MENU */}
        <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
          <a href="#tinh-nang" className="transition-colors hover:text-foreground">
            Tính năng
          </a>

          <a href="#cach-hoat-dong" className="transition-colors hover:text-foreground">
            Cách hoạt động
          </a>

          <a href="#bang-gia" className="transition-colors hover:text-foreground">
            Bảng giá
          </a>

          <a href="#lien-he" className="transition-colors hover:text-foreground">
            Liên hệ
          </a>
        </nav>

        {/* AUTH BUTTONS */}
        <div className="flex items-center gap-2">
          <ThemeToggle />

          {loading ? (
            <span className="text-sm text-muted-foreground">Đang kiểm tra...</span>
          ) : loggedIn ? (
            <>
              <Link
                to="/my-events"
                className="hidden rounded-md px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent sm:inline-flex"
              >
                Sự kiện của tôi
              </Link>

              <Link
                to="/create-event"
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90"
              >
                Tạo sự kiện
                <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onLogin}
                className="hidden rounded-md px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent sm:inline-flex"
              >
                Đăng nhập
              </button>

              <button
                type="button"
                onClick={onCreateEvent}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90"
              >
                Tạo sự kiện
                <ArrowRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Hero({ loggedIn, loading, onLogin, onCreateEvent }: AuthActionsProps) {
  return (
    <section
      className="relative overflow-hidden"
      style={{
        background: "var(--gradient-hero)",
      }}
    >
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-4 py-1.5 text-xs font-medium text-primary backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />
            Nền tảng quản lý sự kiện dành cho ban tổ chức
          </span>

          <h1 className="mt-6 font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground md:text-6xl lg:text-7xl">
            Quản lý sự kiện
            <span className="block text-primary">dễ dàng hơn với Joinly</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            Tạo sự kiện, kiểm soát người tham gia bằng Allow-list, check-in bằng QR, quản lý đội ngũ
            và theo dõi dữ liệu trong một nền tảng duy nhất.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {loading ? (
              <>
                <button
                  type="button"
                  disabled
                  className="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-primary px-7 py-3.5 text-base font-semibold text-primary-foreground opacity-60 sm:w-auto"
                >
                  Đang kiểm tra...
                </button>

                <button
                  type="button"
                  disabled
                  className="inline-flex w-full cursor-not-allowed items-center justify-center rounded-lg border border-border bg-background px-7 py-3.5 text-base font-semibold text-foreground opacity-60 sm:w-auto"
                >
                  Vui lòng chờ
                </button>
              </>
            ) : loggedIn ? (
              <>
                <Link
                  to="/create-event"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-7 py-3.5 text-base font-semibold text-primary-foreground transition-all hover:opacity-90 sm:w-auto"
                  style={{
                    boxShadow: "var(--shadow-elegant)",
                  }}
                >
                  Tạo sự kiện
                  <ArrowRight className="h-4 w-4" />
                </Link>

                <Link
                  to="/my-events"
                  className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-background px-7 py-3.5 text-base font-semibold text-foreground transition-colors hover:bg-accent sm:w-auto"
                >
                  Sự kiện của tôi
                </Link>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onCreateEvent}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-7 py-3.5 text-base font-semibold text-primary-foreground transition-all hover:opacity-90 sm:w-auto"
                  style={{
                    boxShadow: "var(--shadow-elegant)",
                  }}
                >
                  Tạo sự kiện
                  <ArrowRight className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={onLogin}
                  className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-background px-7 py-3.5 text-base font-semibold text-foreground transition-colors hover:bg-accent sm:w-auto"
                >
                  Đăng nhập
                </button>
              </>
            )}
          </div>

          <p className="mt-6 text-sm text-muted-foreground">
            Bắt đầu miễn phí với tối đa 20 người tham dự
          </p>
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    {
      icon: QrCode,
      title: "QR Check-in / Check-out",
      description: "Check-in và check-out nhanh bằng QR, lưu thời gian và người thực hiện.",
    },
    {
      icon: ShieldCheck,
      title: "Allow-list",
      description: "Kiểm soát người được phép tham gia toàn sự kiện hoặc từng phòng.",
    },
    {
      icon: BarChart3,
      title: "Dashboard realtime",
      description:
        "Theo dõi đăng ký, check-in, check-out và trạng thái người tham dự theo thời gian thực.",
    },
    {
      icon: Users,
      title: "Đội ngũ quản lý",
      description: "Phân quyền Owner, Co-owner và Manager để cùng vận hành sự kiện an toàn.",
    },
    {
      icon: DoorOpen,
      title: "Quản lý nhiều phòng",
      description:
        "Tạo nhiều phòng trong cùng một sự kiện và quản lý người tham gia theo từng phòng.",
    },
    {
      icon: FileDown,
      title: "Export CSV",
      description: "Xuất danh sách người tham dự và dữ liệu check-in/out để tổng hợp sau sự kiện.",
    },
  ];

  return (
    <section id="tinh-nang" className="mx-auto max-w-6xl px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <span className="text-sm font-semibold uppercase tracking-wider text-primary">
          Mọi thứ bạn cần
        </span>

        <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
          Quản lý sự kiện trong một nền tảng
        </h2>

        <p className="mt-4 text-lg text-muted-foreground">
          Từ kiểm soát người tham gia đến check-in và theo dõi dữ liệu, Joinly giúp ban tổ chức vận
          hành sự kiện gọn gàng hơn.
        </p>
      </div>

      <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => {
          const Icon = feature.icon;

          return (
            <div
              key={feature.title}
              className="group rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-md"
            >
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 transition group-hover:bg-primary">
                <Icon className="h-5 w-5 text-primary transition group-hover:text-primary-foreground" />
              </div>

              <h3 className="mt-5 text-lg font-semibold">{feature.title}</h3>

              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      number: "01",
      icon: CalendarPlus,
      title: "Tạo sự kiện",
      description: "Thiết lập tên sự kiện, thời gian, địa điểm, phòng và các tùy chọn quản lý.",
    },
    {
      number: "02",
      icon: Users,
      title: "Mời người tham gia",
      description: "Mở đăng ký, sử dụng Allow-list khi cần và quản lý danh sách người tham dự.",
    },
    {
      number: "03",
      icon: QrCode,
      title: "Check-in & theo dõi",
      description:
        "Check-in bằng QR và theo dõi dữ liệu người tham dự trên Dashboard theo thời gian thực.",
    },
  ];

  return (
    <section id="cach-hoat-dong" className="border-y border-border bg-card/40">
      <div className="mx-auto max-w-6xl px-6 py-24">
        {/* HEADER */}
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-primary">
            Cách hoạt động
          </span>

          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
            Bắt đầu chỉ với 3 bước
          </h2>

          <p className="mt-4 text-lg text-muted-foreground">
            Từ lúc tạo sự kiện đến khi check-in, Joinly giúp bạn quản lý toàn bộ quy trình trong một
            nơi.
          </p>
        </div>

        {/* STEPS */}
        <div className="relative mt-14 grid gap-6 md:grid-cols-3">
          {/* CONNECTING LINE - DESKTOP */}
          <div className="absolute left-[16%] right-[16%] top-10 hidden h-px bg-border md:block" />

          {steps.map((step) => {
            const Icon = step.icon;

            return (
              <div key={step.number} className="relative text-center">
                {/* ICON */}
                <div className="relative z-10 mx-auto grid h-20 w-20 place-items-center rounded-2xl border border-border bg-background shadow-sm">
                  <Icon className="h-7 w-7 text-primary" />

                  <span className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {step.number}
                  </span>
                </div>

                {/* CONTENT */}
                <h3 className="mt-6 text-lg font-semibold">{step.title}</h3>

                <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Pricing({ onCreateEvent }: { onCreateEvent: () => void }) {
  const plans = [
    {
      name: "Free",
      price: "0đ",
      suffix: "",
      limit: "Tối đa 20 người",
      description: "Dành cho sự kiện nhỏ.",
      popular: false,
    },
    {
      name: "Small",
      price: "50.000đ",
      suffix: "/ sự kiện",
      limit: "Tối đa 100 người",
      description: "Workshop và CLB nhỏ.",
      popular: false,
    },
    {
      name: "Standard",
      price: "88.000đ",
      suffix: "/ sự kiện",
      limit: "Tối đa 300 người",
      description: "Seminar và sự kiện vừa.",
      popular: true,
    },
    {
      name: "Pro",
      price: "199.000đ",
      suffix: "/ sự kiện",
      limit: "Tối đa 700 người",
      description: "Sự kiện quy mô lớn.",
      popular: false,
    },
  ];

  return (
    <section id="bang-gia" className="mx-auto max-w-6xl px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10">
          <Crown className="h-6 w-6 text-primary" />
        </div>

        <h2 className="mt-5 font-display text-4xl font-bold tracking-tight md:text-5xl">
          Bảng giá đơn giản
        </h2>

        <p className="mt-4 text-lg text-muted-foreground">
          Bắt đầu miễn phí và chỉ nâng cấp khi sự kiện của bạn lớn hơn.
        </p>
      </div>

      <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={`relative flex flex-col rounded-2xl bg-card p-6 ${
              plan.popular ? "border-2 border-primary shadow-md" : "border border-border shadow-sm"
            }`}
          >
            {plan.popular && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                Phổ biến
              </span>
            )}

            <p className={plan.popular ? "font-semibold text-primary" : "font-semibold"}>
              {plan.name}
            </p>

            <div className="mt-3 flex items-end gap-1">
              <span className="text-3xl font-bold">{plan.price}</span>

              {plan.suffix && (
                <span className="pb-1 text-xs text-muted-foreground">{plan.suffix}</span>
              )}
            </div>

            <p className="mt-3 font-medium">{plan.limit}</p>

            <p className="mt-1 flex-1 text-sm text-muted-foreground">{plan.description}</p>

            <button
              type="button"
              onClick={onCreateEvent}
              className={`mt-6 inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition ${
                plan.popular
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "border border-border hover:bg-accent"
              }`}
            >
              {plan.name === "Free" ? "Bắt đầu miễn phí" : `Chọn ${plan.name}`}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-semibold">
            <Crown className="h-4 w-4 text-primary" />
            Monthly
          </p>

          <p className="mt-1 text-sm text-muted-foreground">
            150.000đ / 30 ngày · Tối đa 3 sự kiện
          </p>
        </div>

        <button
          type="button"
          onClick={onCreateEvent}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Bắt đầu với Joinly
        </button>
      </div>
    </section>
  );
}

function CTA({ loggedIn, loading, onLogin, onCreateEvent }: AuthActionsProps) {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div
        className="relative overflow-hidden rounded-3xl px-8 py-16 text-center md:px-16 md:py-20"
        style={{
          background: "var(--gradient-primary)",

          boxShadow: "var(--shadow-elegant)",
        }}
      >
        <h2 className="font-display text-4xl font-bold tracking-tight text-primary-foreground md:text-5xl">
          Sẵn sàng cho sự kiện tiếp theo?
        </h2>

        <p className="mx-auto mt-4 max-w-xl whitespace-pre-line text-lg text-primary-foreground/85">
          Tạo sự kiện, mở phòng QR và quản lý người tham gia
          {"\n"}
          trong vài phút.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {loading ? (
            <>
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center justify-center rounded-lg bg-background px-7 py-3.5 text-base font-semibold text-primary opacity-60"
              >
                Đang kiểm tra...
              </button>

              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center justify-center rounded-lg border border-primary-foreground/30 px-7 py-3.5 text-base font-semibold text-primary-foreground opacity-60"
              >
                Vui lòng chờ
              </button>
            </>
          ) : loggedIn ? (
            <>
              <Link
                to="/create-event"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-background px-7 py-3.5 text-base font-semibold text-primary transition-transform hover:scale-[1.02]"
              >
                Tạo sự kiện
                <ArrowRight className="h-4 w-4" />
              </Link>

              <Link
                to="/my-events"
                className="inline-flex items-center justify-center rounded-lg border border-primary-foreground/30 px-7 py-3.5 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/10"
              >
                Sự kiện của tôi
              </Link>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onCreateEvent}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-background px-7 py-3.5 text-base font-semibold text-primary transition-transform hover:scale-[1.02]"
              >
                Tạo sự kiện
                <ArrowRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onLogin}
                className="inline-flex items-center justify-center rounded-lg border border-primary-foreground/30 px-7 py-3.5 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/10"
              >
                Đăng nhập
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer id="lien-he" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col items-center justify-between gap-5 sm:flex-row">
          <div className="flex items-center gap-3">
            <AppLogo imageClassName="h-9" />

            <span className="text-sm text-muted-foreground">Quản lý sự kiện bằng QR</span>
          </div>

          <div className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link to="/privacy" className="transition-colors hover:text-foreground">
              Chính sách quyền riêng tư
            </Link>

            <Link to="/terms" className="transition-colors hover:text-foreground">
              Điều khoản sử dụng
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground sm:text-left">
          © {new Date().getFullYear()} Joinly. Mọi quyền được bảo lưu.
        </p>
      </div>
    </footer>
  );
}
