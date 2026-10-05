import { useEffect } from "react";

import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { AuthenticatedHeader } from "@/components/AuthenticatedHeader";
import {
  clearAuthSessionStartedAt,
  ensureAuthSessionStartedAt,
  getAuthSessionRemainingMs,
  isAuthSessionExpired,
} from "@/lib/auth-session";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,

  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      clearAuthSessionStartedAt();

      throw redirect({
        to: "/",
        search: {},
      });
    }

    const startedAt = ensureAuthSessionStartedAt();

    if (isAuthSessionExpired(startedAt)) {
      clearAuthSessionStartedAt();

      await supabase.auth.signOut({
        scope: "local",
      });

      throw redirect({
        to: "/",
        search: {},
      });
    }

    return {
      user: data.user,
    };
  },

  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  useEffect(() => {
    const startedAt = ensureAuthSessionStartedAt();

    const remainingMs = getAuthSessionRemainingMs(startedAt);

    if (remainingMs <= 0) {
      clearAuthSessionStartedAt();

      void supabase.auth
        .signOut({
          scope: "local",
        })
        .finally(() => {
          window.location.replace("/login");
        });

      return;
    }

    const timer = window.setTimeout(() => {
      clearAuthSessionStartedAt();

      void supabase.auth
        .signOut({
          scope: "local",
        })
        .finally(() => {
          window.location.replace("/login");
        });
    }, remainingMs);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AuthenticatedHeader />
      <Outlet />
    </div>
  );
}
