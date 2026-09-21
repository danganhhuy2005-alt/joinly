import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Sparkles } from "lucide-react";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Điều khoản sử dụng — Joinly" },
      {
        name: "description",
        content: "Điều khoản sử dụng dịch vụ Joinly.",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
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
        <h1 className="font-display text-4xl font-bold">Điều khoản sử dụng</h1>

        <p className="mt-3 text-sm text-muted-foreground">Cập nhật lần cuối: 21/09/2026</p>

        <div className="mt-10 space-y-8 leading-7 text-muted-foreground">
          <section>
            <h2 className="text-xl font-semibold text-foreground">1. Chấp nhận điều khoản</h2>
            <p className="mt-2">
              Khi sử dụng Joinly, bạn đồng ý tuân thủ các điều khoản sử dụng được mô tả tại trang
              này.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">2. Tài khoản người dùng</h2>
            <p className="mt-2">
              Người dùng có trách nhiệm cung cấp thông tin chính xác, bảo vệ tài khoản và chịu trách
              nhiệm đối với hoạt động được thực hiện thông qua tài khoản của mình.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">3. Sử dụng Joinly</h2>
            <p className="mt-2">
              Joinly được sử dụng để hỗ trợ tạo, tổ chức và quản lý sự kiện. Người dùng không được
              sử dụng dịch vụ cho hoạt động bất hợp pháp, gian lận, phá hoại hệ thống hoặc xâm phạm
              quyền của người khác.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">4. Dữ liệu sự kiện</h2>
            <p className="mt-2">
              Ban tổ chức sự kiện chịu trách nhiệm đối với thông tin mà họ thu thập từ người tham
              gia và phải đảm bảo việc thu thập, sử dụng dữ liệu phù hợp với quy định áp dụng.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">5. Hoạt động của dịch vụ</h2>
            <p className="mt-2">
              Joinly cố gắng duy trì dịch vụ ổn định nhưng không đảm bảo hệ thống luôn hoạt động
              liên tục hoặc không có lỗi. Dịch vụ có thể được bảo trì, cập nhật hoặc thay đổi khi
              cần thiết.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">6. Thay đổi điều khoản</h2>
            <p className="mt-2">
              Joinly có thể cập nhật các điều khoản này khi dịch vụ thay đổi. Phiên bản mới nhất sẽ
              được công bố tại trang này.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">7. Liên hệ</h2>
            <p className="mt-2">
              Nếu có câu hỏi về các điều khoản sử dụng, vui lòng liên hệ với đội ngũ Joinly.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
