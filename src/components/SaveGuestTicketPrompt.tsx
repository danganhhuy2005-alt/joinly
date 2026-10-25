import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BookmarkCheck, ShieldCheck, Ticket, X } from "lucide-react";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { setWorkspaceMode } from "@/lib/workspace-mode";

/**
 * Purely optional upgrade from guest to signed-in participant.
 * The existing get_my_participations RPC matches a verified account email
 * to the original registration on the server; no ticket ownership is written
 * or transferred from an unverified client-side email here.
 */
export function SaveGuestTicketPrompt() {
  const { user, loading } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // GoogleSignInButton's GIS widget needs the browser DOM to render.
  if (!mounted || loading || dismissed) return null;

  if (user) {
    return (
      <section className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4" aria-label="Vé trong tài khoản Joinly">
        <div className="flex items-start gap-3">
          <BookmarkCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Quản lý vé bằng tài khoản Joinly</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Vé đăng ký bằng email trùng với email đã xác minh của tài khoản sẽ xuất hiện trong Vé của tôi.
              Nếu email khác, hãy tiếp tục sử dụng liên kết vé hoặc PDF này.
            </p>
            <Link to="/my-participations" className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
              <Ticket className="h-4 w-4" /> Mở Vé của tôi
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5" aria-label="Tùy chọn lưu vé vào Joinly">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Ticket className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Lưu vé vào tài khoản Joinly</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Đăng nhập Google để dễ tìm lại vé và quản lý các sự kiện bạn tham gia.
              Hoàn toàn không bắt buộc.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => setDismissed(true)} className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Đóng lời mời đăng nhập">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 rounded-lg bg-background px-2 py-3 sm:px-4">
        <GoogleSignInButton onSuccess={() => {
          // The user chose to sign in from a ticket: open the participant workspace.
          void (async () => {
            try {
              const { data } = await supabase.auth.getUser();
              if (data.user) setWorkspaceMode(data.user.id, "participant");
            } catch {
              // The tickets page rechecks the session and verified email.
            } finally {
              window.location.assign("/my-participations");
            }
          })();
        }} />
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Chỉ vé có email đăng ký trùng email tài khoản đã xác minh mới hiện trong tài khoản.
      </p>
      <button type="button" onClick={() => setDismissed(true)} className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary">
        Tiếp tục là khách — giữ nguyên vé này
      </button>
    </section>
  );
}
