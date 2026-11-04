import { Crown, LockKeyhole } from "lucide-react";
import { Link } from "@tanstack/react-router";

type Props = {
  eventId: string;
  feature: string;
  isOwner?: boolean;
};

/** UI-only gate: server functions and Supabase policies must enforce plan permissions separately. */
export function PaidFeatureOverlay({ eventId, feature, isOwner = false }: Props) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-[#031410]/55 px-4 py-8 backdrop-blur-[4px]" role="dialog" aria-modal="true" aria-label={`Mở khóa ${feature}`}>
      <div className="w-full max-w-[440px] rounded-[28px] border border-emerald-300/60 bg-[#0b2c25]/95 px-6 py-8 text-center text-white shadow-[0_20px_90px_rgba(0,0,0,0.55)] sm:px-9 sm:py-10">
        <span className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-400/15 ring-1 ring-emerald-400/15">
          <LockKeyhole className="h-10 w-10 text-[#63edbb]" />
        </span>
        <h2 className="text-2xl font-extrabold tracking-tight">Mở khóa {feature}</h2>
        <p className="mt-3 text-sm leading-7 text-emerald-50/80">Tính năng này dành cho sự kiện sử dụng gói trả phí. Nâng cấp để sử dụng đầy đủ.</p>
        {isOwner ? (
          <Link to="/manage-event/$id" params={{ id: eventId }} hash="upgrade" className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 font-semibold text-white transition hover:bg-emerald-400">
            <Crown className="h-5 w-5" /> Nâng cấp gói ngay <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <p className="mt-6 rounded-xl border border-emerald-300/20 bg-white/5 p-3 text-sm text-emerald-100">Chỉ chủ sở hữu sự kiện có thể nâng cấp gói.</p>
        )}
        <Link to="/manage-event/$id" params={{ id: eventId }} className="mt-4 inline-block text-sm text-emerald-100/70 underline-offset-4 hover:underline">Quay lại quản lý sự kiện</Link>
      </div>
    </div>
  );
}
