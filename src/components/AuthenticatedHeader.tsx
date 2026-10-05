import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { LogOut, Sparkles } from "lucide-react";

import { toast } from "sonner";

import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";

import { supabase } from "@/integrations/supabase/client";

import { clearAuthSessionStartedAt } from "@/lib/auth-session";

export function AuthenticatedHeader() {
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("Tài khoản");

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
        .select("club_name, full_name")
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
    };

    void loadUser();

    return () => {
      cancelled = true;
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

          <span className="hidden text-sm text-muted-foreground sm:inline">{displayName}</span>

          <Button type="button" variant="outline" size="sm" onClick={onLogout}>
            <LogOut className="h-4 w-4" />
            Đăng xuất
          </Button>
        </div>
      </div>
    </header>
  );
}
