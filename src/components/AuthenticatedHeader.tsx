import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { ChevronDown, LogOut, Sparkles, User } from "lucide-react";

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

export function AuthenticatedHeader() {
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("Tài khoản");
  const [avatarUrl, setAvatarUrl] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || cancelled) {
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, club_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      console.log("HEADER PROFILE:", profile);

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
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/my-events" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-var(--shadow-soft)">
            <Sparkles className="h-4 w-4" strokeWidth={2.5} />
          </span>

          <span className="font-display text-xl font-bold tracking-tight">Joinly</span>
        </Link>

        <div className="flex items-center gap-3">
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
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
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
