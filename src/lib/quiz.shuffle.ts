
/**
 * Joinly Quiz - Shuffle đáp án theo phiên Live
 *
 * order[displayedIndex] = originalIndex
 *
 * Cùng session + question => cùng thứ tự.
 * Phiên khác => tạo thứ tự độc lập.
 */

// Tạo thứ tự đáp án ổn định.
export function getLiveOptionOrder(
  sessionId: string,
  questionId: string,
  optionCount: number,
): number[] {
  if (
    !Number.isInteger(optionCount) ||
    optionCount < 2 ||
    optionCount > 6
  ) {
    throw new Error("Số lượng đáp án không hợp lệ.");
  }

  const seedText =
    `joinly-shuffle-v1:${sessionId}:${questionId}`;

  // FNV-1a 32-bit seed
  let state = 2166136261;

  for (let i = 0; i < seedText.length; i++) {
    state = Math.imul(
      state ^ seedText.charCodeAt(i),
      16777619,
    ) >>> 0;
  }

  state ||= 0x9e3779b9;

  // Bộ sinh số giả ngẫu nhiên cố định.
  const random = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;

    return (state >>> 0) / 4294967296;
  };

  const order = Array.from(
    { length: optionCount },
    (_, index) => index,
  );

  // Fisher-Yates shuffle
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));

    [order[i], order[j]] = [
      order[j],
      order[i],
    ];
  }

  // Không để thứ tự giống hệt bản gốc.
  if (order.every((value, index) => value === index)) {
    [order[0], order[1]] = [
      order[1], order[0],
    ];
  }

  return order;
}

// Đáp án hiển thị cho Host và người chơi.
export function shuffleLiveOptions(
  sessionId: string,
  questionId: string,
  options: string[],
): string[] {
  const order = getLiveOptionOrder(
    sessionId,
    questionId,
    options.length,
  );

  return order.map((index) => options[index]);
}

// Chuyển đáp án người chơi bấm về vị trí gốc
// để database chấm điểm chính xác.
export function toOriginalOptionIndex(
  sessionId: string,
  questionId: string,
  optionCount: number,
  displayedIndex: number,
): number {
  const order = getLiveOptionOrder(
    sessionId,
    questionId,
    optionCount,
  );

  const originalIndex = order[displayedIndex];

  if (originalIndex === undefined) {
    throw new Error("Đáp án đã chọn không hợp lệ.");
  }

  return originalIndex;
}

// Chuyển đáp án đúng gốc sang vị trí hiển thị.
export function toDisplayedOptionIndex(
  sessionId: string,
  questionId: string,
  optionCount: number,
  originalIndex: number,
): number {
  const order = getLiveOptionOrder(
    sessionId,
    questionId,
    optionCount,
  );

  const displayedIndex = order.indexOf(originalIndex);

  if (displayedIndex === -1) {
    throw new Error("Không tìm thấy đáp án.");
  }

  return displayedIndex;
}

// Xáo trộn thống kê lượt chọn của Host
// theo đúng thứ tự đáp án hiển thị.
export function shuffleLiveAnswerCounts(
  sessionId: string,
  questionId: string,
  counts: number[],
): number[] {
  const order = getLiveOptionOrder(
    sessionId,
    questionId,
    counts.length,
  );

  return order.map((index) => counts[index] ?? 0);
}
