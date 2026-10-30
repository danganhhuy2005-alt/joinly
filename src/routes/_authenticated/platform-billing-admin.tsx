import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft, CalendarDays, CheckCircle2, Clock3, CreditCard,
  Loader2, RefreshCw, Search, ShieldCheck, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { isPlatformAdmin, platformDb } from "@/lib/platform-support";

export const Route = createFileRoute("/_authenticated/platform-billing-admin")({
  head: () => ({ meta: [{ title: "Thanh toán — Joinly Admin" }] }),
  component: PlatformBillingAdmin,
});

type Tab = "buyers" | "payments" | "monthly" | "events";
type Summary = {
  paid_revenue_vnd: number;
  monthly_revenue_vnd: number;
  paid_orders: number;
  pending_orders: number;
  refunded_orders: number;
  paid_buyers: number;
  active_monthly: number;
};
type Breakdown = { plan_code: string; paid_orders: number; revenue_vnd: number };
type CommonRow = { id: string; buyer_email: string | null; buyer_name: string; created_at: string };
type PaymentRow = CommonRow & {
  order_code: string; plan_code: string; plan_name: string | null;
  billing_type: string | null; event_name: string | null; amount_vnd: number;
  status: string; paid_at: string | null; expires_at: string | null;
  bank_gateway: string | null; sepay_reference_code: string | null;
};
type MonthlyRow = CommonRow & {
  starts_at: string; expires_at: string; effective_status: string;
  event_limit: number; events_used: number; amount_vnd: number | null;
  payment_status: string | null; order_code: string | null;
};
type PaidBuyerRow = {
  user_id: string;
  buyer_email: string | null;
  buyer_name: string;
  paid_orders: number;
  monthly_orders: number;
  event_orders: number;
  plan_codes: string[];
  total_spent_vnd: number;
  last_paid_at: string | null;
};
type EventRow = CommonRow & {
  event_name: string; plan_code: string; attendee_limit: number;
  lifecycle_status: string; requested_plan_code: string | null; used_monthly: boolean;
};
type DashboardData = {
  summary: Summary;
  plan_breakdown: Breakdown[];
  rows: Array<PaidBuyerRow | PaymentRow | MonthlyRow | EventRow>;
  total_count: number;
};

