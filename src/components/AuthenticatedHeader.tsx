import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { Check, LogOut, User, Crown, CalendarCog, Ticket, Compass, Star, Bug, ShieldCheck, WalletCards } from "lucide-react";
import { AppLogo } from "@/components/AppLogo";

import { toast } from "sonner";

import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { supabase } from "@/integrations/supabase/client";

import { clearAuthSessionStartedAt } from "@/lib/auth-session";
import { getWorkspaceMode, setWorkspaceMode, workspaceHome, type WorkspaceMode } from "@/lib/workspace-mode";
import { isPlatformAdmin } from "@/lib/platform-support";

export function AuthenticatedHeader() {
  const navigate = useNavigate();
  const location = useLocation();

  const [displayName, setDisplayName] = useState("Tài khoản");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [accountId, setAccountId] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceMode>("organizer");
  const [platformAdmin, setPlatformAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || cancelled) {
        return;
      }

      setAccountId(user.id);
      setWorkspace(getWorkspaceMode(user.id));
      void isPlatformAdmin(user.id).then(allowed => { if (!cancelled) setPlatformAdmin(allowed); });

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, club_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      if (cancelled) {
        return;
      }

      setDisplayName(
        profile?.club_name ??
          profile?.full_name ??
          user.user_metadata?.full_name ??
          user.email ??
          "Tài khoản",
      );
      setAvatarUrl(profile?.avatar_url ?? "");
    };

    void loadUser();

    return () => {
      cancelled = true;
    };
  }, []);

  // Direct links to either homepage must keep the avatar menu in sync.
  useEffect(() => {
    if (!accountId) return;
    if (location.pathname === "/my-events" || location.pathname === "/my-participations") {
      const routeMode = location.pathname === "/my-participations" ? "participant" : "organizer";
      setWorkspace(routeMode);
      setWorkspaceMode(accountId, routeMode);
    }
  }, [accountId, location.pathname]);

  useEffect(() => {
    const handleProfileUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{
        fullName?: string;
        avatarUrl?: string;
      }>;

      if (customEvent.detail.fullName) {
        setDisplayName(customEvent.detail.fullName);
      }

      if (customEvent.detail.avatarUrl !== undefined) {
        setAvatarUrl(customEvent.detail.avatarUrl);
      }
    };

    window.addEventListener("joinly-profile-updated", handleProfileUpdated);

    return () => {
      window.removeEventListener("joinly-profile-updated", handleProfileUpdated);
    };
  }, []);
  const switchWorkspace = (next: WorkspaceMode) => {
    if (accountId) setWorkspaceMode(accountId, next);
    setWorkspace(next);
    void navigate({ to: workspaceHome(next) });
  };

  const onLogout = async () => {
    clearAuthSessionStartedAt();

    await supabase.auth.signOut();

    toast.success("Đã đăng xuất");

    navigate({
      to: "/",
    });
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl min-w-0 items-center justify-between gap-2 px-3 sm:px-6">
        <Link to={workspaceHome(workspace)} className="flex min-w-0 shrink items-center">
          <AppLogo imageClassName="h-8 max-w-[105px] sm:h-10 sm:max-w-none" />
        </Link>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {workspace === "participant" && (
            <Button asChild size="sm" variant="outline" className="px-2 sm:px-3">
              <Link to="/discover" aria-label="Khám phá"><Compass className="h-4 w-4" /> <span className="hidden min-[390px]:inline">Khám phá</span></Link>
            </Button>
          )}
          {workspace === "organizer" && (
            <Button asChild size="sm" variant="outline" className="px-2 sm:px-3">
              <Link to="/plans" aria-label="Gói dịch vụ">
                <Crown className="h-4 w-4" />
                <span className="hidden min-[390px]:inline">Gói</span>
              </Link>
            </Button>
          )}
          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded-full outline-none ring-offset-background transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="Mở tài khoản"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="h-9 w-9 rounded-full object-cover sm:h-10 sm:w-10"
                  />
                ) : (
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-primary sm:h-10 sm:w-10 text-sm font-semibold text-primary-foreground">
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" sideOffset={8} className="w-64 rounded-2xl p-2">
              <div className="flex items-center gap-3 px-3 py-3">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="h-11 w-11 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-base font-bold text-primary-foreground">
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                )}

                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{displayName}</p>
                </div>
              </div>

              <DropdownMenuSeparator />

              <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Chuyển không gian
              </div>
              <DropdownMenuItem
                className="cursor-pointer rounded-xl px-3 py-3"
                onSelect={() => switchWorkspace("organizer")}
              >
                <CalendarCog className="mr-2 h-4 w-4" />
                <span className="flex-1">Người tổ chức</span>
                {workspace === "organizer" && <Check className="h-4 w-4 text-primary" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer rounded-xl px-3 py-3"
                onSelect={() => switchWorkspace("participant")}
              >
                <Ticket className="mr-2 h-4 w-4" />
                <span className="flex-1">Người tham gia</span>
                {workspace === "participant" && <Check className="h-4 w-4 text-primary" />}
              </DropdownMenuItem>

              {workspace === "organizer" && (
                <>
                  <DropdownMenuSeparator />
                  <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hỗ trợ Joinly</div>
                  <DropdownMenuItem className="cursor-pointer rounded-xl px-3 py-3" onSelect={() => void navigate({ to: "/platform-review" })}>
                    <Star className="mr-2 h-4 w-4" /> Đánh giá website
                  </DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer rounded-xl px-3 py-3" onSelect={() => void navigate({ to: "/platform-report-bug" })}>
                    <Bug className="mr-2 h-4 w-4" /> Báo lỗi website
                  </DropdownMenuItem>
                  {platformAdmin && <DropdownMenuItem className="cursor-pointer rounded-xl px-3 py-3" onSelect={() => void navigate({ to: "/platform-support-admin" })}>
                    <ShieldCheck className="mr-2 h-4 w-4" /> Quản trị phản hồi
                  </DropdownMenuItem>}
                  {platformAdmin && <DropdownMenuItem className="cursor-pointer rounded-xl px-3 py-3" onSelect={() => void navigate({ to: "/platform-billing-admin" })}>
                    <WalletCards className="mr-2 h-4 w-4" /> Dashboard thanh toán
                  </DropdownMenuItem>}
                </>
              )}

              <DropdownMenuSeparator />

              <DropdownMenuItem
                className="cursor-pointer rounded-xl px-3 py-3"
                onSelect={() => {
                  navigate({
                    to: "/profile",
                  });
                }}
              >
                <User className="mr-2 h-4 w-4" />
                Thông tin cá nhân
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                className="cursor-pointer rounded-xl px-3 py-3 text-destructive focus:text-destructive"
                onSelect={() => {
                  void onLogout();
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Đăng xuất
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
