import { useEffect, useRef, useState, type FormEvent } from "react";

import { Link } from "@tanstack/react-router";

import { Loader2, Eye, EyeOff, Sparkles } from "lucide-react";

import { toast } from "sonner";

import { GoogleSignInButton } from "@/components/GoogleSignInButton";

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
              <GoogleSignInButton
                disabled={loading}
                onSuccess={() => {
                  onOpenChange(false);
                  window.location.href = safeNextPath;
                }}
              />

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
