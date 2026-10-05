import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EventLocationPicker } from "@/components/EventLocationPicker";

import { supabase } from "@/integrations/supabase/client";
import { getEventRole, type EventRole } from "@/lib/event-role";

export const Route = createFileRoute("/_authenticated/edit-event/$id")({
  head: () => ({
    meta: [
      {
        title: "Sửa sự kiện — Joinly",
      },
    ],
  }),
  component: EditEvent,
});

type EventRow = {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  starts_at: string | null;
  expected_attendees: number | null;

  latitude: number | null;
  longitude: number | null;
  checkin_radius: number;
};

function toDateTimeLocal(value: string | null) {
  if (!value) return "";

  const date = new Date(value);

  const offset = date.getTimezoneOffset() * 60_000;

  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function EditEvent() {
  const { id } = useParams({
    from: "/_authenticated/edit-event/$id",
  });

  const navigate = useNavigate();

  const [role, setRole] = useState<EventRole>(null);

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");

  const [description, setDescription] = useState("");

  const [location, setLocation] = useState("");

  const [startsAt, setStartsAt] = useState("");

  const [expected, setExpected] = useState("");

  const [latitude, setLatitude] = useState<number | null>(null);

  const [longitude, setLongitude] = useState<number | null>(null);

  const [checkinRadius, setCheckinRadius] = useState("200");

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      // Kiểm tra quyền trước
      const currentRole = await getEventRole(id);

      setRole(currentRole);

      if (currentRole !== "owner" && currentRole !== "co_owner") {
        setLoading(false);
        return;
      }

      // Chỉ Owner / Co-owner mới tải dữ liệu edit
      const { data: event, error } = await supabase
        .from("events")
        .select(
          `
            id,
            name,
            description,
            location,
            starts_at,
            expected_attendees,
            latitude,
            longitude,
            checkin_radius
          `,
        )
        .eq("id", id)
        .maybeSingle();

      if (error || !event) {
        console.error("Load event error:", error);

        toast.error("Không thể tải thông tin sự kiện.");

        setLoading(false);
        return;
      }

      const ev = event as EventRow;

      setName(ev.name);

      setDescription(ev.description ?? "");

      setLocation(ev.location ?? "");

      setStartsAt(toDateTimeLocal(ev.starts_at));

      setExpected(ev.expected_attendees ? String(ev.expected_attendees) : "");

      setLatitude(ev.latitude);
      setLongitude(ev.longitude);

      setCheckinRadius(String(ev.checkin_radius ?? 200));

      setLoading(false);
    };

    load();
  }, [id]);

  const saveEvent = async (e: React.FormEvent) => {
    e.preventDefault();

    if (role !== "owner" && role !== "co_owner") {
      toast.error("Bạn không có quyền sửa sự kiện.");
      return;
    }

    if (!name.trim()) {
      toast.error("Vui lòng nhập tên sự kiện.");
      return;
    }

    if (!startsAt) {
      toast.error("Vui lòng chọn ngày và giờ.");
      return;
    }

    if (!expected.trim()) {
      toast.error("Vui lòng nhập số người dự kiến.");
      return;
    }

    const expectedNumber = Number(expected);

    if (!Number.isInteger(expectedNumber) || expectedNumber < 1 || expectedNumber > 100000) {
      toast.error("Số người dự kiến không hợp lệ.");
      return;
    }

    const radius = Number(checkinRadius);

    if (!radius || radius < 20 || radius > 5000) {
      toast.error("Bán kính check-in phải từ 20m đến 5000m.");
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("events")
      .update({
        name: name.trim(),

        description: description.trim() || null,

        location: location.trim() || null,

        starts_at: new Date(startsAt).toISOString(),

        expected_attendees: expectedNumber,

        latitude,
        longitude,

        checkin_radius: radius,
      })
      .eq("id", id);

    setSaving(false);

    if (error) {
      console.error("Update event error:", error);

      toast.error("Không thể cập nhật sự kiện.");

      return;
    }

    toast.success("Đã cập nhật sự kiện.");

    navigate({
      to: "/dashboard/$id",
      params: { id },
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (role !== "owner" && role !== "co_owner") {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Không có quyền truy cập</h1>

        <p className="mt-2 text-sm text-muted-foreground">
          Chỉ Owner hoặc Co-owner mới có thể sửa sự kiện.
        </p>

        <Button className="mt-6" asChild>
          <Link to="/manage-event/$id" params={{ id }}>
            Quay lại sự kiện
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-secondary/30 px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <Link
          to="/manage-event/$id"
          params={{ id }}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Quay lại sự kiện
        </Link>

        <div className="mt-6 rounded-2xl border border-border bg-card p-8 shadow-sm">
          <h1 className="font-display text-2xl font-bold">Sửa sự kiện</h1>

          <p className="mt-1 text-sm text-muted-foreground">Cập nhật thông tin của sự kiện.</p>

          <form onSubmit={saveEvent} className="mt-6 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="name">Tên sự kiện *</Label>

              <Input
                id="name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Mô tả</Label>

              <Textarea
                id="description"
                rows={4}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="startsAt">Ngày & giờ *</Label>

              <Input
                id="startsAt"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <div>
                <Label>Địa điểm tổ chức</Label>

                <p className="text-xs text-muted-foreground">
                  Tìm địa điểm bằng Google. Bạn cũng có thể kéo ghim hoặc bấm trên bản đồ để chỉnh
                  lại vị trí.
                </p>
              </div>

              <EventLocationPicker
                latitude={latitude}
                longitude={longitude}
                address={location}
                onChange={(lat, lng, newAddress) => {
                  setLatitude(lat);
                  setLongitude(lng);

                  if (newAddress) {
                    setLocation(newAddress);
                  }
                }}
              />

              <div className="space-y-1.5">
                <Label htmlFor="radius">Bán kính check-in</Label>

                <div className="flex items-center gap-2">
                  <Input
                    id="radius"
                    type="number"
                    min={20}
                    max={5000}
                    value={checkinRadius}
                    onChange={(e) => setCheckinRadius(e.target.value)}
                  />

                  <span className="text-sm text-muted-foreground">mét</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expected">Số người dự kiến *</Label>

              <Input
                id="expected"
                type="number"
                required
                min={1}
                max={100000}
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
              />
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Lưu thay đổi
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
