-- ============================================
-- JOINLY PAYMENTS
-- Lưu các đơn thanh toán Small / Standard /
-- Pro / Monthly
-- ============================================

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Người mua gói
  user_id uuid NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  -- Có event_id nếu mua Small / Standard / Pro
  -- Monthly thì event_id = NULL
  event_id uuid
    REFERENCES public.events(id)
    ON DELETE SET NULL,

  -- free / small / standard / pro / monthly
  plan_code text NOT NULL
    REFERENCES public.billing_plans(code),

  -- Ví dụ: JN1000000001
  order_code text NOT NULL UNIQUE,

  -- Giá tại thời điểm tạo đơn
  amount_vnd integer NOT NULL
    CHECK (amount_vnd > 0),

  status text NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'paid',
        'expired',
        'cancelled',
        'refunded'
      )
    ),

  -- ID giao dịch do SePay gửi về
  -- UNIQUE để webhook gửi lại cũng không xử lý 2 lần
  sepay_transaction_id bigint UNIQUE,

  -- Mã tham chiếu ngân hàng
  sepay_reference_code text,

  -- Ví dụ TPBank
  bank_gateway text,

  -- Thời điểm tiền thực sự vào
  paid_at timestamptz,

  -- Dùng để hết hạn QR/đơn pending
  expires_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- INDEX
-- ============================================

CREATE INDEX payments_user_id_idx
ON public.payments(user_id);

CREATE INDEX payments_event_id_idx
ON public.payments(event_id);

CREATE INDEX payments_status_idx
ON public.payments(status);

CREATE INDEX payments_order_code_idx
ON public.payments(order_code);

-- ============================================
-- AUTO UPDATED_AT
-- Joinly đã có function set_updated_at()
-- ============================================

CREATE TRIGGER payments_updated_at
BEFORE UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ============================================
-- RLS
-- ============================================

ALTER TABLE public.payments
ENABLE ROW LEVEL SECURITY;

-- User chỉ xem được lịch sử thanh toán của chính mình
CREATE POLICY "Users can view their own payments"
ON public.payments
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Frontend không được tự INSERT / UPDATE payment.
-- Việc tạo đơn và xác nhận thanh toán sẽ chạy server-side.

GRANT SELECT ON public.payments
TO authenticated;

GRANT ALL ON public.payments
TO service_role;