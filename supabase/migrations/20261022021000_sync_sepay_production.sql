-- JOINLY - SePay Production RPC
-- Snapshot: 2026-10-22
-- Check migration history before deployment.

BEGIN;

CREATE OR REPLACE FUNCTION public.process_sepay_payment(p_order_code text, p_transaction_id bigint, p_transfer_amount bigint, p_gateway text, p_reference_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_plan public.billing_plans%ROWTYPE;
  v_event public.events%ROWTYPE;

  v_start timestamptz;
  v_latest_expiry timestamptz;
BEGIN

  -- 1. Khóa đơn để chống webhook xử lý đồng thời
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE order_code = p_order_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'payment_not_found'
    );
  END IF;

  -- 2. Đơn đã thanh toán trước đó
  IF v_payment.status = 'paid' THEN
    RETURN jsonb_build_object(
      'success', true,
      'reason', 'already_paid'
    );
  END IF;

  -- 3. Chỉ xử lý đơn pending
  IF v_payment.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'invalid_payment_status'
    );
  END IF;

  -- 4. Kiểm tra hạn thanh toán
  IF v_payment.expires_at IS NOT NULL
     AND v_payment.expires_at <= now() THEN

    UPDATE public.payments
    SET status = 'expired'
    WHERE id = v_payment.id;

    RETURN jsonb_build_object(
      'success', false,
      'reason', 'order_expired'
    );
  END IF;

  -- 5. Kiểm tra đúng số tiền
  IF v_payment.amount_vnd <> p_transfer_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'amount_mismatch'
    );
  END IF;

  -- 6. Chống dùng lại một giao dịch ngân hàng
  IF EXISTS (
    SELECT 1
    FROM public.payments
    WHERE sepay_transaction_id = p_transaction_id
      AND id <> v_payment.id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'transaction_already_used'
    );
  END IF;

  -- 7. Lấy thông tin gói
  SELECT *
  INTO v_plan
  FROM public.billing_plans
  WHERE code = v_payment.plan_code
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Billing plan not found';
  END IF;

  -- 8. Kiểm tra sự kiện trước khi đánh dấu paid
  IF v_plan.billing_type = 'event' THEN

    IF v_payment.event_id IS NULL THEN
      RAISE EXCEPTION 'Missing event_id';
    END IF;

    SELECT *
    INTO v_event
    FROM public.events
    WHERE id = v_payment.event_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Event not found';
    END IF;

    IF v_event.organizer_id <> v_payment.user_id THEN
      RAISE EXCEPTION 'Payment owner mismatch';
    END IF;

    IF v_event.lifecycle_status = 'draft' THEN

      IF v_event.requested_plan_code
         IS DISTINCT FROM v_plan.code THEN
        RAISE EXCEPTION 'Draft plan mismatch';
      END IF;

    ELSIF v_event.lifecycle_status = 'active' THEN

      -- Chỉ cho phép nâng gói, không mua trùng/hạ gói
      IF (
        CASE v_plan.code
          WHEN 'free' THEN 0
          WHEN 'small' THEN 1
          WHEN 'standard' THEN 2
          WHEN 'pro' THEN 3
          ELSE -1
        END
      ) <= (
        CASE v_event.plan_code
          WHEN 'free' THEN 0
          WHEN 'small' THEN 1
          WHEN 'standard' THEN 2
          WHEN 'pro' THEN 3
          ELSE 4
        END
      ) THEN
        RAISE EXCEPTION 'Invalid plan upgrade';
      END IF;

    ELSE
      RAISE EXCEPTION 'Invalid event status';
    END IF;

    IF v_event.expected_attendees > v_plan.attendee_limit THEN
      RAISE EXCEPTION 'Event exceeds purchased plan limit';
    END IF;

  END IF;

  -- 9. Đánh dấu thanh toán thành công
  UPDATE public.payments
  SET
    status = 'paid',
    sepay_transaction_id = p_transaction_id,
    sepay_reference_code = p_reference_code,
    bank_gateway = p_gateway,
    paid_at = now()
  WHERE id = v_payment.id;

  -- 10. Kích hoạt sự kiện
  IF v_plan.billing_type = 'event' THEN

    UPDATE public.events
    SET
      plan_code = v_plan.code,
      attendee_limit = v_plan.attendee_limit,
      lifecycle_status = 'active',
      requested_plan_code = NULL,
      draft_updated_at = NULL
    WHERE id = v_payment.event_id;

  -- 11. Monthly giữ logic gia hạn hiện tại
  ELSIF v_plan.billing_type = 'monthly' THEN

    SELECT MAX(expires_at)
    INTO v_latest_expiry
    FROM public.user_subscriptions
    WHERE user_id = v_payment.user_id
      AND plan_code = 'monthly'
      AND expires_at > now();

    v_start := GREATEST(
      now(),
      COALESCE(v_latest_expiry, now())
    );

    INSERT INTO public.user_subscriptions (
      user_id,
      plan_code,
      payment_id,
      status,
      starts_at,
      expires_at,
      event_limit
    )
    VALUES (
      v_payment.user_id,
      'monthly',
      v_payment.id,
      'active',
      v_start,
      v_start + make_interval(
        days => COALESCE(v_plan.duration_days, 30)
      ),
      COALESCE(v_plan.event_limit, 3)
    );

  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reason', 'payment_completed',
    'payment_id', v_payment.id,
    'plan_code', v_plan.code
  );

END;
$function$;

REVOKE ALL ON FUNCTION
public.process_sepay_payment(text, bigint, bigint, text, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.process_sepay_payment(text, bigint, bigint, text, text)
TO service_role;

COMMIT;