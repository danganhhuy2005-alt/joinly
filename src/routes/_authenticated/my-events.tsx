import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarPlus,
  Calendar,
  MapPin,
  BarChart3,
  QrCode,
  Sparkles,
  Loader2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { createDemoEventData, deleteDemoEventData } from "@/lib/demo-data.functions";
import { getEventRole, type EventRole } from "@/lib/event-role";

type EventRow = {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  starts_at: string | null;
  created_at: string;
  is_demo: boolean;

  lifecycle_status: "draft" | "active";
  requested_plan_code: string | null;
  expected_attendees: number | null;
  draft_updated_at: string | null;
};
type EventWithRole = EventRow & {
  access_role: Exclude<EventRole, null>;
};

export const Route = createFileRoute("/_authenticated/my-events")({
  head: () => ({ meta: [{ title: "Sự kiện của tôi — Joinly" }] }),
  component: MyEvents,
});

function MyEvents() {
  const [events, setEvents] = useState<EventWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [clubName, setClubName] = useState<string>("");
  const [seeding, setSeeding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const createDemo = useServerFn(createDemoEventData);
  const deleteDemo = useServerFn(deleteDemoEventData);
  const [draftToDelete, setDraftToDelete] = useState<EventWithRole | null>(null);

  const [deletingDraft, setDeletingDraft] = useState(false);

  const load = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const [{ data: ev }, { data: prof }] = await Promise.all([
      supabase.from("events").select("*").order("created_at", {
        ascending: false,
      }),

      supabase.from("profiles").select("club_name, full_name").eq("id", user.id).maybeSingle(),
    ]);

    const baseEvents = (ev as EventRow[] | null) ?? [];

    const eventsWithRole = await Promise.all(
      baseEvents.map(async (event) => {
        const eventRole = await getEventRole(event.id);

        if (!eventRole) {
          return null;
        }

        return {
          ...event,
          access_role: eventRole,
        } satisfies EventWithRole;
      }),
    );

    setEvents(eventsWithRole.filter((event): event is EventWithRole => event !== null));

    setClubName(prof?.club_name ?? prof?.full_name ?? user.email ?? "");

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const demoCount = events.filter((e) => e.is_demo).length;

  const onCreateDemo = async () => {
    setSeeding(true);
    try {
      const res = await createDemo();
      toast.success(
        `Đã tạo sự kiện demo với ${res.rooms} phòng và ${res.participants} người tham gia.`,
      );
      await load();
    } catch {
      toast.error("Không thể tạo dữ liệu demo. Vui lòng thử lại.");
    } finally {
      setSeeding(false);
    }
  };

  const onDeleteDemo = async () => {
    setDeleting(true);
    try {
      const res = await deleteDemo();
      if (res.deleted === 0) toast.info("Không có dữ liệu demo để xoá.");
      else
        toast.success(`Đã xoá ${res.deleted} sự kiện demo cùng toàn bộ phòng và người tham gia.`);
      await load();
    } catch {
      toast.error("Không thể xoá dữ liệu demo. Vui lòng thử lại.");
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  };

  const onDeleteDraft = async () => {
    if (!draftToDelete || deletingDraft) return;

    setDeletingDraft(true);

    try {
      const { error } = await supabase.rpc("delete_unpaid_event_draft", {
        p_event_id: draftToDelete.id,
      });

      if (error) throw error;

      toast.success("Đã xóa bản nháp.");
      setDraftToDelete(null);

      await load();
    } catch (error) {
      console.error("Delete draft error:", error);

      toast.error(error instanceof Error ? error.message : "Không thể xóa bản nháp.");
    } finally {
      setDeletingDraft(false);
    }
  };

  const draftEvents = events.filter(
    (event) => event.access_role === "owner" && event.lifecycle_status === "draft",
  );
  const isDraftLimitReached = draftEvents.length >= 3;

  const ownedEvents = events.filter(
    (event) => event.access_role === "owner" && event.lifecycle_status === "active",
  );

  const managedEvents = events.filter(
    (event) =>
      event.lifecycle_status === "active" &&
      (event.access_role === "co_owner" || event.access_role === "manager"),
  );

  return (
    <div className="min-h-screen bg-secondary/30">
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Sự kiện của tôi</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Quản lý tất cả sự kiện mà bạn đang tổ chức.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onCreateDemo} disabled={seeding}>
              {seeding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Tạo dữ liệu demo
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(true)}
              disabled={deleting || demoCount === 0}
              title={demoCount === 0 ? "Chưa có dữ liệu demo" : undefined}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Xoá dữ liệu demo{demoCount > 0 ? ` (${demoCount})` : ""}
            </Button>

            <Button
              asChild={!loading && !isDraftLimitReached}
              size="lg"
              disabled={loading || isDraftLimitReached}
              title={
                isDraftLimitReached ? "Bạn đã có tối đa 3 bản nháp chưa thanh toán." : undefined
              }
            >
              {loading || isDraftLimitReached ? (
                <span>
                  <CalendarPlus className="h-4 w-4" />
                  Tạo sự kiện mới
                </span>
              ) : (
                <Link to="/create-event" search={{}}>
                  <CalendarPlus className="h-4 w-4" />
                  Tạo sự kiện mới
                </Link>
              )}
            </Button>
          </div>
        </div>

        {!loading && isDraftLimitReached && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
            Bạn đã có đủ 3/3 bản nháp chưa thanh toán. Vui lòng hoàn tất thanh toán hoặc xóa một bản
            nháp để có thể tạo sự kiện mới.
          </div>
        )}

        <div className="mt-8">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : events.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-10">
              {draftEvents.length > 0 && (
                <section>
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="font-display text-xl font-semibold">
                        Bản nháp chưa thanh toán
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Các sự kiện đang chờ hoàn tất thanh toán.
                      </p>
                    </div>

                    <span className="rounded-full border px-3 py-1 text-sm">
                      {draftEvents.length} / 3
                    </span>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {draftEvents.map((event) => (
                      <div
                        key={event.id}
                        className="group rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                      >
                        <Link
                          to="/manage-event/$id"
                          params={{ id: event.id }}
                          className="block cursor-pointer"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-semibold">{event.name}</h3>

                            <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-600">
                              Bản nháp
                            </span>
                          </div>

                          <p className="mt-3 text-sm text-muted-foreground">
                            Gói:{" "}
                            <strong>
                              {event.requested_plan_code?.toUpperCase() ?? "Chưa chọn"}
                            </strong>
                          </p>

                          <p className="mt-1 text-sm text-muted-foreground">
                            Dự kiến: {event.expected_attendees ?? 0} người
                          </p>
                        </Link>

                        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDraftToDelete(event)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Xóa
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {ownedEvents.length > 0 && (
                <section>
                  <div className="mb-4">
                    <h2 className="font-display text-xl font-semibold">Sự kiện của tôi</h2>

                    <p className="text-sm text-muted-foreground">Những sự kiện bạn là Owner.</p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {ownedEvents.map((e) => (
                      <EventCard key={e.id} event={e} />
                    ))}
                  </div>
                </section>
              )}

              {managedEvents.length > 0 && (
                <section>
                  <div className="mb-4">
                    <h2 className="font-display text-xl font-semibold">Được mời quản lý</h2>

                    <p className="text-sm text-muted-foreground">
                      Những sự kiện bạn tham gia với vai trò Co-owner hoặc Manager.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {managedEvents.map((e) => (
                      <EventCard key={e.id} event={e} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </main>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá toàn bộ dữ liệu demo?</AlertDialogTitle>
            <AlertDialogDescription>
              Thao tác này sẽ xoá {demoCount} sự kiện demo cùng toàn bộ phòng và người tham gia được
              tạo tự động. Dữ liệu thật của bạn sẽ KHÔNG bị ảnh hưởng. Hành động này không thể hoàn
              tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={onDeleteDemo} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />} Xoá dữ liệu demo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(draftToDelete)}
        onOpenChange={(open) => {
          if (!open && !deletingDraft) {
            setDraftToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa bản nháp?</AlertDialogTitle>

            <AlertDialogDescription>
              Bạn đang xóa bản nháp "{draftToDelete?.name}". Các mã thanh toán đang chờ sẽ bị hủy.
              Nếu đã chuyển khoản, không tiếp tục xóa mà hãy chờ hệ thống xác nhận giao dịch.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingDraft}>Quay lại</AlertDialogCancel>

            <AlertDialogAction
              disabled={deletingDraft}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void onDeleteDraft();
              }}
            >
              {deletingDraft && <Loader2 className="h-4 w-4 animate-spin" />}
              Xác nhận xóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
      <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <CalendarPlus className="h-7 w-7" />
      </div>
      <h3 className="mt-4 font-display text-xl font-semibold">Chưa có sự kiện nào</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Tạo sự kiện đầu tiên để bắt đầu quản lý người tham gia.
      </p>
      <Button asChild className="mt-6">
        <Link to="/create-event">
          <CalendarPlus className="h-4 w-4" /> Tạo sự kiện mới
        </Link>
      </Button>
    </div>
  );
}

function EventCard({ event }: { event: EventWithRole }) {
  const date = event.starts_at ? new Date(event.starts_at) : null;
  const roleLabel =
    event.access_role === "owner"
      ? "Owner"
      : event.access_role === "co_owner"
        ? "Co-owner"
        : "Manager";
  return (
    <Link
      to="/manage-event/$id"
      params={{ id: event.id }}
      className="group block cursor-pointer rounded-2xl border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg font-semibold leading-tight">{event.name}</h3>

        <span className="shrink-0 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium">
          {roleLabel}
        </span>
      </div>
      {event.description && (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{event.description}</p>
      )}
      <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
        {date && (
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {date.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}
          </div>
        )}
        {event.location && (
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4" /> {event.location}
          </div>
        )}
      </div>
    </Link>
  );
}
