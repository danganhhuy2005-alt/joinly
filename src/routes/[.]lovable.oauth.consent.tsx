import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type OAuthClient = { name?: string; client_name?: string; redirect_uri?: string };
type AuthorizationDetails = {
  client?: OAuthClient;
  scope?: string;
  scopes?: string[];
  redirect_url?: string;
  redirect_to?: string;
};

type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
};

function oauth(): OAuthNamespace {
  return (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/login", search: { next } });
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="flex min-h-screen items-center justify-center bg-secondary/40 px-4">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="font-display text-xl font-bold text-foreground">Không thể tải yêu cầu ủy quyền</h1>
        <p className="mt-2 text-sm text-muted-foreground">{String((error as Error)?.message ?? error)}</p>
      </div>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState<null | "approve" | "deny">(null);
  const [error, setError] = useState<string | null>(null);

  const clientName = details?.client?.client_name ?? details?.client?.name ?? "ứng dụng bên ngoài";

  async function decide(approve: boolean) {
    setBusy(approve ? "approve" : "deny");
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) {
      setBusy(null);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(null);
      setError("Máy chủ ủy quyền không trả về địa chỉ chuyển hướng.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary/40 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" strokeWidth={2.5} />
          </span>
          <span className="font-display text-xl font-bold">Joinly</span>
        </div>
        <h1 className="mt-6 font-display text-2xl font-bold text-foreground">
          Kết nối {clientName} với tài khoản Joinly
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {clientName} sẽ có thể gọi các công cụ Joinly được bật (danh sách sự kiện, chi tiết sự kiện, danh sách người
          tham gia) thay mặt bạn khi bạn đang đăng nhập.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Việc này không vượt qua các quyền hoặc chính sách của Joinly — mọi truy cập dữ liệu vẫn được giới hạn ở các sự
          kiện bạn tổ chức.
        </p>

        {error && (
          <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <Button onClick={() => decide(true)} disabled={busy !== null} className="w-full">
            {busy === "approve" && <Loader2 className="h-4 w-4 animate-spin" />}
            Cho phép kết nối
          </Button>
          <Button
            variant="outline"
            onClick={() => decide(false)}
            disabled={busy !== null}
            className="w-full"
          >
            {busy === "deny" && <Loader2 className="h-4 w-4 animate-spin" />}
            Từ chối
          </Button>
        </div>
      </div>
    </main>
  );
}
