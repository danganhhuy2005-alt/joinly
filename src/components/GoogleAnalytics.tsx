import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

const GA_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID?.trim() ?? "";
const STORAGE_KEY = "joinly_analytics_consent";
const SETTINGS_EVENT = "joinly:analytics-settings";

type Consent = "accepted" | "rejected" | null;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

// Lấy loại trang, không gửi mã sự kiện, mã Quiz hoặc token.
function safeRoutePath(routeId: string): string {
  const path = routeId.replace(/\/_authenticated/g, "").replace(/\$[^/]+/g, ":id");

  return path.startsWith("/") ? path : `/${path}`;
}

function safeExternalReferrer(): string {
  try {
    return document.referrer ? `${new URL(document.referrer).origin}/` : "";
  } catch {
    return "";
  }
}

function initializeGA4(pageLocation: string): void {
  if (!/^G-[A-Z0-9]+$/.test(GA_ID)) return;

  window.dataLayer ??= [];
  // Google tag requires the real `arguments` object, not a plain Array.
  // A rest-parameter arrow function silently leaves GA4 events unsent.
  window.gtag ??= function gtag(..._args: unknown[]) {
    (window.dataLayer ??= []).push(arguments);
  };

  // Không dùng Google Analytics cho quảng cáo.
  window.gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });

  window.gtag("consent", "update", {
    analytics_storage: "granted",
  });

  window.gtag("js", new Date());

  window.gtag("config", GA_ID, {
    send_page_view: false,
    page_location: pageLocation,
    page_title: "Joinly",
    page_referrer: safeExternalReferrer(),
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;

  document.head.appendChild(script);
}

export default function GoogleAnalytics() {
  const routeId = useRouterState({
    select: (state) => state.matches[state.matches.length - 1]?.routeId ?? "/",
  });

  const [ready, setReady] = useState(false);
  const [consent, setConsent] = useState<Consent>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const initialized = useRef(false);
  const lastPage = useRef<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "accepted" || saved === "rejected") {
        setConsent(saved);
      }
    } catch {
      // Không dùng GA4 nếu trình duyệt không hỗ trợ lưu tùy chọn.
    }

    setReady(true);

    const openSettings = () => setSettingsOpen(true);

    window.addEventListener(SETTINGS_EVENT, openSettings);

    return () => {
      window.removeEventListener(SETTINGS_EVENT, openSettings);
    };
  }, []);

  useEffect(() => {
    if (!ready || consent !== "accepted" || !GA_ID) return;

    const pageLocation = window.location.origin + safeRoutePath(routeId);

    if (lastPage.current === pageLocation) return;

    if (!initialized.current) {
      initializeGA4(pageLocation);
      initialized.current = true;
    } else {
      window.gtag?.("config", GA_ID, {
        send_page_view: false,
        page_location: pageLocation,
        page_title: "Joinly",
      });
    }

    window.gtag?.("event", "page_view", {
      send_to: GA_ID,
      page_location: pageLocation,
      page_title: "Joinly",
      page_referrer: lastPage.current ?? safeExternalReferrer(),
      ...(import.meta.env.DEV ? { debug_mode: true } : {}),
    });

    lastPage.current = pageLocation;
  }, [ready, consent, routeId]);

  function chooseConsent(choice: "accepted" | "rejected") {
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      if (choice === "accepted") return;
    }

    if (consent === "accepted" && choice === "rejected") {
      window.gtag?.("consent", "update", {
        analytics_storage: "denied",
      });

      // Tải lại để dừng thư viện đã được nạp vào trang.
      window.location.reload();
      return;
    }

    setConsent(choice);
    setSettingsOpen(false);
  }

  if (!ready || !GA_ID) return null;

  // Không để banner che giao diện tham gia Quiz/sự kiện.
  const quickJoin = routeId.startsWith("/quiz/") || routeId.startsWith("/join/");

  if (!settingsOpen && (consent !== null || quickJoin)) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Lựa chọn thống kê truy cập"
      className="fixed inset-x-3 bottom-3 z-9999 mx-auto max-w-xl rounded-2xl border border-border bg-background p-5 text-foreground shadow-2xl"
    >
      <h2 className="text-base font-bold">Thống kê truy cập Joinly</h2>

      <p className="mt-2 text-sm text-muted-foreground">
        Joinly sử dụng Google Analytics để thống kê lượt truy cập và cải thiện website khi bạn đồng
        ý. Chúng tôi không gửi email, mã tham gia hoặc token của bạn qua GA4.
      </p>

      <a href="/privacy" className="mt-2 inline-block text-sm text-primary underline">
        Chính sách quyền riêng tư
      </a>

      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={() => chooseConsent("rejected")}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
        >
          Từ chối
        </button>

        <button
          type="button"
          onClick={() => chooseConsent("accepted")}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Đồng ý
        </button>
      </div>
    </div>
  );
}
