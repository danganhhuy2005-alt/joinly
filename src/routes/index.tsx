import { createFileRoute, Link } from "@tanstack/react-router";
import { QrCode, CalendarPlus, BarChart3, Sparkles, ArrowRight, Users } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Joinly — Quản lý sự kiện & người tham gia bằng QR" },
      { name: "description", content: "Joinly giúp ban tổ chức tạo sự kiện, quản lý người tham gia bằng QR theo từng phòng và xem dữ liệu trong một dashboard duy nhất." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <Logo />
          <span className="font-display text-xl font-bold tracking-tight">Joinly</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
          <a href="#tinh-nang" className="transition-colors hover:text-foreground">Tính năng</a>
          <a href="#cach-hoat-dong" className="transition-colors hover:text-foreground">Cách hoạt động</a>
          <a href="#lien-he" className="transition-colors hover:text-foreground">Liên hệ</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            to="/login"
            className="hidden rounded-md px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent sm:inline-flex"
          >
            Đăng nhập
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90"
          >
            Tạo sự kiện
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-[var(--shadow-soft)]">
      <Sparkles className="h-4 w-4" strokeWidth={2.5} />
    </span>
  );
}

function Hero() {
  return (
    <section
      className="relative overflow-hidden"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-4 py-1.5 text-xs font-medium text-primary backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Dành cho mọi ban tổ chức sự kiện
          </span>
          <h1 className="mt-6 font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground md:text-6xl lg:text-7xl">
            Tổ chức sự kiện,{" "}
            <span className="text-primary whitespace-pre-line">{"\n"}gọn nhẹ trong một nơi</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            Joinly giúp bạn tạo sự kiện, để người tham gia join phòng bằng QR,
            quản lý danh sách và xem dữ liệu trên một dashboard duy nhất.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/login"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-7 py-3.5 text-base font-semibold text-primary-foreground transition-all hover:opacity-90 sm:w-auto"
              style={{ boxShadow: "var(--shadow-elegant)" }}
            >
              Tạo sự kiện
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/login"
              className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-background px-7 py-3.5 text-base font-semibold text-foreground transition-colors hover:bg-accent sm:w-auto"
            >
              Đăng nhập
            </Link>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Phù hợp với CLB, trường học, trung tâm đào tạo, doanh nghiệp, workshop, hội thảo, hội nghị, đám cưới và sự kiện cộng đồng.
          </p>
        </div>

        <HeroPreview />
      </div>
    </section>
  );
}

function HeroPreview() {
  return (
    <div className="relative mx-auto mt-16 max-w-4xl">
      <div
        className="relative overflow-hidden rounded-2xl border border-border bg-card p-2"
        style={{ boxShadow: "var(--shadow-elegant)" }}
      >
          <div className="rounded-xl bg-gradient-to-br from-primary-soft to-background p-8">
            <div className="grid gap-4 md:grid-cols-2">
              <PreviewCard icon={<CalendarPlus className="h-5 w-5" />} title="Workshop UI/UX" meta="20 tháng 6 · 18:00" tone="primary" />
              <PreviewCard icon={<Users className="h-5 w-5" />} title="142 người tham gia" meta="QR Room đang mở" />
            </div>
          </div>
      </div>
    </div>
  );
}

function PreviewCard({ icon, title, meta, tone }: { icon: React.ReactNode; title: string; meta: string; tone?: "primary" }) {
  const isPrimary = tone === "primary";
  return (
    <div className={`rounded-xl border p-4 text-left ${isPrimary ? "border-primary/20 bg-primary text-primary-foreground" : "border-border bg-card text-card-foreground"}`}>
      <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg ${isPrimary ? "bg-primary-foreground/15" : "bg-primary-soft text-primary"}`}>
        {icon}
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <div className={`mt-1 text-xs ${isPrimary ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{meta}</div>
    </div>
  );
}

function Features() {
  const items = [
    {
      icon: <CalendarPlus className="h-6 w-6" />,
      title: "Tạo sự kiện nhanh",
      desc: "Đặt tên, thời gian, địa điểm và các phòng tham gia. Dùng được cho workshop, hội thảo, lớp học, đám cưới hay sự kiện nội bộ.",
    },
    {
      icon: <QrCode className="h-6 w-6" />,
      title: "QR tham gia phòng",
      desc: "Mỗi phòng có một mã QR riêng. Người tham gia quét QR, điền form và được ghi nhận vào đúng phòng.",
    },
    {
      icon: <BarChart3 className="h-6 w-6" />,
      title: "Dashboard dữ liệu",
      desc: "Xem số người tham gia theo từng phòng, tìm kiếm danh sách và xuất file CSV khi cần.",
    },
  ];
  return (
    <section id="tinh-nang" className="mx-auto max-w-6xl px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
          Những gì Joinly làm
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Bốn việc cơ bản cho một sự kiện: tạo sự kiện, mở phòng QR, thu thông tin người tham gia, xem dữ liệu.
        </p>
      </div>
      <div className="mt-16 grid gap-6 md:grid-cols-3">
        {items.map((f) => (
          <div
            key={f.title}
            className="group rounded-2xl border border-border bg-card p-7 transition-all hover:-translate-y-1 hover:border-primary/30"
            style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}
          >
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              {f.icon}
            </div>
            <h3 className="mt-5 text-xl font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", title: "Tạo sự kiện", desc: "Đăng nhập, tạo sự kiện và thêm các phòng tham gia bạn cần." },
    { n: "02", title: "Chia sẻ QR", desc: "Mỗi phòng có một mã QR riêng. In ra hoặc chiếu lên màn hình tại sự kiện." },
    { n: "03", title: "Xem dữ liệu", desc: "Theo dõi danh sách người tham gia theo từng phòng và xuất CSV khi cần." },
  ];
  return (
    <section id="cach-hoat-dong" className="border-y border-border bg-secondary/50">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
            Ba bước để bắt đầu
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Không cần kỹ năng kỹ thuật. Dùng được cho mọi loại sự kiện.
          </p>
        </div>
        <div className="mt-16 grid gap-8 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="relative">
              <div className="font-display text-6xl font-extrabold text-primary">{s.n}</div>
              <h3 className="mt-2 text-xl font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div
        className="relative overflow-hidden rounded-3xl px-8 py-16 text-center md:px-16 md:py-20"
        style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-elegant)" }}
      >
        <h2 className="font-display text-4xl font-bold tracking-tight text-primary-foreground md:text-5xl">
          Sẵn sàng cho sự kiện tiếp theo?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-primary-foreground/85 whitespace-pre-line">
          Tạo sự kiện, mở phòng QR và quản lý người tham gia{"\u00a0\n"}trong vài phút.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/login"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-background px-7 py-3.5 text-base font-semibold text-primary transition-transform hover:scale-[1.02]"
          >
            Tạo sự kiện
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center justify-center rounded-lg border border-primary-foreground/30 px-7 py-3.5 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/10"
          >
            Đăng nhập
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer id="lien-he" className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 sm:flex-row">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="font-display font-bold">Joinly</span>
          <span className="text-sm text-muted-foreground">· Quản lý sự kiện bằng QR</span>
        </div>
        <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} Joinly. Mọi quyền được bảo lưu.</p>
      </div>
    </footer>
  );
}
