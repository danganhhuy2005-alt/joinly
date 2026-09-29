import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Shield, UserPlus, Check, X, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getEventRole, type EventRole } from "@/lib/event-role";

export const Route = createFileRoute("/_authenticated/dashboard_/$id/members")({
  head: () => ({
    meta: [
      {
        title: "Đội ngũ quản lý — Joinly",
      },
    ],
  }),
  component: EventMembersPage,
});

type MemberRow = {
  member_id: string | null;
  user_id: string;
  email: string;
  role: string;
  status: string;
  invited_by: string | null;
  created_at: string;
};

type EventRow = {
  id: string;
  name: string;
};

function EventMembersPage() {
  const { id } = useParams({
    from: "/_authenticated/dashboard_/$id/members",
  });

  const [event, setEvent] = useState<EventRow | null>(null);

  const [role, setRole] = useState<EventRole>(null);

  const [members, setMembers] = useState<MemberRow[]>([]);

  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState("");

  const [inviteRole, setInviteRole] = useState<"manager" | "co_owner">("manager");

  const [inviting, setInviting] = useState(false);
  const [processingMemberId, setProcessingMemberId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const currentRole = await getEventRole(id);

    setRole(currentRole);

    if (currentRole !== "owner" && currentRole !== "co_owner") {
      setLoading(false);
      return;
    }

    const [{ data: eventData, error: eventError }, { data: memberData, error: memberError }] =
      await Promise.all([
        supabase.from("events").select("id, name").eq("id", id).maybeSingle(),

        supabase.rpc("list_event_members", {
          _event_id: id,
        }),
      ]);

    if (eventError) {
      console.error("Load event error:", eventError);
    }

    if (memberError) {
      console.error("Load members error:", memberError);

      toast.error("Không thể tải danh sách thành viên.");
    }

    setEvent(eventData as EventRow | null);

    setMembers((memberData as MemberRow[] | null) ?? []);

    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const inviteMember = async () => {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      toast.error("Hãy nhập email tài khoản Joinly.");
      return;
    }

    setInviting(true);

    const { data, error } = await supabase.rpc("invite_event_member", {
      _event_id: id,
      _email: normalizedEmail,
      _role: inviteRole,
    });

    setInviting(false);

    if (error) {
      console.error("Invite member error:", error);

      toast.error(error.message || "Không thể thêm thành viên.");

      return;
    }

    console.log("Invite result:", data);

    setEmail("");

    if (inviteRole === "co_owner" && role === "co_owner") {
      toast.success("Đã gửi yêu cầu thêm Co-owner. Owner cần duyệt trước khi có hiệu lực.");
    } else {
      toast.success(inviteRole === "manager" ? "Đã thêm Manager." : "Đã thêm Co-owner.");
    }

    await load();
  };
  const approveCoOwner = async (memberId: string) => {
    setProcessingMemberId(memberId);

    const { error } = await supabase.rpc("approve_coowner_request", {
      _event_id: id,
      _member_id: memberId,
    });

    setProcessingMemberId(null);

    if (error) {
      console.error("Approve Co-owner error:", error);

      toast.error(error.message || "Không thể duyệt Co-owner.");

      return;
    }

    toast.success("Đã duyệt Co-owner.");

    await load();
  };

  const rejectCoOwner = async (memberId: string) => {
    setProcessingMemberId(memberId);

    const { error } = await supabase.rpc("reject_coowner_request", {
      _event_id: id,
      _member_id: memberId,
    });

    setProcessingMemberId(null);

    if (error) {
      console.error("Reject Co-owner error:", error);

      toast.error(error.message || "Không thể từ chối Co-owner.");

      return;
    }

    toast.success("Đã từ chối yêu cầu Co-owner.");

    await load();
  };

  const removeMember = async (memberId: string, memberEmail: string) => {
    const confirmed = window.confirm(
      `Bạn có chắc muốn xóa ${memberEmail} khỏi đội quản lý sự kiện không?`,
    );

    if (!confirmed) return;

    setProcessingMemberId(memberId);

    const { error } = await supabase.rpc("remove_event_member", {
      _event_id: id,
      _member_id: memberId,
    });

    setProcessingMemberId(null);

    if (error) {
      console.error("Remove member error:", error);

      toast.error(error.message || "Không thể xóa thành viên.");

      return;
    }

    toast.success("Đã xóa thành viên khỏi sự kiện.");

    await load();
  };

  const changeMemberRole = async (
    memberId: string,
    currentRole: string,
    newRole: "manager" | "co_owner",
  ) => {
    if (currentRole === newRole) return;

    const currentLabel = currentRole === "co_owner" ? "Co-owner" : "Manager";

    const newLabel = newRole === "co_owner" ? "Co-owner" : "Manager";

    const confirmed = window.confirm(`Đổi vai trò từ ${currentLabel} thành ${newLabel}?`);

    if (!confirmed) return;

    setProcessingMemberId(memberId);

    const { error } = await supabase.rpc("change_event_member_role", {
      _event_id: id,
      _member_id: memberId,
      _new_role: newRole,
    });

    setProcessingMemberId(null);

    if (error) {
      console.error("Change member role error:", error);

      toast.error(error.message || "Không thể thay đổi vai trò.");

      return;
    }

    toast.success(`Đã đổi thành ${newLabel}.`);

    await load();
  };
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (role !== "owner" && role !== "co_owner") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="font-display text-xl font-semibold">
            Bạn không có quyền quản lý thành viên
          </h1>

          <Button variant="outline" asChild className="mt-4">
            <Link to="/manage-event/$id" params={{ id }}>
              <ArrowLeft className="h-4 w-4" />
              Quay lại sự kiện
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex min-h-screen items-center justify-center">Không tìm thấy sự kiện.</div>
    );
  }

  return (
    <div className="min-h-screen bg-secondary/30 px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/manage-event/$id"
          params={{ id }}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Quay lại sự kiện
        </Link>

        <div className="mt-6">
          <h1 className="font-display text-3xl font-bold">Đội ngũ quản lý</h1>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">{event.name}</p>

            <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium">
              {role === "owner" ? "Owner" : "Co-owner"}
            </span>
          </div>
        </div>

        {/* FORM MỜI */}
        <div className="mt-6 rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />

            <h2 className="font-display text-lg font-semibold">Thêm thành viên trong đội ngũ</h2>
          </div>

          <p className="mt-2 text-sm text-muted-foreground">
            Chỉ có thể thêm người đã có tài khoản Joinly.
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_220px_auto]">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email tài khoản Joinly"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            />

            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "manager" | "co_owner")}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="manager">Manager</option>

              <option value="co_owner">Co-owner</option>
            </select>

            <Button onClick={inviteMember} disabled={inviting}>
              {inviting && <Loader2 className="h-4 w-4 animate-spin" />}
              Thêm thành viên
            </Button>
          </div>

          {role === "co_owner" && (
            <p className="mt-3 text-xs text-muted-foreground">
              Co-owner có thể thêm Manager trực tiếp. Nếu mời Co-owner khác, Owner phải duyệt trước
              khi lời mời có hiệu lực.
            </p>
          )}
        </div>

        {/* DANH SÁCH */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />

              <h2 className="font-display text-lg font-semibold">Thành viên trong đội ngũ</h2>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 font-medium">Email</th>

                  <th className="px-6 py-3 font-medium">Vai trò</th>

                  <th className="px-6 py-3 font-medium">Trạng thái</th>

                  <th className="px-6 py-3" />
                </tr>
              </thead>

              <tbody>
                {members.map((member) => (
                  <tr key={member.member_id ?? member.user_id} className="border-t border-border">
                    <td className="px-6 py-4 font-medium">{member.email}</td>

                    <td className="px-6 py-4">
                      {role === "owner" &&
                      member.role !== "owner" &&
                      member.status === "active" &&
                      member.member_id ? (
                        <select
                          value={member.role}
                          disabled={processingMemberId === member.member_id}
                          onChange={(e) =>
                            changeMemberRole(
                              member.member_id!,
                              member.role,
                              e.target.value as "manager" | "co_owner",
                            )
                          }
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="manager">Manager</option>

                          <option value="co_owner">Co-owner</option>
                        </select>
                      ) : (
                        <span>
                          {member.role === "owner"
                            ? "Owner"
                            : member.role === "co_owner"
                              ? "Co-owner"
                              : "Manager"}
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      {member.status === "pending" ? "Chờ duyệt" : "Đang hoạt động"}
                    </td>

                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {/* Owner duyệt / từ chối Co-owner pending */}
                        {role === "owner" &&
                          member.role === "co_owner" &&
                          member.status === "pending" &&
                          member.member_id && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => approveCoOwner(member.member_id!)}
                                disabled={processingMemberId === member.member_id}
                              >
                                <Check className="h-4 w-4" />
                                Duyệt
                              </Button>

                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => rejectCoOwner(member.member_id!)}
                                disabled={processingMemberId === member.member_id}
                              >
                                <X className="h-4 w-4" />
                                Từ chối
                              </Button>
                            </>
                          )}

                        {/* Owner kick Manager hoặc Co-owner active */}
                        {role === "owner" &&
                          member.role !== "owner" &&
                          member.status === "active" &&
                          member.member_id && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => removeMember(member.member_id!, member.email)}
                              disabled={processingMemberId === member.member_id}
                            >
                              <Trash2 className="h-4 w-4" />
                              Kick
                            </Button>
                          )}

                        {/* Co-owner chỉ được kick Manager */}
                        {role === "co_owner" &&
                          member.role === "manager" &&
                          member.status === "active" &&
                          member.member_id && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => removeMember(member.member_id!, member.email)}
                              disabled={processingMemberId === member.member_id}
                            >
                              <Trash2 className="h-4 w-4" />
                              Kick
                            </Button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
