import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/my-events";
  return value;
}

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Đăng nhập ban tổ chức — Joinly" },
      { name: "description", content: "Đăng nhập hoặc đăng ký tài khoản ban tổ chức Joinly để tạo và quản lý sự kiện." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" ? s.next : undefined,
  }),
  component: AuthPage,
});

function AuthPage() {
  const { next } = Route.useSearch();

  const nextPath = safeNext(next);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}${nextPath}`,
            data: { full_name: fullName, club_name: clubName },
          },
        });
        if (error) throw error;
        if (!data.session) {
          const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
          if (signInErr) {
            toast.success("Tạo tài khoản thành công! Vui lòng đăng nhập.");
            setMode("login");
            return;
          }
        }
        toast.success("Tạo tài khoản thành công!");
        window.location.href = nextPath;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Đăng nhập thành công!");
        window.location.href = nextPath;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Đã có lỗi xảy ra";
      toast.error(msg.includes("Invalid login") ? "Email hoặc mật khẩu không đúng" : msg);
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    setGoogleLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}${nextPath}`,
    });
    if (result.error) {
      toast.error("Không thể đăng nhập với Google");
      setGoogleLoading(false);
      return;
    }
    if (result.redirected) return;
    window.location.href = nextPath;
  };


  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Về trang chủ
        </Link>
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" strokeWidth={2.5} />
            </span>
            <span className="font-display text-xl font-bold">Joinly</span>
          </div>
          <h1 className="mt-6 font-display text-2xl font-bold">
            {mode === "login" ? "Đăng nhập ban tổ chức" : "Tạo tài khoản ban tổ chức"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "login"
              ? "Quản lý sự kiện của bạn trên Joinly."
              : "Bắt đầu tổ chức sự kiện cho đơn vị của bạn."}
          </p>

          <Button
            type="button"
            variant="outline"
            className="mt-6 w-full"
            onClick={onGoogle}
            disabled={googleLoading}
          >
            {googleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
            Tiếp tục với Google
          </Button>

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> HOẶC <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === "signup" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="fullName">Họ và tên</Label>
                  <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nguyễn Văn A" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="clubName">Tên đơn vị tổ chức</Label>
                  <Input id="clubName" required value={clubName} onChange={(e) => setClubName(e.target.value)} placeholder="Công ty / Đơn vị ABC" />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ban-to-chuc@email.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Mật khẩu</Label>
              <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Ít nhất 6 ký tự" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
            </Button>
            {mode === "login" && (
              <div className="text-right">
                <Link to="/forgot-password" className="text-sm text-primary hover:underline">
                  Quên mật khẩu?
                </Link>
              </div>
            )}
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "login" ? "Chưa có tài khoản?" : "Đã có tài khoản?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
              className="font-medium text-primary hover:underline"
            >
              {mode === "login" ? "Đăng ký ngay" : "Đăng nhập"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
    </svg>
  );
}
