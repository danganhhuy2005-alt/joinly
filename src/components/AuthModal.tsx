import { useEffect, useRef, useState, type FormEvent } from "react";

import { Link } from "@tanstack/react-router";

import { ArrowRight, Loader2, Eye, EyeOff, Sparkles } from "lucide-react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { supabase } from "@/integrations/supabase/client";

type AuthModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nextPath: string;
};

function safeNext(value: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/my-events";
  }

  return value;
}

export function AuthModal({ open, onOpenChange, nextPath }: AuthModalProps) {
  const safeNextPath = safeNext(nextPath);

  // GIỮ NGUYÊN LOGIC CŨ
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [fullName, setFullName] = useState("");

  const [clubName, setClubName] = useState("");

  const [loading, setLoading] = useState(false);

  const [googleLoading, setGoogleLoading] = useState(false);

  const popupRef = useRef<Window | null>(null);

  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // ==========================================
  // RESET MODAL KHI ĐÓNG
  // ==========================================

  useEffect(() => {
    if (open) {
      return;
    }

    setMode("login");
    setEmail("");
    setPassword("");
    setFullName("");
    setClubName("");
    setLoading(false);
    setGoogleLoading(false);
  }, [open]);

  // ==========================================
  // NHẬN KẾT QUẢ GOOGLE POPUP
  // ==========================================

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data?.type !== "joinly-auth-success") {
        return;
      }

      popupRef.current?.close();

      setGoogleLoading(false);

      onOpenChange(false);

      window.location.href = safeNextPath;
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [onOpenChange, safeNextPath]);

  useEffect(() => {
    const channel = new BroadcastChannel("joinly-auth");

    channel.onmessage = (event) => {
      if (event.data?.type !== "joinly-auth-success") {
        return;
      }

      popupRef.current?.close();

      setGoogleLoading(false);

      onOpenChange(false);

      window.location.href = safeNextPath;
    };

    return () => {
      channel.close();
    };
  }, [onOpenChange, safeNextPath]);

  // ==========================================
  // EMAIL / PASSWORD
  // LOGIC GIỮ THEO LOGIN.TSX CŨ
  // ==========================================

  const validatePassword = (value: string) => {
    if (value.length < 8) {
      return "Mật khẩu phải có ít nhất 8 ký tự.";
    }

    if (!/[A-Z]/.test(value)) {
      return "Mật khẩu phải có ít nhất 1 chữ hoa.";
    }

    if (!/[a-z]/.test(value)) {
      return "Mật khẩu phải có ít nhất 1 chữ thường.";
    }

    if (!/[0-9]/.test(value)) {
      return "Mật khẩu phải có ít nhất 1 chữ số.";
    }

    return null;
  };

  const passwordError =
    mode === "signup" && password.length > 0 ? validatePassword(password) : null;
  const confirmPasswordError =
    mode === "signup" && confirmPassword.length > 0 && password !== confirmPassword
      ? "Mật khẩu xác nhận không khớp."
      : null;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (mode === "signup") {
      const passwordError = validatePassword(password);

      if (passwordError) {
        toast.error(passwordError);
        return;
      }

      if (password !== confirmPassword) {
        toast.error("Mật khẩu xác nhận không khớp.");
        return;
      }
    }

    setLoading(true);

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,

          options: {
            emailRedirectTo: `${window.location.origin}${safeNextPath}`,

            data: {
              full_name: fullName,

              club_name: clubName,
            },
          },
        });

        if (error) {
          throw error;
        }

        const identities = data.user?.identities ?? [];

        // Supabase trả user giả nếu email đã tồn tại
        if (data.user && identities.length === 0) {
          toast.info("Email đã tồn tại. Vui lòng đăng nhập.");

          setMode("login");
          setPassword("");
          setConfirmPassword("");

          return;
        }
        if (!data.session) {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (signInError) {
            toast.success("Tạo tài khoản thành công! Vui lòng đăng nhập.");

            setMode("login");
            setPassword("");

            return;
          }
        }

        toast.success("Tạo tài khoản thành công!");

        onOpenChange(false);

        window.location.href = safeNextPath;

        return;
      }

      // ===============================
      // LOGIN
      // ===============================

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw error;
      }

      toast.success("Đăng nhập thành công!");

      onOpenChange(false);

      window.location.href = safeNextPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Đã có lỗi xảy ra";

      toast.error(message.includes("Invalid login") ? "Email hoặc mật khẩu không đúng" : message);
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // GOOGLE
  // GIỮ AUTH CŨ, CHỈ ĐỔI SANG POPUP
  // ==========================================

  const onGoogle = async () => {
    const width = 520;
    const height = 680;

    const left = window.screenX + (window.outerWidth - width) / 2;

    const top = window.screenY + (window.outerHeight - height) / 2;

    /*
     * Mở popup TRƯỚC await
     * để trình duyệt không chặn.
     */
    const popup = window.open(
      "about:blank",

      "joinly-google-auth",

      [
        "popup=yes",
        `width=${width}`,
        `height=${height}`,
        `left=${Math.round(left)}`,
        `top=${Math.round(top)}`,
      ].join(","),
    );

    if (!popup) {
      toast.error("Trình duyệt đang chặn cửa sổ đăng nhập. Hãy cho phép popup cho Joinly.");

      return;
    }

    popupRef.current = popup;

    setGoogleLoading(true);

    try {
      const callbackUrl = new URL("/auth/popup-callback", window.location.origin);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",

        options: {
          redirectTo: callbackUrl.toString(),

          skipBrowserRedirect: true,

          queryParams: {
            prompt: "select_account",
          },
        },
      });

      if (error) {
        throw error;
      }

      if (!data.url) {
        throw new Error("Không nhận được URL đăng nhập Google.");
      }

      popup.location.href = data.url;

      popup.focus();

      const popupWatcher = window.setInterval(() => {
        if (!popup.closed) {
          return;
        }

        window.clearInterval(popupWatcher);

        setGoogleLoading(false);
      }, 500);
    } catch (error) {
      popup.close();

      setGoogleLoading(false);

      const message = error instanceof Error ? error.message : "Đã có lỗi xảy ra";

      toast.error(`Không thể đăng nhập với Google: ${message}`);
    }
  };

  //====================================
  // Forget password
  //===================================
  const onForgotPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email.trim()) {
      toast.error("Vui lòng nhập email.");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        throw error;
      }

      toast.success("Đã gửi liên kết đặt lại mật khẩu.");

      setMode("login");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể gửi email đặt lại mật khẩu.");
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // UI
  // ==========================================

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto p-0">
        {/* HEADER */}
        <DialogHeader className="border-b border-border px-6 py-5 text-left">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" strokeWidth={2.5} />
            </span>

            <div>
              <DialogTitle className="text-xl">
                {mode === "login"
                  ? "Đăng nhập Joinly"
                  : mode === "signup"
                    ? "Tạo tài khoản Joinly"
                    : "Quên mật khẩu"}
              </DialogTitle>

              <DialogDescription className="mt-1">
                {mode === "login"
                  ? "Quản lý sự kiện của bạn trên Joinly."
                  : mode === "signup"
                    ? "Bắt đầu tổ chức sự kiện cho đơn vị của bạn."
                    : "Nhập email để nhận liên kết đặt lại mật khẩu."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6">
          {mode === "forgot" ? (
            /* =========================
             QUÊN MẬT KHẨU
          ========================= */

            <form onSubmit={onForgotPassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email">Email</Label>

                <Input
                  id="forgot-email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="ban-to-chuc@email.com"
                  autoComplete="email"
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Gửi liên kết đặt lại mật khẩu
              </Button>

              <button
                type="button"
                onClick={() => setMode("login")}
                className="w-full text-center text-sm font-medium text-primary hover:underline"
              >
                Quay lại đăng nhập
              </button>
            </form>
          ) : (
            <>
              {/* =========================
                LOGIN / SIGNUP FORM
            ========================= */}

              <form onSubmit={onSubmit} className="space-y-4">
                {/* SIGNUP EXTRA FIELDS */}
                {mode === "signup" && (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="auth-fullName">Họ và tên</Label>

                      <Input
                        id="auth-fullName"
                        required
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                        placeholder="Nguyễn Văn A"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="auth-clubName">Tên đơn vị tổ chức</Label>

                      <Input
                        id="auth-clubName"
                        required
                        value={clubName}
                        onChange={(event) => setClubName(event.target.value)}
                        placeholder="Công ty / Đơn vị ABC"
                      />
                    </div>
                  </>
                )}

                {/* EMAIL */}
                <div className="space-y-1.5">
                  <Label htmlFor="auth-email">Email</Label>

                  <Input
                    id="auth-email"
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="ban-to-chuc@email.com"
                    autoComplete="email"
                  />
                </div>

                {/* PASSWORD */}
                <div className="space-y-1.5">
                  <Label htmlFor="auth-password">Mật khẩu</Label>

                  <div className="relative">
                    <Input
                      id="auth-password"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Ít nhất 8 ký tự"
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      className="pr-10"
                    />

                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {passwordError && (
                    <p className="text-xs text-destructive">
                      Mật khẩu phải có ít nhất 8 ký tự, gồm chữ hoa, chữ thường và số.
                    </p>
                  )}
                </div>

                {/* CONFIRM PASSWORD */}
                {mode === "signup" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="auth-confirm-password">Xác nhận mật khẩu</Label>

                    <div className="relative">
                      <Input
                        id="auth-confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        required
                        minLength={8}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="Nhập lại mật khẩu"
                        autoComplete="new-password"
                        className="pr-10"
                      />

                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((value) => !value)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label={showConfirmPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    {confirmPasswordError && (
                      <p className="text-xs text-destructive">{confirmPasswordError}</p>
                    )}
                  </div>
                )}

                {/* SUBMIT */}
                <Button type="submit" className="w-full" disabled={loading || googleLoading}>
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}

                  {mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
                </Button>

                {/* FORGOT PASSWORD */}
                {mode === "login" && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setMode("forgot");
                        setPassword("");
                        setConfirmPassword("");
                        setShowPassword(false);
                        setShowConfirmPassword(false);
                      }}
                      className="text-sm text-primary hover:underline"
                    >
                      Quên mật khẩu?
                    </button>
                  </div>
                )}
              </form>

              {/* DIVIDER */}
              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />

                <span>HOẶC</span>

                <div className="h-px flex-1 bg-border" />
              </div>

              {/* GOOGLE */}
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full justify-between px-4 py-3"
                onClick={() => void onGoogle()}
                disabled={googleLoading || loading}
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
                    <GoogleIcon />
                  </span>

                  <div className="text-left">
                    <p className="font-semibold">Tiếp tục với Google</p>

                    <p className="text-xs font-normal text-muted-foreground">
                      Chọn tài khoản Google của bạn
                    </p>
                  </div>
                </div>

                {googleLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>

              {/* LOGIN <-> SIGNUP */}
              <p className="mt-6 text-center text-sm text-muted-foreground">
                {mode === "login" ? "Chưa có tài khoản?" : "Đã có tài khoản?"}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode(mode === "login" ? "signup" : "login");

                    setPassword("");
                    setConfirmPassword("");
                    setShowPassword(false);
                    setShowConfirmPassword(false);
                  }}
                  className="font-medium text-primary hover:underline"
                >
                  {mode === "login" ? "Đăng ký ngay" : "Đăng nhập"}
                </button>
              </p>

              {/* POLICY */}
              <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
                Bằng cách tiếp tục, bạn đồng ý với{" "}
                <Link
                  to="/terms"
                  onClick={() => onOpenChange(false)}
                  className="underline hover:text-foreground"
                >
                  Điều khoản sử dụng
                </Link>{" "}
                và{" "}
                <Link
                  to="/privacy"
                  onClick={() => onOpenChange(false)}
                  className="underline hover:text-foreground"
                >
                  Chính sách quyền riêng tư
                </Link>{" "}
                của Joinly.
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />

      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />

      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.93l3.66-2.84z"
      />

      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
