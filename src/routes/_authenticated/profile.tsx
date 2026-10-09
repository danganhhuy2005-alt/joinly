import { useEffect, useRef, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";

import { Camera, Loader2, Save, Trash2 } from "lucide-react";

import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      {
        title: "Thông tin cá nhân — Joinly",
      },
    ],
  }),

  component: ProfilePage,
});

function ProfilePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");

  const [fullName, setFullName] = useState("");
  const [clubName, setClubName] = useState("");

  // Avatar đã lưu trên Supabase
  const [avatarUrl, setAvatarUrl] = useState("");

  // Avatar mới chỉ đang preview, chưa lưu
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);

  const [previewAvatarUrl, setPreviewAvatarUrl] = useState("");

  // Đánh dấu xóa avatar, chỉ xóa thật khi bấm Lưu
  const [pendingAvatarDelete, setPendingAvatarDelete] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ==========================================
  // LOAD PROFILE
  // ==========================================

  useEffect(() => {
    const loadProfile = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        toast.error("Không thể tải thông tin tài khoản.");

        setLoading(false);
        return;
      }

      setUserId(user.id);
      setEmail(user.email ?? "");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select(
          `
            full_name,
            club_name,
            avatar_url
          `,
        )
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        console.error(profileError);

        toast.error("Không thể tải thông tin cá nhân.");

        setLoading(false);
        return;
      }

      setFullName(
        profile?.full_name ?? user.user_metadata?.full_name ?? user.user_metadata?.name ?? "",
      );

      setClubName(profile?.club_name ?? "");

      // Chỉ dùng avatar Joinly đã lưu.
      // Không có thì hiển thị chữ cái đầu.
      setAvatarUrl(profile?.avatar_url ?? "");

      setLoading(false);
    };

    void loadProfile();
  }, []);

  // ==========================================
  // CLEAN PREVIEW URL
  // ==========================================

  useEffect(() => {
    return () => {
      if (previewAvatarUrl) {
        URL.revokeObjectURL(previewAvatarUrl);
      }
    };
  }, [previewAvatarUrl]);

  // ==========================================
  // NÉN / RESIZE AVATAR
  //
  // Ảnh gốc: tối đa 50 MB
  // Ảnh lưu: WEBP, max 1024 px
  // ==========================================

  const compressAvatar = async (file: File): Promise<File> => {
    const bitmap = await createImageBitmap(file);

    const maxSize = 1024;

    let width = bitmap.width;
    let height = bitmap.height;

    if (width > height && width > maxSize) {
      height = Math.round(height * (maxSize / width));

      width = maxSize;
    } else if (height >= width && height > maxSize) {
      width = Math.round(width * (maxSize / height));

      height = maxSize;
    }

    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      bitmap.close();

      throw new Error("Không thể xử lý ảnh.");
    }

    context.drawImage(bitmap, 0, 0, width, height);

    bitmap.close();

    // Thử quality từ cao xuống thấp
    // để đảm bảo file cuối nằm dưới 2 MB.
    const qualities = [0.9, 0.85, 0.8, 0.75, 0.7];

    let finalBlob: Blob | null = null;

    for (const quality of qualities) {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/webp", quality);
      });

      if (!blob) {
        continue;
      }

      finalBlob = blob;

      if (blob.size <= 2 * 1024 * 1024) {
        break;
      }
    }

    if (!finalBlob) {
      throw new Error("Không thể nén ảnh.");
    }

    if (finalBlob.size > 2 * 1024 * 1024) {
      throw new Error("Không thể tối ưu ảnh xuống dưới 2 MB.");
    }

    return new File([finalBlob], "avatar.webp", {
      type: "image/webp",
    });
  };

  // ==========================================
  // CHỌN AVATAR
  // Chỉ preview, CHƯA upload
  // ==========================================

  const handleAvatarChange = async (file: File) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

    if (!allowedTypes.includes(file.type)) {
      toast.error("Chỉ hỗ trợ ảnh JPG, PNG hoặc WEBP.");

      return;
    }

    // Cho phép ảnh gốc tối đa 50 MB
    if (file.size > 50 * 1024 * 1024) {
      toast.error("Ảnh gốc không được vượt quá 50 MB.");

      return;
    }

    try {
      const compressedFile = await compressAvatar(file);

      // Xóa preview cũ khỏi RAM
      if (previewAvatarUrl) {
        URL.revokeObjectURL(previewAvatarUrl);
      }

      const preview = URL.createObjectURL(compressedFile);

      setPendingAvatarFile(compressedFile);

      setPreviewAvatarUrl(preview);

      setPendingAvatarDelete(false);

      console.log("Avatar gốc:", (file.size / 1024 / 1024).toFixed(2), "MB");

      console.log("Avatar sau tối ưu:", (compressedFile.size / 1024 / 1024).toFixed(2), "MB");
    } catch (error) {
      console.error(error);

      toast.error(error instanceof Error ? error.message : "Không thể xử lý ảnh.");
    }
  };

  // ==========================================
  // ĐÁNH DẤU XÓA AVATAR
  // Chưa xóa Supabase cho tới khi bấm Lưu
  // ==========================================

  const markAvatarForDelete = () => {
    if (previewAvatarUrl) {
      URL.revokeObjectURL(previewAvatarUrl);
    }

    setPreviewAvatarUrl("");

    setPendingAvatarFile(null);

    setPendingAvatarDelete(true);
  };

  // ==========================================
  // SAVE PROFILE
  // ==========================================

  const saveProfile = async () => {
    if (!userId) {
      return;
    }

    const cleanName = fullName.trim();

    const cleanClubName = clubName.trim();

    if (!cleanName) {
      toast.error("Vui lòng nhập họ và tên.");

      return;
    }

    setSaving(true);

    try {
      // QUAN TRỌNG:
      // Khai báo TRƯỚC khi dùng trong upsert.
      let finalAvatarUrl = avatarUrl;

      const avatarPath = `${userId}/avatar`;

      // ======================================
      // XÓA AVATAR
      // ======================================

      if (pendingAvatarDelete) {
        const { error: removeError } = await supabase.storage.from("avatars").remove([avatarPath]);

        if (removeError) {
          throw removeError;
        }

        finalAvatarUrl = "";
      }

      // ======================================
      // UPLOAD AVATAR MỚI
      // ======================================

      if (pendingAvatarFile && !pendingAvatarDelete) {
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(avatarPath, pendingAvatarFile, {
            upsert: true,

            contentType: pendingAvatarFile.type,

            cacheControl: "3600",
          });

        if (uploadError) {
          throw uploadError;
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from("avatars").getPublicUrl(avatarPath);

        // Tránh browser cache ảnh cũ
        finalAvatarUrl = `${publicUrl}?v=${Date.now()}`;
      }

      // ======================================
      // SAVE PROFILE DATABASE
      // ======================================

      const { error } = await supabase.from("profiles").upsert({
        id: userId,

        full_name: cleanName,

        club_name: cleanClubName.length > 0 ? cleanClubName : null,

        avatar_url: finalAvatarUrl.length > 0 ? finalAvatarUrl : null,
      });

      if (error) {
        throw error;
      }

      // ======================================
      // SAVE THÀNH CÔNG
      // ======================================

      setAvatarUrl(finalAvatarUrl);

      setPendingAvatarFile(null);

      setPendingAvatarDelete(false);

      if (previewAvatarUrl) {
        URL.revokeObjectURL(previewAvatarUrl);

        setPreviewAvatarUrl("");
      }

      // Chỉ tới đây header mới đổi
      window.dispatchEvent(
        new CustomEvent("joinly-profile-updated", {
          detail: {
            fullName: cleanName,
            avatarUrl: finalAvatarUrl,
          },
        }),
      );

      toast.success("Đã lưu thông tin cá nhân.");
    } catch (error) {
      console.error(error);

      toast.error(error instanceof Error ? error.message : "Không thể lưu thông tin cá nhân.");
    } finally {
      setSaving(false);
    }
  };

  // ==========================================
  // INITIALS
  // ==========================================

  const initials =
    fullName.trim().charAt(0).toUpperCase() || email.trim().charAt(0).toUpperCase() || "U";

  // Avatar đang hiển thị trong profile
  const displayedAvatarUrl = pendingAvatarDelete ? "" : previewAvatarUrl || avatarUrl;

  // ==========================================
  // LOADING
  // ==========================================

  if (loading) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-6">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  // ==========================================
  // UI
  // ==========================================

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Thông tin cá nhân</h1>

        <p className="mt-1 text-sm text-muted-foreground">
          Quản lý thông tin và ảnh đại diện tài khoản Joinly.
        </p>
      </div>

      <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm">
        {/* AVATAR */}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar className="h-24 w-24 border border-border">
            {displayedAvatarUrl && (
              <AvatarImage src={displayedAvatarUrl} alt={fullName} className="object-cover" />
            )}

            <AvatarFallback className="bg-primary text-2xl font-bold text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div>
            <p className="font-semibold">Ảnh đại diện</p>

            <p className="mt-1 text-sm text-muted-foreground">
              JPG, PNG hoặc WEBP. Ảnh gốc tối đa 50 MB. Joinly sẽ tự tối ưu ảnh trước khi lưu.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    await handleAvatarChange(file);
                  }

                  // Cho phép chọn lại cùng một file
                  event.target.value = "";
                }}
              />

              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera className="h-4 w-4" />
                Thay ảnh
              </Button>

              {(avatarUrl || previewAvatarUrl) && !pendingAvatarDelete && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={markAvatarForDelete}
                >
                  <Trash2 className="h-4 w-4" />
                  Xóa ảnh
                </Button>
              )}
            </div>

            {(pendingAvatarFile || pendingAvatarDelete) && (
              <p className="mt-3 text-xs text-muted-foreground">
                Thay đổi chưa được lưu. Bấm <strong>Lưu thay đổi</strong> để áp dụng.
              </p>
            )}
          </div>
        </div>

        <div className="my-6 h-px bg-border" />

        {/* PROFILE FORM */}
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="fullName">Họ và tên</Label>

            <Input
              id="fullName"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Nhập họ và tên"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>

            <Input id="email" value={email} disabled readOnly />

            <p className="text-xs text-muted-foreground">
              Email đăng nhập không thể thay đổi tại đây.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="clubName">CLB / Tổ chức</Label>

            <Input
              id="clubName"
              value={clubName}
              onChange={(event) => setClubName(event.target.value)}
              placeholder="Ví dụ: CLB Công nghệ"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button type="button" disabled={saving} onClick={() => void saveProfile()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Lưu thay đổi
          </Button>
        </div>
      </div>
    </main>
  );
}
