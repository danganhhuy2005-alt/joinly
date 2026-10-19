export const QUIZ_IMAGE_EFFECTS = [
  { value: "full", label: "Hiện toàn bộ ảnh" },
  { value: "tiles4", label: "Che 4 ô" },
  { value: "tiles9", label: "Che 9 ô" },
  { value: "tiles16", label: "Che 16 ô" },
  { value: "random", label: "Mở ô ngẫu nhiên" },
  { value: "flip", label: "Lật mảnh ghép" },
  { value: "blur", label: "Mờ dần thành rõ" },
  { value: "pixel", label: "Pixel hóa" },
  { value: "left", label: "Mở từ trái sang phải" },
  { value: "right", label: "Mở từ phải sang trái" },
  { value: "down", label: "Mở từ trên xuống" },
  { value: "up", label: "Mở từ dưới lên" },
  { value: "center", label: "Mở từ giữa ra hai bên" },
  { value: "circle", label: "Vòng tròn mở rộng" },
  { value: "zoom", label: "Thu phóng ra" },
  { value: "spotlight", label: "Đèn soi ảnh" },
] as const;

export type QuizImageEffect = (typeof QUIZ_IMAGE_EFFECTS)[number]["value"];

type Props = {
  src?: string | null;
  effect?: QuizImageEffect | string | null;
  progress: number;
  seed?: string;
  alt?: string;
  className?: string;
};

// ========================================
// THỨ TỰ MỞ Ô - ĐỒNG BỘ GIỮA CÁC MÁY
// ========================================

function getTileOrder(side: number, random: boolean, seed: string) {
  const count = side * side;
  const center = (side - 1) / 2;

  const order = Array.from({ length: count }, (_, index) => index);

  // Ưu tiên hiện ô gần tâm trước.
  order.sort((a, b) => {
    const da = (Math.floor(a / side) - center) ** 2 + ((a % side) - center) ** 2;

    const db = (Math.floor(b / side) - center) ** 2 + ((b % side) - center) ** 2;

    return da - db || a - b;
  });

  if (!random) return order;

  // Ngẫu nhiên cố định theo mã câu hỏi.
  // Không dùng Math.random() để tránh
  // mỗi điện thoại mở ô theo thứ tự khác.

  let hash = 2166136261;

  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619) >>> 0;
  }

  for (let i = order.length - 1; i > 1; i--) {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;

    const j = 1 + (hash % i);

    [order[i], order[j]] = [order[j], order[i]];
  }

  return order;
}

// ========================================
// COMPONENT HIỆU ỨNG ẢNH
// ========================================

export function QuizMediaEffect({
  src,
  effect = "tiles9",
  progress,
  seed,
  alt = "Ảnh minh họa câu hỏi",
  className = "",
}: Props) {
  // Không có ảnh -> không tạo khung trống.
  if (!src?.trim()) return null;

  const mode: QuizImageEffect = QUIZ_IMAGE_EFFECTS.some((item) => item.value === effect)
    ? (effect as QuizImageEffect)
    : "tiles9";

  // Tiến độ từ 0 đến 1.
  // Component không tự tạo đồng hồ.
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;

  // ======================================
  // NHÓM HIỆU ỨNG MỞ TỪNG Ô
  // ======================================

  const side =
    mode === "tiles4"
      ? 2
      : mode === "tiles16"
        ? 4
        : ["tiles9", "random", "flip"].includes(mode)
          ? 3
          : 0;

  const count = side * side;

  const order = side > 0 ? getTileOrder(side, mode === "random", seed ?? src) : [];

  const positionByIndex = new Map(order.map((index, position) => [index, position]));

  // Ảnh luôn lộ ít nhất 12% với
  // nhóm mở theo hướng và hình tròn.
  const visible = 0.12 + 0.88 * p;
  const hidden = (1 - visible) * 100;

  // ======================================
  // NHÓM HIỆU ỨNG MỞ THEO HƯỚNG
  // ======================================

  let clipPath: string | undefined;

  switch (mode) {
    case "left":
      clipPath = `inset(0 ${hidden}% 0 0)`;
      break;

    case "right":
      clipPath = `inset(0 0 0 ${hidden}%)`;
      break;

    case "down":
      clipPath = `inset(0 0 ${hidden}% 0)`;
      break;

    case "up":
      clipPath = `inset(${hidden}% 0 0 0)`;
      break;

    case "center":
      clipPath = `inset(0 ${hidden / 2}% 0 ${hidden / 2}%)`;
      break;

    case "circle":
      clipPath = `circle(${12 + p * 110}% at 50% 50%)`;
      break;

    case "spotlight":
      clipPath = `circle(${15 + p * 115}% at ` + `${35 + p * 15}% ${35 + p * 15}%)`;
      break;
  }

  // ======================================
  // PIXEL HÓA VÀ THU PHÓNG
  // ======================================

  const pixelFactor = mode === "pixel" ? 1 + Math.round((1 - p) * 31) : 1;

  const zoomFactor = mode === "zoom" ? 1 + (1 - p) * 1.8 : 1;

  // ======================================
  // HIỂN THỊ
  // ======================================

  return (
    <div
      className={
        `relative aspect-video w-full overflow-hidden ` + `rounded-2xl bg-[#16383c] ${className}`
      }
      role="img"
      aria-label={alt}
    >
      {/* ẢNH GỐC */}

      <img
        src={src}
        alt=""
        draggable={false}
        className="pointer-events-none absolute left-0 top-0 select-none"
        style={{
          width: `${100 / pixelFactor}%`,
          height: `${100 / pixelFactor}%`,

          objectFit: "contain",

          transformOrigin: mode === "pixel" ? "top left" : "center",

          transform: mode === "pixel" ? `scale(${pixelFactor})` : `scale(${zoomFactor})`,

          imageRendering: mode === "pixel" ? "pixelated" : undefined,

          filter: mode === "blur" ? `blur(${(1 - p) * 20}px)` : undefined,

          clipPath,
        }}
      />

      {/* ===================================
          LỚP CHE MẢNH GHÉP
      =================================== */}

      {count > 0 && (
        <div
          className="pointer-events-none absolute inset-0 grid"
          aria-hidden="true"
          style={{
            gridTemplateColumns: `repeat(${side}, minmax(0, 1fr))`,

            gridTemplateRows: `repeat(${side}, minmax(0, 1fr))`,

            perspective: "700px",
          }}
        >
          {Array.from({ length: count }, (_, index) => {
            const step = positionByIndex.get(index) ?? count;

            // Ô đầu tiên đã mở tại p = 0.
            // Những ô còn lại mở dần
            // theo tiến độ thời gian.

            const amount = Math.max(0, Math.min(1, p * count + 1 - step));

            const coverOpacity = mode === "flip" ? 1 - amount : amount >= 1 ? 0 : 1;

            return (
              <div
                key={index}
                className="bg-[#21474b]"
                style={{
                  opacity: coverOpacity,

                  transform: mode === "flip" ? `rotateY(${amount * 90}deg)` : undefined,

                  backfaceVisibility: "hidden",

                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
