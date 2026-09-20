import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Quên mật khẩu — Joinly" },
      { name: "description", content: "Đặt lại mật khẩu tài khoản ban tổ chức Joinly." },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
      toast.success("Đã gửi email khôi phục mật khẩu");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không thể gửi email");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Về đăng nhập
        </Link>
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" strokeWidth={2.5} />
            </span>
            <span className="font-display text-xl font-bold">Joinly</span>
          </div>
          <h1 className="mt-6 font-display text-2xl font-bold">Quên mật khẩu</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Nhập email của bạn, chúng tôi sẽ gửi liên kết để đặt lại mật khẩu.
          </p>

          {sent ? (
            <div className="mt-6 rounded-lg border border-border bg-secondary/40 p-4 text-sm">
              Nếu email <span className="font-medium">{email}</span> tồn tại, bạn sẽ nhận được email hướng dẫn đặt lại mật khẩu trong vài phút.
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ban-to-chuc@email.com" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Gửi liên kết đặt lại
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
