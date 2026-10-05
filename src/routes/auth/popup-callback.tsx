import { useEffect } from "react";

import { createFileRoute } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/popup-callback")({
  ssr: false,
  component: PopupCallback,
});

function PopupCallback() {
  useEffect(() => {
    let finished = false;

    const finishLogin = () => {
      if (finished) {
        return;
      }

      finished = true;

      // Cách chính: BroadcastChannel
      try {
        const channel = new BroadcastChannel("joinly-auth");

        channel.postMessage({
          type: "joinly-auth-success",
        });

        channel.close();
      } catch (error) {
        console.error("BroadcastChannel error:", error);
      }

      // Fallback nếu window.opener vẫn còn
      try {
        window.opener?.postMessage(
          {
            type: "joinly-auth-success",
          },
          window.location.origin,
        );
      } catch (error) {
        console.error("postMessage error:", error);
      }

      // Đóng popup
      window.close();
    };

    const completeOAuth = async () => {
      try {
        const url = new URL(window.location.href);

        const code = url.searchParams.get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            throw error;
          }

          finishLogin();
          return;
        }

        // Trường hợp session đã được tạo
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) {
          finishLogin();
          return;
        }

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((event, session) => {
          if (session && event === "SIGNED_IN") {
            subscription.unsubscribe();

            finishLogin();
          }
        });
      } catch (error) {
        console.error("OAuth callback error:", error);
      }
    };

    void completeOAuth();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <p className="font-medium">Đang hoàn tất đăng nhập...</p>

        <p className="mt-2 text-sm text-muted-foreground">Cửa sổ này sẽ tự đóng.</p>
      </div>
    </div>
  );
}
