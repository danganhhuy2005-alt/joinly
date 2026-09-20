import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Đặt lại mật khẩu — Joinly" },
      { name: "description", content: "Đặt lại mật khẩu mới cho tài khoản Joinly." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Supabase emits a PASSWORD_RECOVERY event after parsing the recovery token in the URL.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Mật khẩu tối thiểu 6 ký tự");
      return;
    }
    if (password !== confirm) {
      toast.error("Mật khẩu xác nhận không khớp");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Đặt lại mật khẩu thành công!");
      navigate({ to: "/my-events" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không thể đặt lại mật khẩu");
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
          <h1 className="mt-6 font-display text-2xl font-bold">Đặt lại mật khẩu</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ready
              ? "Nhập mật khẩu mới cho tài khoản của bạn."
              : "Đang xác minh liên kết khôi phục..."}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">Mật khẩu mới</Label>
              <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Ít nhất 6 ký tự" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Xác nhận mật khẩu</Label>
              <Input id="confirm" type="password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading || !ready}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Cập nhật mật khẩu
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
