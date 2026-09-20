import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Plus, X, DoorOpen } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/create-event")({
  head: () => ({ meta: [{ title: "Tạo sự kiện — Joinly" }] }),
  component: CreateEvent,
});

const roomSchema = z.object({
  name: z.string().trim().min(1, "Tên phòng không được trống").max(80),
  accessCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4,6}$/, "Mã tham gia phải gồm 4–6 ký tự chữ hoa hoặc số")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

const schema = z.object({
  name: z.string().trim().min(1, "Vui lòng nhập tên sự kiện").max(120),
  description: z.string().trim().max(2000).optional(),
  location: z.string().trim().max(200).optional(),
  startsAt: z.string().min(1, "Vui lòng chọn thời gian bắt đầu"),
  expected: z.number().int().min(1, "Số người dự kiến phải ít nhất 1").max(100000).optional(),
  rooms: z.array(roomSchema).min(1, "Cần ít nhất một phòng"),
});


function CreateEvent() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const currentYear = new Date().getFullYear();
  const minStartsAt = (() => {
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  })();
  const maxStartsAt = `${currentYear + 1}-12-31T23:59`;

  const [expected, setExpected] = useState("");
  type RoomInput = { name: string; accessCode: string };
  const [rooms, setRooms] = useState<RoomInput[]>([{ name: "Hội trường chính", accessCode: "" }]);

  const updateRoomName = (i: number, v: string) =>
    setRooms((r) => r.map((x, idx) => (idx === i ? { ...x, name: v } : x)));
  const updateRoomCode = (i: number, v: string) =>
    setRooms((r) => r.map((x, idx) => (idx === i ? { ...x, accessCode: v.toUpperCase() } : x)));
  const addRoom = () => setRooms((r) => [...r, { name: "", accessCode: "" }]);
  const removeRoom = (i: number) => setRooms((r) => r.filter((_, idx) => idx !== i));


  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({
      name,
      description: description || undefined,
      location: location || undefined,
      startsAt,
      expected: expected ? Number(expected) : undefined,
      rooms: rooms
        .map((r) => ({ name: r.name.trim(), accessCode: r.accessCode.trim() || undefined }))
        .filter((r) => r.name.length > 0),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
      return;
    }

    const when = new Date(parsed.data.startsAt);
    if (isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      toast.error("Ngày sự kiện phải ở tương lai");
      return;
    }
    const year = when.getFullYear();
    if (year < currentYear || year > currentYear + 1) {
      toast.error(`Năm sự kiện phải từ ${currentYear} đến ${currentYear + 1}`);
      return;
    }


    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Phiên đăng nhập đã hết hạn");
      navigate({ to: "/login" });
      return;
    }
    const { data: ev, error } = await supabase
      .from("events")
      .insert({
        organizer_id: user.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        location: parsed.data.location ?? null,
        starts_at: new Date(parsed.data.startsAt).toISOString(),
        expected_attendees: parsed.data.expected ?? null,
      })
      .select("id")
      .single();

    if (error || !ev) {
      setLoading(false);
      toast.error("Không thể tạo sự kiện. Vui lòng thử lại.");
      return;
    }

    const { error: roomErr } = await supabase.from("event_rooms").insert(
      parsed.data.rooms.map((rm, idx) => ({
        event_id: ev.id,
        name: rm.name,
        position: idx,
        access_code: rm.accessCode ?? null,
      })),
    );

    if (roomErr) {
      setLoading(false);
      toast.error("Không thể tạo phòng. Vui lòng thử lại.");
      return;
    }

    toast.success("Đã tạo sự kiện!");
    navigate({ to: "/event/$id", params: { id: ev.id } });
  };

  return (
    <div className="min-h-screen bg-secondary/30 px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <Link to="/my-events" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Quay lại
        </Link>
        <div className="mt-6 rounded-2xl border border-border bg-card p-8 shadow-sm">
          <h1 className="font-display text-2xl font-bold">Tạo sự kiện mới</h1>
          <p className="mt-1 text-sm text-muted-foreground">Điền thông tin để khởi tạo phòng QR cho sự kiện.</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="name">Tên sự kiện *</Label>
              <Input id="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Workshop UI/UX cơ bản" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="desc">Mô tả</Label>
              <Textarea id="desc" rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Mô tả ngắn về sự kiện..." />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="when">Ngày & giờ *</Label>
                <Input id="when" type="datetime-local" required min={minStartsAt} max={maxStartsAt} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loc">Địa điểm</Label>
                <Input id="loc" maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Phòng 102, Tòa nhà ABC" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expected">Số người dự kiến</Label>
              <Input
                id="expected"
                type="number"
                min={1}
                max={100000}
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                placeholder="VD: 120"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5">
                  <DoorOpen className="h-4 w-4 text-primary" /> Phòng (rooms) *
                </Label>
                <span className="text-xs text-muted-foreground">{rooms.length} phòng</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Mỗi phòng có thể là một khu vực, lớp học hoặc workshop con của sự kiện.
              </p>
              <div className="space-y-3">
                {rooms.map((r, i) => (
                  <div key={i} className="rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="flex items-center gap-2">
                      <Input
                        value={r.name}
                        maxLength={80}
                        onChange={(e) => updateRoomName(i, e.target.value)}
                        placeholder={i === 0 ? "Hội trường chính" : i === 1 ? "Phòng 2" : "Workshop A"}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRoom(i)}
                        disabled={rooms.length === 1}
                        aria-label="Xoá phòng"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-2 grid gap-1">
                      <Label htmlFor={`code-${i}`} className="text-xs text-muted-foreground">
                        Mã tham gia (tuỳ chọn) — 4–6 ký tự chữ hoa hoặc số. Để trống nếu phòng mở.
                      </Label>
                      <Input
                        id={`code-${i}`}
                        value={r.accessCode}
                        maxLength={6}
                        onChange={(e) => updateRoomCode(i, e.target.value)}
                        placeholder="VD: A1B2"
                        className="uppercase"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <Button type="button" variant="outline" size="sm" onClick={addRoom}>
                <Plus className="h-4 w-4" /> Thêm phòng
              </Button>
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Tạo sự kiện
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