const PAGE_SIZE = 25;
const money = (n: number | null | undefined) => `${new Intl.NumberFormat("vi-VN").format(Number(n ?? 0))} đ`;
const dateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "—";
const PLAN_NAMES: Record<string, string> = {
  free: "Free", small: "Small", standard: "Standard", pro: "Pro", monthly: "Monthly",
};
const STATUS_NAMES: Record<string, string> = {
  paid: "Đã thanh toán", pending: "Chờ thanh toán", expired: "Hết hạn",
  cancelled: "Đã hủy", refunded: "Đã hoàn tiền", active: "Đang hiệu lực",
  scheduled: "Sắp có hiệu lực", draft: "Bản nháp", ended: "Đã kết thúc",
};
const STATUS_STYLES: Record<string, string> = {
  paid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  scheduled: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  refunded: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  cancelled: "bg-muted text-muted-foreground", expired: "bg-muted text-muted-foreground",
};
function Status({ value }: { value: string }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[value] ?? "bg-secondary text-secondary-foreground"}`}>
    {STATUS_NAMES[value] ?? value}
  </span>;
}
function StatCard({ label, value, description, icon: Icon }: { label: string; value: string; description?: string; icon: typeof CreditCard }) {
  return <div className="rounded-2xl border bg-card p-4 sm:p-5">
    <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>{label}</span><Icon className="h-4 w-4" /></div>
    <p className="mt-2 break-words text-xl font-bold sm:text-2xl">{value}</p>
    {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
  </div>;
}
function Buyer({ name, email }: { name: string; email: string | null }) {
  return <div className="min-w-[190px]"><p className="font-medium">{name}</p><p className="break-all text-xs text-muted-foreground">{email ?? "Chưa có email"}</p></div>;
}

function PlatformBillingAdmin() {
  const [tab, setTab] = useState<Tab>("buyers");
  const [status, setStatus] = useState("all");
  const [plan, setPlan] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const resetPage = (nextTab: Tab) => { setTab(nextTab); setStatus("all"); setPlan("all"); setPage(1); };
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setData(null);
    void (async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (!active) return;
        if (authError || !user) { setAllowed(false); return; }
        const verified = await isPlatformAdmin(user.id);
        if (!active) return;
        setAllowed(verified);
        if (!verified) return;
        if (tab === "buyers") {
          // The buyers list is one row per account (paid payments only).
          // Keep the existing, audited payment summary RPC unchanged.
          const [buyersResponse, overviewResponse] = await Promise.all([
            platformDb.rpc("admin_get_paid_buyers", {
              p_limit: PAGE_SIZE,
              p_offset: (page - 1) * PAGE_SIZE,
              p_plan: plan === "all" ? null : plan,
              p_search: search.trim() || null,
            }),
            platformDb.rpc("admin_get_billing_dashboard", {
              p_tab: "payments",
              p_limit: 1,
              p_offset: 0,
              p_status: null,
              p_plan: null,
              p_search: null,
            }),
          ]);
          if (buyersResponse.error) throw new Error(buyersResponse.error.message);
          if (overviewResponse.error) throw new Error(overviewResponse.error.message);
          const buyersData = buyersResponse.data as { rows: PaidBuyerRow[]; total_count: number };
          const overviewData = overviewResponse.data as DashboardData;
          if (active) setData({
            rows: buyersData.rows ?? [],
            total_count: buyersData.total_count ?? 0,
            summary: overviewData.summary,
            plan_breakdown: overviewData.plan_breakdown ?? [],
          });
        } else {
          const { data: result, error: rpcError } = await platformDb.rpc("admin_get_billing_dashboard", {
            p_tab: tab,
            p_limit: PAGE_SIZE,
            p_offset: (page - 1) * PAGE_SIZE,
            p_status: status === "all" ? null : status,
            p_plan: plan === "all" ? null : plan,
            p_search: search.trim() || null,
          });
          if (rpcError) throw new Error(rpcError.message);
          if (active) setData(result as DashboardData);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Không tải được dữ liệu thanh toán.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [tab, status, plan, search, page, reloadKey]);

  const rows = data?.rows ?? [];
  const count = Number(data?.total_count ?? 0);
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const summary = data?.summary;
  const breakdown = useMemo(() => data?.plan_breakdown ?? [], [data]);
  const selectClass = "h-10 rounded-lg border border-input bg-background px-3 text-sm";

  if (allowed === false) return <main className="mx-auto max-w-2xl space-y-3 p-6 sm:p-10">
    <ShieldCheck className="h-8 w-8 text-muted-foreground" />
    <h1 className="text-xl font-bold">Chỉ dành cho Admin Joinly</h1>
    <p className="text-muted-foreground">Bạn không có quyền xem các khoản thanh toán của tài khoản khác. Quyền được kiểm tra ngay tại Supabase.</p>
    <Button asChild variant="outline"><Link to="/my-events">Quay lại Sự kiện của tôi</Link></Button>
  </main>;

  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button asChild variant="ghost"><Link to="/my-events"><ArrowLeft className="mr-2 h-4 w-4" />Sự kiện của tôi</Link></Button>
      <Button variant="outline" disabled={loading} onClick={() => setReloadKey(k => k + 1)}>
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Làm mới
      </Button>
    </div>
    <div>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><ShieldCheck className="h-4 w-4" /> Joinly Admin</div>
      <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Khách hàng &amp; Thanh toán</h1>
      <p className="mt-1 text-sm text-muted-foreground">Danh sách những tài khoản đã mua gói Joinly, lịch sử thanh toán SePay, gói Monthly và quản lý sự kiện. Chỉ Admin được xem.</p>
    </div>

    {error && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
      {error} <p className="mt-1 text-xs">Kiểm tra đã chạy migration Dashboard Thanh toán và tài khoản có quyền trong joinly_platform_admins.</p>
    </div>}

    {summary && <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={CreditCard} label="Doanh thu đơn đã thanh toán" value={money(summary.paid_revenue_vnd)} description="Chỉ cộng status = paid" />
        <StatCard icon={CheckCircle2} label="Đơn thành công" value={String(summary.paid_orders)} description={`${summary.paid_buyers} tài khoản đã mua`} />
        <StatCard icon={Clock3} label="Đơn đang chờ" value={String(summary.pending_orders)} description="Không cộng vào doanh thu" />
        <StatCard icon={Users} label="Monthly đang hiệu lực" value={String(summary.active_monthly)} description={`Doanh thu Monthly: ${money(summary.monthly_revenue_vnd)}`} />
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {breakdown.map(item => <span key={item.plan_code} className="rounded-lg border px-3 py-2">
          <strong className="text-foreground">{PLAN_NAMES[item.plan_code] ?? item.plan_code}</strong> · {item.paid_orders} đơn · {money(item.revenue_vnd)}
        </span>)}
        <span className="rounded-lg border px-3 py-2">Đã hoàn tiền: {summary.refunded_orders} đơn</span>
      </div>
    </>}

    <div className="rounded-2xl border bg-card p-3 sm:p-5">
      <div className="flex flex-wrap gap-2">
        {([
          ["buyers", "Người đã thanh toán"], ["payments", "Giao dịch SePay"], ["monthly", "Gói Monthly"], ["events", "Quản lý sự kiện"],
        ] as Array<[Tab, string]>).map(([key, label]) => <Button key={key} size="sm" variant={tab === key ? "default" : "outline"} onClick={() => resetPage(key)}>{label}</Button>)}
      </div>
      {tab === "buyers" && <p className="mt-3 text-sm text-muted-foreground">Mỗi tài khoản xuất hiện một lần. Chỉ tính các đơn SePay có trạng thái <strong>Đã thanh toán</strong>; gói Free và đơn chờ không nằm trong danh sách này.</p>}
      <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(searchInput); }}>
        <Input aria-label="Tìm kiếm" className="min-w-[190px] flex-1" placeholder={tab === "buyers" ? "Tìm tên hoặc email người đã mua..." : "Email, mã đơn hoặc tên sự kiện..."} value={searchInput} onChange={e => setSearchInput(e.target.value)} />
        <Button type="submit" variant="outline"><Search className="mr-2 h-4 w-4" />Tìm</Button>
        {tab !== "buyers" && <select aria-label="Lọc trạng thái" className={selectClass} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="all">Mọi trạng thái</option>
          {(tab === "payments" ? ["paid", "pending", "expired", "cancelled", "refunded"] : tab === "monthly" ? ["active", "scheduled", "expired", "cancelled"] : ["active", "draft"]).map(s => <option key={s} value={s}>{STATUS_NAMES[s] ?? s}</option>)}
        </select>}
        {tab !== "monthly" && <select aria-label="Lọc gói" className={selectClass} value={plan} onChange={e => { setPlan(e.target.value); setPage(1); }}>
          <option value="all">Tất cả gói</option>
          {(tab === "events" ? ["free", "small", "standard", "pro", "monthly"] : ["small", "standard", "pro", "monthly"]).map(s => <option key={s} value={s}>{PLAN_NAMES[s]}</option>)}
        </select>}
      </form>
      <div className="mt-4 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[840px] border-collapse text-left text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            {tab === "buyers" ? <tr><th className="p-3">Người đã thanh toán</th><th className="p-3">Các gói đã mua</th><th className="p-3">Số đơn</th><th className="p-3">Tổng tiền đã trả</th><th className="p-3">Thanh toán gần nhất</th></tr>
              : tab === "payments" ? <tr><th className="p-3">Người mua</th><th className="p-3">Đơn / Sự kiện</th><th className="p-3">Gói</th><th className="p-3">Số tiền</th><th className="p-3">Trạng thái</th><th className="p-3">Thanh toán lúc</th></tr>
              : tab === "monthly" ? <tr><th className="p-3">Người mua</th><th className="p-3">Đơn Monthly</th><th className="p-3">Bắt đầu</th><th className="p-3">Hết hạn</th><th className="p-3">Đã dùng</th><th className="p-3">Trạng thái</th></tr>
              : <tr><th className="p-3">Người tổ chức</th><th className="p-3">Sự kiện</th><th className="p-3">Gói / nguồn cấp</th><th className="p-3">Giới hạn</th><th className="p-3">Trạng thái</th><th className="p-3">Ngày tạo</th></tr>}
          </thead>
          <tbody className="divide-y divide-border">
            {tab === "buyers" && (rows as PaidBuyerRow[]).map(item => <tr key={item.user_id} className="align-top hover:bg-muted/20">
              <td className="p-3"><Buyer name={item.buyer_name} email={item.buyer_email}/></td>
              <td className="p-3"><div className="flex max-w-72 flex-wrap gap-1">{item.plan_codes.map(code => <span key={code} className="rounded-md border px-2 py-1 text-xs">{PLAN_NAMES[code] ?? code}</span>)}</div></td>
              <td className="p-3"><strong>{item.paid_orders}</strong><p className="mt-1 text-xs text-muted-foreground">Monthly: {item.monthly_orders} · Gói sự kiện: {item.event_orders}</p></td>
              <td className="whitespace-nowrap p-3 font-semibold">{money(item.total_spent_vnd)}</td>
              <td className="whitespace-nowrap p-3">{dateTime(item.last_paid_at)}</td>
            </tr>)}
            {tab === "payments" && (rows as PaymentRow[]).map(item => <tr key={item.id} className="align-top hover:bg-muted/20">
              <td className="p-3"><Buyer name={item.buyer_name} email={item.buyer_email}/></td>
              <td className="p-3"><p className="font-mono text-xs font-semibold">{item.order_code}</p><p className="mt-1 max-w-64 truncate text-xs text-muted-foreground" title={item.event_name ?? ""}>{item.event_name ?? (item.billing_type === "monthly" ? "Gói Monthly theo tài khoản" : "Sự kiện đã xóa")}</p></td>
              <td className="p-3">{PLAN_NAMES[item.plan_code] ?? item.plan_name ?? item.plan_code}</td>
              <td className="whitespace-nowrap p-3 font-semibold">{money(item.amount_vnd)}</td>
              <td className="p-3"><Status value={item.status}/></td>
              <td className="whitespace-nowrap p-3">{dateTime(item.paid_at)}<p className="mt-1 text-xs text-muted-foreground">Tạo: {dateTime(item.created_at)}</p></td>
            </tr>)}
            {tab === "monthly" && (rows as MonthlyRow[]).map(item => <tr key={item.id} className="align-top hover:bg-muted/20">
              <td className="p-3"><Buyer name={item.buyer_name} email={item.buyer_email}/></td>
              <td className="p-3"><p className="font-mono text-xs">{item.order_code ?? "—"}</p><p className="mt-1 font-semibold">{money(item.amount_vnd)}</p></td>
              <td className="whitespace-nowrap p-3">{dateTime(item.starts_at)}</td>
              <td className="whitespace-nowrap p-3">{dateTime(item.expires_at)}</td>
              <td className="p-3">{item.events_used}/{item.event_limit} sự kiện</td>
              <td className="p-3"><Status value={item.effective_status}/></td>
            </tr>)}
            {tab === "events" && (rows as EventRow[]).map(item => <tr key={item.id} className="align-top hover:bg-muted/20">
              <td className="p-3"><Buyer name={item.buyer_name} email={item.buyer_email}/></td>
              <td className="p-3"><p className="max-w-64 truncate font-medium" title={item.event_name}>{item.event_name}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{item.id.slice(0,8)}</p></td>
              <td className="p-3"><span className="font-medium">{item.used_monthly ? "Monthly (đã sử dụng)" : PLAN_NAMES[item.plan_code] ?? item.plan_code}</span>{item.requested_plan_code && item.lifecycle_status === "draft" && <p className="text-xs text-muted-foreground">Đang chờ: {PLAN_NAMES[item.requested_plan_code] ?? item.requested_plan_code}</p>}</td>
              <td className="p-3">{item.attendee_limit} người</td>
              <td className="p-3">{item.lifecycle_status === "active" ? <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-300">Đã kích hoạt</span> : <Status value={item.lifecycle_status}/>}</td>
              <td className="whitespace-nowrap p-3">{dateTime(item.created_at)}</td>
            </tr>)}
          </tbody>
        </table>
        {loading && <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Đang tải dữ liệu...</p>}
        {!loading && rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Không có dữ liệu phù hợp.</p>}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{count ? `Hiển thị ${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE, count)} / ${count} bản ghi` : "0 bản ghi"}</p>
        <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page<=1 || loading} onClick={()=>setPage(p=>p-1)}>Trước</Button><span className="text-sm">{page}/{totalPages}</span><Button size="sm" variant="outline" disabled={page>=totalPages || loading} onClick={()=>setPage(p=>p+1)}>Sau</Button></div>
      </div>
    </div>
    <p className="flex items-start gap-2 text-xs text-muted-foreground"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0"/>Doanh thu tính theo các đơn có trạng thái <strong>paid</strong> trong Supabase, không phải báo cáo đối soát ngân hàng. Đơn pending, cancelled, expired hoặc refunded không cộng vào doanh thu. Gói Free không phải đơn mua.</p>
  </main>;
}
