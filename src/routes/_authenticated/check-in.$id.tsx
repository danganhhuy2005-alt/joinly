import { useEffect, useRef, useState } from "react";

import { createFileRoute, Link, useParams } from "@tanstack/react-router";

import { useServerFn } from "@tanstack/react-start";

import type { Html5Qrcode } from "html5-qrcode";

import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { getEventRole, canManageOperations, type EventRole } from "@/lib/event-role";
import { Button } from "@/components/ui/button";

import { scanParticipantTicket } from "@/lib/checkin.functions";

export const Route = createFileRoute("/_authenticated/check-in/$id")({
  head: () => ({
    meta: [
      {
        title: "Check-in / Check-out — Joinly",
      },
    ],
  }),

  component: CheckInPage,
});

type ScanMode = "check_in" | "check_out";

type UiResult = {
  type: "success" | "warning" | "error";

  title: string;

  description?: string;

  participant?: {
    fullName: string;
    roomName: string;
  };
};

const READER_ID = "joinly-ticket-scanner";

function CheckInPage() {
  const { id } = useParams({
    from: "/_authenticated/check-in/$id",
  });
  const [role, setRole] = useState<EventRole>(null);
  const [checkingRole, setCheckingRole] = useState(true);

  useEffect(() => {
    const checkRole = async () => {
      setCheckingRole(true);

      const currentRole = await getEventRole(id);

      setRole(currentRole);
      setCheckingRole(false);
    };

    void checkRole();
  }, [id]);

  const scanTicket = useServerFn(scanParticipantTicket);

  const scannerRef = useRef<Html5Qrcode | null>(null);

  const processingRef = useRef(false);

  const [mode, setMode] = useState<ScanMode>("check_in");

  const [cameraRunning, setCameraRunning] = useState(false);

  const [startingCamera, setStartingCamera] = useState(false);

  const [result, setResult] = useState<UiResult | null>(null);

  const stopScanner = async () => {
    const scanner = scannerRef.current;

    if (!scanner) {
      setCameraRunning(false);

      return;
    }

    try {
      await scanner.stop();
    } catch {
      // Scanner có thể đã dừng.
    }

    try {
      scanner.clear();
    } catch {
      // Bỏ qua lỗi cleanup.
    }

    scannerRef.current = null;

    setCameraRunning(false);
  };

  useEffect(() => {
    return () => {
      void stopScanner();
    };
  }, []);

  const showParticipantResult = (response: Awaited<ReturnType<typeof scanTicket>>) => {
    const participant = "participant" in response ? response.participant : undefined;

    const info = participant
      ? {
          fullName: participant.fullName,

          roomName: participant.roomName,
        }
      : undefined;

    switch (response.status) {
      case "checked_in":
        setResult({
          type: "success",

          title: "Check-in thành công",

          description: "Người tham gia đã được ghi nhận vào sự kiện.",

          participant: info,
        });

        break;

      case "checked_out":
        setResult({
          type: "success",

          title: "Check-out thành công",

          description: "Thời gian check-out đã được ghi nhận.",

          participant: info,
        });

        break;

      case "already_checked_in":
        setResult({
          type: "warning",

          title: "Đã check-in trước đó",

          description: "Người này đã được check-in rồi.",

          participant: info,
        });

        break;

      case "already_checked_out":
        setResult({
          type: "warning",

          title: "Đã check-out trước đó",

          description: "Người này đã hoàn tất check-out.",

          participant: info,
        });

        break;

      case "not_checked_in":
        setResult({
          type: "warning",

          title: "Chưa check-in",

          description: "Người này phải check-in trước khi check-out.",

          participant: info,
        });

        break;

      case "invalid_ticket":
        setResult({
          type: "error",

          title: "QR không hợp lệ",

          description: "Không tìm thấy vé này trong sự kiện.",
        });

        break;

      case "no_permission":
        setResult({
          type: "error",

          title: "Không có quyền",

          description: "Tài khoản này không có quyền check-in/check-out.",
        });

        break;
    }
  };

  const handleDecoded = async (decodedText: string) => {
    if (processingRef.current) {
      return;
    }

    processingRef.current = true;

    await stopScanner();

    try {
      const value = decodedText.trim();

      const match = /^joinly-ticket:([^:]+):([^:]+)$/.exec(value);

      if (!match) {
        setResult({
          type: "error",

          title: "Không phải QR vé Joinly",

          description: "Hãy quét QR vé cá nhân của người tham gia, không phải QR phòng.",
        });

        return;
      }

      const qrEventId = match[1];

      const token = match[2];

      if (qrEventId !== id) {
        setResult({
          type: "error",

          title: "QR thuộc sự kiện khác",

          description: "Vé này không thuộc sự kiện hiện tại.",
        });

        return;
      }

      const response = await scanTicket({
        data: {
          eventId: id,
          token,
          mode,
        },
      });

      showParticipantResult(response);
    } catch (error) {
      console.error("Scan ticket:", error);

      setResult({
        type: "error",

        title: "Không thể xử lý QR",

        description: "Có lỗi xảy ra. Vui lòng thử lại.",
      });
    } finally {
      processingRef.current = false;
    }
  };

  const startScanner = async () => {
    if (startingCamera || cameraRunning) {
      return;
    }

    setStartingCamera(true);

    setResult(null);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");

      const scanner = new Html5Qrcode(READER_ID);

      scannerRef.current = scanner;

      await scanner.start(
        {
          facingMode: "environment",
        },

        {
          fps: 10,

          qrbox: {
            width: 250,
            height: 250,
          },
        },

        (decodedText) => {
          void handleDecoded(decodedText);
        },

        () => {
          // Không cần báo lỗi
          // mỗi frame không đọc được QR.
        },
      );

      setCameraRunning(true);
    } catch (error) {
      console.error("Start camera:", error);

      setResult({
        type: "error",

        title: "Không mở được camera",

        description: "Hãy cấp quyền Camera cho trình duyệt rồi thử lại.",
      });

      scannerRef.current = null;

      setCameraRunning(false);
    } finally {
      setStartingCamera(false);
    }
  };

  const changeMode = async (newMode: ScanMode) => {
    if (newMode === mode) {
      return;
    }

    await stopScanner();

    setMode(newMode);

    setResult(null);
  };

  const scanNext = async () => {
    setResult(null);

    await startScanner();
  };

  if (checkingRole) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!canManageOperations(role)) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Bạn không có quyền truy cập</h1>

          <p className="mt-2 text-sm text-muted-foreground">
            Chỉ Owner, Co-owner hoặc Manager của sự kiện mới có thể check-in/check-out.
          </p>

          <Button variant="outline" className="mt-4" asChild>
            <Link to="/my-events">Quay lại sự kiện của tôi</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-secondary/30 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <Link
          to="/manage-event/$id"
          params={{ id }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Quay lại sự kiện
        </Link>

        <div className="mt-6">
          <h1 className="font-display text-3xl font-bold">Check-in / Check-out</h1>

          <p className="mt-1 text-sm text-muted-foreground">
            Quét QR vé cá nhân của người tham gia.
          </p>
        </div>

        {/* MODE */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant={mode === "check_in" ? "default" : "outline"}
            className="h-12"
            onClick={() => void changeMode("check_in")}
          >
            <LogIn className="h-4 w-4" />
            Check-in
          </Button>

          <Button
            type="button"
            variant={mode === "check_out" ? "default" : "outline"}
            className="h-12"
            onClick={() => void changeMode("check_out")}
          >
            <LogOut className="h-4 w-4" />
            Check-out
          </Button>
        </div>

        {/* CAMERA */}
        <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-primary" />

              <span className="font-medium">
                {mode === "check_in" ? "Đang ở chế độ Check-in" : "Đang ở chế độ Check-out"}
              </span>
            </div>
          </div>

          <div className="p-5">
            <div id={READER_ID} className="mx-auto w-full overflow-hidden rounded-xl bg-black" />

            {!cameraRunning && !result && (
              <div className="py-12 text-center">
                <Camera className="mx-auto h-10 w-10 text-muted-foreground" />

                <p className="mt-3 text-sm text-muted-foreground">Mở camera để bắt đầu quét vé.</p>

                <Button
                  type="button"
                  className="mt-4"
                  disabled={startingCamera}
                  onClick={() => void startScanner()}
                >
                  {startingCamera ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                  Mở camera
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* RESULT */}
        {result && (
          <div
            className={`mt-5 rounded-2xl border p-5 ${
              result.type === "success"
                ? "border-emerald-200 bg-emerald-50"
                : result.type === "warning"
                  ? "border-amber-200 bg-amber-50"
                  : "border-red-200 bg-red-50"
            }`}
          >
            <div className="flex items-start gap-3">
              {result.type === "success" ? (
                <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-600" />
              ) : result.type === "warning" ? (
                <AlertTriangle className="mt-0.5 h-6 w-6 text-amber-600" />
              ) : (
                <XCircle className="mt-0.5 h-6 w-6 text-red-600" />
              )}

              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{result.title}</h2>

                {result.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{result.description}</p>
                )}

                {result.participant && (
                  <div className="mt-4 rounded-xl bg-white/70 p-4">
                    <p className="font-semibold">{result.participant.fullName}</p>

                    <p className="mt-1 text-sm text-muted-foreground">
                      Phòng: {result.participant.roomName || "—"}
                    </p>
                  </div>
                )}

                <Button type="button" className="mt-4" onClick={() => void scanNext()}>
                  <RefreshCw className="h-4 w-4" />
                  Quét người tiếp theo
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
