import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas-pro";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Sparkles,
  Check,
  Calendar,
  MapPin,
  Loader2,
  DoorOpen,
  Bookmark,
  Download,
} from "lucide-react";
import { getParticipantConfirmation } from "@/lib/confirmation.functions";

export const Route = createFileRoute("/join/$id/confirm/$token")({
  head: () => ({
    meta: [
      { title: "Xác nhận tham gia — Joinly" },
      { name: "referrer", content: "no-referrer" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ConfirmationPage,
});

type Confirmation = Awaited<ReturnType<typeof getParticipantConfirmation>>;

function ConfirmationPage() {
  const { id, token } = useParams({ from: "/join/$id/confirm/$token" });
  const fetchConfirmation = useServerFn(getParticipantConfirmation);
  const [data, setData] = useState<Confirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const ticketRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const row = await fetchConfirmation({ data: { token } });
        if (row && row.event_id === id) setData(row);
      } catch {
        // ignore
      }
      setLoading(false);
    })();
  }, [id, token, fetchConfirmation]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4 text-center">
        <div>
          <h1 className="font-display text-2xl font-bold">Không tìm thấy xác nhận</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Liên kết xác nhận không hợp lệ hoặc đã thay đổi.
          </p>
        </div>
      </div>
    );
  }

  const date = data.event_starts_at ? new Date(data.event_starts_at) : null;
  const ticketValue = `joinly-ticket:${data.event_id}:${token}`;
  const downloadTicketPdf = async () => {
    if (!ticketRef.current) return;

    const canvas = await html2canvas(ticketRef.current, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
    });

    const image = canvas.toDataURL("image/png");

    // Vé dọc hình chữ nhật lớn
    const pdfWidth = 120;
    const pdfHeight = 167;

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [pdfWidth, pdfHeight],
    });

    // Chiếm toàn bộ PDF
    pdf.addImage(image, "PNG", 0, 0, pdfWidth, pdfHeight);

    const safeName = data.full_name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    pdf.save(`Joinly-Ticket-${safeName || "Participant"}.pdf`);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" strokeWidth={2.5} />
          </span>
          <span className="font-display text-xl font-bold">Joinly</span>
        </div>
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-center font-display text-xl font-bold leading-tight">
            Bạn đã tham gia phòng {data.room_name}
          </h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            Sự kiện: {data.event_name}
          </p>
          <div
            ref={ticketRef}
            className="mt-6 overflow-hidden rounded-2xl border border-border bg-white text-slate-900"
          >
            <div className="grid md:grid-cols-[1fr_220px]">
              {/* THÔNG TIN VÉ */}
              <div className="p-6">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                    <Sparkles className="h-4 w-4" strokeWidth={2.5} />
                  </span>

                  <div>
                    <p className="text-lg font-bold">JOINLY</p>

                    <p className="text-xs text-slate-500">EVENT TICKET</p>
                  </div>
                </div>

                <div className="mt-6">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Sự kiện</p>

                  <h2 className="mt-1 text-xl font-bold">{data.event_name}</h2>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-5">
                  <div>
                    <p className="text-xs uppercase text-slate-500">Người tham gia</p>

                    <p className="mt-1 font-semibold">{data.full_name}</p>
                  </div>

                  <div>
                    <p className="text-xs uppercase text-slate-500">Phòng</p>

                    <p className="mt-1 font-semibold">{data.room_name}</p>
                  </div>

                  {date && (
                    <div>
                      <p className="text-xs uppercase text-slate-500">Ngày giờ</p>

                      <p className="mt-1 text-sm font-medium">
                        {date.toLocaleString("vi-VN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                  )}

                  {data.event_location && (
                    <div>
                      <p className="text-xs uppercase text-slate-500">Địa điểm</p>

                      <p className="mt-1 text-sm font-medium">{data.event_location}</p>
                    </div>
                  )}
                </div>

                <p className="mt-6 text-xs text-slate-500">
                  Vui lòng xuất trình QR khi check-in/check-out.
                </p>
              </div>

              {/* QR */}
              <div className="flex flex-col items-center justify-center border-t border-dashed border-slate-300 p-5 md:border-l md:border-t-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  QR Ticket
                </p>

                <div className="mt-3 rounded-xl bg-white p-2">
                  <QRCodeCanvas value={ticketValue} size={170} level="M" marginSize={1} />
                </div>

                <p className="mt-3 text-center text-[10px] text-slate-500">
                  Không chia sẻ mã QR này cho người khác
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-border bg-background p-4">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-foreground">
                <DoorOpen className="h-4 w-4 text-primary" />
                <span className="font-medium">Phòng: {data.room_name}</span>
              </div>
              {date && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  {date.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}
                </div>
              )}
              {data.event_location && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  {data.event_location}
                </div>
              )}
            </div>
            {data.event_description && (
              <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
                {data.event_description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={downloadTicketPdf}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            Tải vé PDF
          </button>

          <div className="mt-6 rounded-xl border border-primary/20 bg-primary-soft p-4">
            <div className="flex items-start gap-3">
              <Bookmark className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="text-xs text-foreground">
                <p className="font-medium">Lưu lại trang này</p>
                <p className="mt-1 text-muted-foreground">
                  Đánh dấu (bookmark) hoặc chụp màn hình liên kết hiện tại để xem lại từ bất kỳ
                  thiết bị nào.
                </p>
              </div>
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Người tham gia: {data.full_name}
          </p>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Nếu cần đổi phòng, vui lòng liên hệ ban tổ chức.
          </p>
        </div>
      </div>
      <div className="fixed -left-[9999px] top-0">
        <div
          ref={ticketRef}
          className="bg-white text-slate-900"
          style={{
            width: "900px",
            height: "1250px",
            padding: "48px",
            borderRadius: "28px",
            overflow: "hidden",
          }}
        >
          {/* HEADER */}
          <div className="flex items-center justify-between border-b-4 border-primary pb-6">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-xl bg-primary text-white">
                <Sparkles className="h-7 w-7" />
              </div>

              <div>
                <p className="text-3xl font-bold">JOINLY</p>

                <p className="text-sm font-semibold tracking-[0.2em] text-primary">EVENT PASS</p>
              </div>
            </div>

            <p className="text-lg font-bold text-primary">BOARDING PASS</p>
          </div>

          {/* QR + MÃ VÉ */}
          <div className="mt-8 flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400">Mã vé</p>

              <p className="mt-2 max-w-[320px] break-all text-sm font-semibold">
                {token.slice(0, 16).toUpperCase()}
              </p>
            </div>

            <div className="rounded-xl bg-white p-2">
              <QRCodeCanvas value={ticketValue} size={190} level="M" marginSize={1} />
            </div>
          </div>

          {/* EVENT */}
          <div className="mt-10">
            <p className="text-sm font-bold uppercase tracking-wider text-primary">
              Thông tin sự kiện
            </p>

            <div className="mt-3 h-1 w-full bg-primary" />

            <div className="mt-6">
              <p className="text-xs font-semibold uppercase text-slate-400">Sự kiện</p>

              <p className="mt-2 text-3xl font-bold">{data.event_name}</p>
            </div>

            <div className="mt-7 grid grid-cols-2 gap-7">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Phòng</p>

                <p className="mt-1 text-lg font-semibold">{data.room_name}</p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Ngày giờ</p>

                <p className="mt-1 text-lg font-semibold">
                  {date
                    ? date.toLocaleString("vi-VN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "—"}
                </p>
              </div>

              <div className="col-span-2">
                <p className="text-xs font-semibold uppercase text-slate-400">Địa điểm</p>

                <p className="mt-1 text-lg font-semibold">{data.event_location || "—"}</p>
              </div>
            </div>
          </div>

          {/* PARTICIPANT */}
          <div className="mt-10">
            <p className="text-sm font-bold uppercase tracking-wider text-primary">
              Thông tin người tham gia
            </p>

            <div className="mt-3 h-1 w-full bg-primary" />

            <div className="mt-6 grid grid-cols-2 gap-7">
              <div className="col-span-2">
                <p className="text-xs font-semibold uppercase text-slate-400">Họ và tên</p>

                <p className="mt-1 text-2xl font-bold">{data.full_name}</p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Loại vé</p>

                <p className="mt-1 text-lg font-semibold">Participant</p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Trạng thái</p>

                <p className="mt-1 text-lg font-semibold text-primary">Hợp lệ</p>
              </div>
            </div>
          </div>

          {/* FOOTER */}
          <div className="mt-12 rounded-2xl bg-primary/10 p-6">
            <p className="text-center text-sm font-medium text-slate-600">
              Xuất trình mã QR này cho ban tổ chức khi check-in / check-out.
            </p>

            <p className="mt-2 text-center text-xs text-slate-400">
              Không chia sẻ vé hoặc mã QR cho người khác.
            </p>
          </div>

          <div className="mt-10 text-center">
            <p className="text-xl font-bold text-primary">JOINLY</p>

            <p className="mt-1 text-xs tracking-wider text-slate-400">EVENT MANAGEMENT PLATFORM</p>
          </div>
        </div>
      </div>
    </div>
  );
}
