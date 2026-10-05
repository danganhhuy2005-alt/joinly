import { useEffect, useRef, useState } from "react";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

type GoogleCredentialResponse = {
  credential?: string;
  select_by?: string;
};

type GoogleIdentity = {
  initialize: (options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    ux_mode?: "popup" | "redirect";
    auto_select?: boolean;
  }) => void;

  renderButton: (
    parent: HTMLElement,
    options: {
      type?: "standard" | "icon";
      theme?: "outline" | "filled_blue" | "filled_black";
      size?: "large" | "medium" | "small";
      text?: "signin_with" | "signup_with" | "continue_with" | "signin";
      shape?: "rectangular" | "pill" | "circle" | "square";
      logo_alignment?: "left" | "center";
      width?: number;
      locale?: string;
    },
  ) => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: GoogleIdentity;
      };
    };
  }
}

type GoogleSignInButtonProps = {
  disabled?: boolean;
  onSuccess: () => void;
};

const GOOGLE_GSI_SCRIPT = "https://accounts.google.com/gsi/client";

function loadGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts.id) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_GSI_SCRIPT}"]`,
    );

    const handleLoad = () => resolve();
    const handleError = () => reject(new Error("Không tải được Google Identity Services."));

    if (existingScript) {
      existingScript.addEventListener("load", handleLoad, { once: true });
      existingScript.addEventListener("error", handleError, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_GSI_SCRIPT;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });

    document.head.appendChild(script);
  });
}

export function GoogleSignInButton({ disabled = false, onSuccess }: GoogleSignInButtonProps) {
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const [loading, setLoading] = useState(false);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    let cancelled = false;

    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

    if (!clientId) {
      console.error("Missing VITE_GOOGLE_CLIENT_ID");
      toast.error("Thiếu VITE_GOOGLE_CLIENT_ID.");
      return;
    }

    void loadGoogleIdentityServices()
      .then(() => {
        if (cancelled || !buttonRef.current || !window.google?.accounts.id) {
          return;
        }

        buttonRef.current.innerHTML = "";

        window.google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: "popup",
          auto_select: false,
          callback: (response) => {
            void (async () => {
              if (!response.credential) {
                toast.error("Google không trả về ID token.");
                return;
              }

              setLoading(true);

              try {
                const { error } = await supabase.auth.signInWithIdToken({
                  provider: "google",
                  token: response.credential,
                });

                if (error) {
                  throw error;
                }

                toast.success("Đăng nhập Google thành công!");
                onSuccessRef.current();
              } catch (error) {
                const message = error instanceof Error ? error.message : "Đã có lỗi xảy ra";

                toast.error(`Không thể đăng nhập với Google: ${message}`);
              } finally {
                setLoading(false);
              }
            })();
          },
        });

        const availableWidth = Math.floor(buttonRef.current.clientWidth);
        const googleButtonWidth = Math.min(400, Math.max(240, availableWidth));

        window.google.accounts.id.renderButton(buttonRef.current, {
          type: "standard",
          theme: isDark ? "filled_black" : "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          logo_alignment: "left",
          width: googleButtonWidth,
          locale: "vi",
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "Không tải được Google Login.";

        toast.error(message);
      });

    return () => {
      cancelled = true;
    };
  }, [isDark]);

  const isDisabled = disabled || loading;

  useEffect(() => {
    const updateTheme = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={["w-full", isDisabled ? "pointer-events-none opacity-60" : ""].join(" ")}
      aria-busy={loading}
    >
      <div
        ref={buttonRef}
        className="flex min-h-11 w-full items-center justify-center overflow-hidden rounded-full"
      />

      {loading && (
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Đang đăng nhập...</span>
        </div>
      )}
    </div>
  );
}
