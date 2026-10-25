import { Link } from "@tanstack/react-router";
import { Home, Sparkles, Ticket } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

/** Public header: never requires authentication to return to Joinly. */
export function GuestEventHeader() {
  const { user } = useAuth();

  return (
    <nav aria-label="Điều hướng người tham gia" className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <Link to="/" className="inline-flex items-center gap-2 rounded-lg font-display text-lg font-bold text-foreground hover:text-primary" aria-label="Joinly — Trang chủ">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <span>Joinly</span>
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        {user && (
          <Link
            to="/my-participations"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary sm:text-sm"
          >
            <Ticket className="h-4 w-4" /> Vé của tôi
          </Link>
        )}
        <Link
          to="/"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary sm:text-sm"
        >
          <Home className="h-4 w-4" /> Trang chủ
        </Link>
      </div>
    </nav>
  );
}
