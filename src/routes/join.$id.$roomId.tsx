import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Calendar, MapPin, Loader2, DoorOpen, Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getJoined, setJoined } from "@/lib/joined-events";
import { registerParticipant } from "@/lib/confirmation.functions";
import { verifyRoomAccessCode } from "@/lib/room-access.functions";

export const Route = createFileRoute("/join/$id/$roomId")({
  head: () => ({ meta: [{ title: "Tham gia phòng — Joinly" }] }),
  component: JoinRoomPage,
});

type EventRow = { id: string; name: string; description: string | null; location: string | null; starts_at: string | null };
type RoomRow = { id: string; name: string; event_id: string; has_access_code: boolean };

type Step = "code" | "confirm" | "form";

function JoinRoomPage() {
  const { id, roomId } = useParams({ from: "/join/$id/$roomId" });
  const navigate = useNavigate();
  const register = useServerFn(registerParticipant);
  const verifyCode = useServerFn(verifyRoomAccessCode);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("confirm");
  const [submitting, setSubmitting] = useState(false);
  const [checkingCode, setCheckingCode] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [codeVerified, setCodeVerified] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [studentId, setStudentId] = useState("");

  useEffect(() => {
    // If this device has already joined a room for this event, send them
    // back to the event info page instead of letting them register again.
    const already = getJoined(id);
    if (already) {
      navigate({ to: "/join/$id", params: { id }, replace: true });
      return;
    }
    (async () => {
      const [{ data: ev }, { data: rm }] = await Promise.all([
        supabase.from("events").select("id, name, description, location, starts_at").eq("id", id).maybeSingle(),
        (supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> })
          .from("event_rooms_public")
          .select("id, name, event_id, has_access_code")
          .eq("id", roomId)
          .maybeSingle(),
      ]);
      setEvent(ev as EventRow | null);
      const roomRow = rm as RoomRow | null;
      setRoom(roomRow);
      setStep(roomRow?.has_access_code ? "code" : "confirm");
      setLoading(false);
    })();
  }, [id, roomId, navigate]);

  const onVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = accessCode.trim().toUpperCase();
    if (!trimmed) {
      toast.error("Vui lòng nhập mã phòng");
      return;
    }
    setCheckingCode(true);
    try {
      const result = await verifyCode({ data: { roomId, code: trimmed } });
      if (!result.ok) {
        toast.error("Sai mã phòng, vui lòng kiểm tra lại");
        return;
      }
      setCodeVerified(trimmed);
      setAccessCode(trimmed);
      setStep("confirm");
    } catch {
      toast.error("Không thể kiểm tra mã. Vui lòng thử lại.");
    } finally {
      setCheckingCode(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmedEmail);
    if (!emailOk) {
      toast.error("Email không hợp lệ. Ví dụ: ban@gmail.com");
      return;
    }
    if (trimmedPhone && !/^\d+$/.test(trimmedPhone)) {
      toast.error("Số điện thoại chỉ được chứa chữ số.");
      return;
    }
    setSubmitting(true);
    let result;
    try {
      result = await register({
        data: {
          eventId: id,
          roomId,
          fullName: name.trim(),
          email: trimmedEmail,
          phone: trimmedPhone || undefined,
          studentId: studentId.trim() || undefined,
          accessCode: codeVerified ?? undefined,
        },
      });
    } catch {
      setSubmitting(false);
      toast.error("Không thể đăng ký. Vui lòng thử lại.");
      return;
    }
    setSubmitting(false);
    if (result.status === "invalid") {
      toast.error("Phòng không hợp lệ.");
      return;
    }
    if (result.status === "wrong_code") {
      toast.error("Sai mã phòng, vui lòng kiểm tra lại");
      setStep("code");
      setCodeVerified(null);
      return;
    }
    if (result.status === "duplicate") {
      toast.error("Email này đã tham gia phòng này rồi. Vui lòng mở lại liên kết xác nhận bạn đã lưu, hoặc liên hệ ban tổ chức.");
      return;
    }
    if (room) setJoined(id, { roomId, roomName: room.name, token: result.token });
    toast.success("Đã ghi nhận đăng ký!");
    navigate({ to: "/join/$id/confirm/$token", params: { id, token: result.token }, replace: true });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!event || !room || room.event_id !== id) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4 text-center">
        <div>
          <h1 className="font-display text-2xl font-bold">Không tìm thấy phòng</h1>
          <p className="mt-2 text-sm text-muted-foreground">Mã QR có thể đã hết hạn hoặc liên kết không hợp lệ.</p>
        </div>
      </div>
    );
  }

  const date = event.starts_at ? new Date(event.starts_at) : null;

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
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
            <DoorOpen className="h-3.5 w-3.5" /> Phòng: {room.name}
          </div>
          <h1 className="mt-3 font-display text-2xl font-bold leading-tight">{event.name}</h1>
          {event.description && <p className="mt-2 text-sm text-muted-foreground">{event.description}</p>}
          <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
            {date && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {date.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}
              </div>
            )}
            {event.location && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                {event.location}
              </div>
            )}
          </div>

          {step === "code" && (
            <form onSubmit={onVerifyCode} className="mt-6 space-y-4">
              <div className="rounded-lg border border-border bg-secondary/40 p-4 text-sm">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <Lock className="h-4 w-4 text-primary" /> Phòng này yêu cầu mã tham gia
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Vui lòng nhập mã do ban tổ chức cung cấp để tiếp tục.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="accesscode">Mã phòng *</Label>
                <Input
                  id="accesscode"
                  required
                  autoFocus
                  maxLength={6}
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                  placeholder="VD: A1B2"
                  className="uppercase tracking-widest"
                />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={checkingCode}>
                {checkingCode && <Loader2 className="h-4 w-4 animate-spin" />}
                Kiểm tra mã
              </Button>
            </form>
          )}

          {step === "confirm" && (
            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-border bg-secondary/40 p-4 text-sm">
                <p className="text-foreground">
                  Bạn đang tham gia phòng <span className="font-semibold">{room.name}</span> thuộc sự kiện{" "}
                  <span className="font-semibold">{event.name}</span>.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Vui lòng kiểm tra kỹ thông tin phòng trước khi tiếp tục để tránh đăng ký nhầm.
                </p>
              </div>
              <Button type="button" size="lg" className="w-full" onClick={() => setStep("form")}>
                Xác nhận tham gia
                <ArrowRight className="h-4 w-4" />
              </Button>
              {room.has_access_code && codeVerified && (
                <p className="text-center text-xs text-muted-foreground">Đã xác thực mã phòng.</p>
              )}
            </div>
          )}

          {step === "form" && (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pname">Họ và tên *</Label>
                <Input id="pname" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn A" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pemail">Email *</Label>
                <Input id="pemail" type="email" required maxLength={255} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ban@example.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pphone">Số điện thoại</Label>
                <Input id="pphone" type="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xx xxx xxx" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="psid">Mã số sinh viên</Label>
                <Input id="psid" maxLength={30} value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="VD: 22000123" />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Tham gia phòng {room.name}
              </Button>
              <p className="text-center text-xs text-muted-foreground">Bạn không cần tạo tài khoản để tham gia.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
