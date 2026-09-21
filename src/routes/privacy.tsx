import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Sparkles } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Chính sách quyền riêng tư — Joinly" },
      {
        name: "description",
        content: "Chính sách quyền riêng tư của Joinly.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="font-display text-xl font-bold">Joinly</span>
          </Link>

          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Trang chủ
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="font-display text-4xl font-bold">Chính sách quyền riêng tư</h1>

        <p className="mt-3 text-sm text-muted-foreground">Cập nhật lần cuối: 21/09/2026</p>

        <div className="mt-10 space-y-8 leading-7 text-muted-foreground">
          <section>
            <h2 className="text-xl font-semibold text-foreground">1. Giới thiệu</h2>
            <p className="mt-2">
              Joinly là nền tảng hỗ trợ tạo và quản lý sự kiện, quản lý người tham gia, phòng sự
              kiện và các hoạt động liên quan đến sự kiện. Chính sách này giải thích cách Joinly thu
              thập và sử dụng thông tin khi bạn sử dụng dịch vụ.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">
              2. Thông tin chúng tôi thu thập
            </h2>

            <p className="mt-2">
              Khi bạn đăng nhập bằng Google, Joinly có thể nhận các thông tin cơ bản từ tài khoản
              Google của bạn như tên, địa chỉ email và ảnh đại diện.
            </p>

            <p className="mt-2">
              Joinly không yêu cầu quyền truy cập Gmail, Google Drive, Google Calendar hoặc nội dung
              riêng tư khác trong tài khoản Google của bạn.
            </p>

            <p className="mt-2">
              Khi sử dụng Joinly, chúng tôi cũng có thể lưu dữ liệu liên quan đến tài khoản, sự
              kiện, phòng sự kiện và thông tin người tham gia được nhập vào hệ thống.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">
              3. Cách chúng tôi sử dụng thông tin
            </h2>

            <p className="mt-2">
              Thông tin được sử dụng để xác thực tài khoản, quản lý tài khoản, cung cấp chức năng
              của Joinly, hiển thị thông tin người dùng và vận hành các tính năng quản lý sự kiện.
            </p>

            <p className="mt-2">
              Joinly không bán thông tin cá nhân của người dùng cho bên thứ ba và không sử dụng dữ
              liệu Google của bạn cho mục đích quảng cáo.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">4. Các dịch vụ bên thứ ba</h2>

            <p className="mt-2">
              Joinly sử dụng một số dịch vụ bên thứ ba để vận hành hệ thống, bao gồm Google OAuth để
              đăng nhập, Supabase để xác thực và lưu trữ dữ liệu, và Vercel để triển khai ứng dụng
              web.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">5. Bảo mật dữ liệu</h2>

            <p className="mt-2">
              Joinly áp dụng các biện pháp kỹ thuật phù hợp nhằm bảo vệ dữ liệu khỏi truy cập, thay
              đổi hoặc tiết lộ trái phép. Tuy nhiên, không có hệ thống trực tuyến nào có thể đảm bảo
              an toàn tuyệt đối.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">6. Xóa dữ liệu</h2>

            <p className="mt-2">
              Người dùng có thể yêu cầu xóa tài khoản và dữ liệu cá nhân liên quan bằng cách liên hệ
              với đội ngũ Joinly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">7. Thay đổi chính sách</h2>

            <p className="mt-2">
              Chính sách quyền riêng tư có thể được cập nhật khi Joinly thay đổi hoặc bổ sung tính
              năng. Phiên bản mới nhất sẽ luôn được công bố tại trang này.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">8. Liên hệ</h2>

            <p className="mt-2">
              Nếu có câu hỏi về chính sách quyền riêng tư hoặc dữ liệu cá nhân, vui lòng liên hệ đội
              ngũ Joinly.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
