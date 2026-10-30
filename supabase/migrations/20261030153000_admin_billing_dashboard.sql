-- Joinly admin-only, READ-ONLY billing overview.
-- Depends on 20261029190000_platform_review_and_bug_reports.sql
-- Do not grant direct SELECT on users' payment records to other organizers.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_billing_dashboard(
  p_tab text DEFAULT 'payments',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_status text DEFAULT NULL,
  p_plan text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := LEAST(GREATEST(COALESCE(p_offset, 0), 0), 1000000);
  v_tab text := COALESCE(p_tab, 'payments');
  v_filter text := NULLIF(BTRIM(p_search), '');
  v_count bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_active_monthly bigint := 0;
  v_plan_breakdown jsonb := '[]'::jsonb;
BEGIN
  -- Check role INSIDE the privileged function. Knowing the URL or executing
  -- RPC directly never grants access to another user's billing information.
  IF (SELECT auth.uid()) IS NULL OR NOT (SELECT public.is_joinly_platform_admin()) THEN
    RAISE EXCEPTION 'Only Joinly platform admins may view billing information'
      USING ERRCODE = '42501';
  END IF;

  IF v_tab NOT IN ('payments', 'monthly', 'events') THEN
    RAISE EXCEPTION 'Invalid billing tab' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'paid_revenue_vnd', COALESCE(SUM(amount_vnd) FILTER (WHERE status = 'paid'), 0),
    'paid_orders', COUNT(*) FILTER (WHERE status = 'paid'),
    'pending_orders', COUNT(*) FILTER (WHERE status = 'pending'),
    'refunded_orders', COUNT(*) FILTER (WHERE status = 'refunded'),
    'paid_buyers', COUNT(DISTINCT user_id) FILTER (WHERE status = 'paid'),
    'monthly_revenue_vnd', COALESCE(SUM(amount_vnd) FILTER (WHERE status = 'paid' AND plan_code = 'monthly'), 0)
  ) INTO v_summary
  FROM public.payments;

  SELECT COUNT(*) INTO v_active_monthly
  FROM public.user_subscriptions s
  WHERE s.plan_code = 'monthly' AND s.status = 'active'
    AND s.starts_at <= NOW() AND s.expires_at > NOW();
  v_summary := v_summary || jsonb_build_object('active_monthly', v_active_monthly);

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.revenue_vnd DESC), '[]'::jsonb)
    INTO v_plan_breakdown
  FROM (
    SELECT plan_code, COUNT(*)::bigint AS paid_orders,
      COALESCE(SUM(amount_vnd), 0)::bigint AS revenue_vnd
    FROM public.payments
    WHERE status = 'paid'
    GROUP BY plan_code
  ) t;

  IF v_tab = 'payments' THEN
    SELECT COUNT(*) INTO v_count
    FROM public.payments pay
    JOIN auth.users u ON u.id = pay.user_id
    LEFT JOIN public.events e ON e.id = pay.event_id
    WHERE (p_status IS NULL OR pay.status = p_status)
      AND (p_plan IS NULL OR pay.plan_code = p_plan)
      AND (v_filter IS NULL OR u.email ILIKE '%' || v_filter || '%'
           OR pay.order_code ILIKE '%' || v_filter || '%'
           OR e.name ILIKE '%' || v_filter || '%');

    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC, t.id DESC), '[]'::jsonb)
      INTO v_rows FROM (
      SELECT pay.id, pay.user_id, u.email AS buyer_email,
        COALESCE(NULLIF(prof.club_name, ''), NULLIF(prof.full_name, ''), u.email, 'Chưa có tên') AS buyer_name,
        pay.order_code, pay.plan_code, bp.name AS plan_name, bp.billing_type,
        pay.event_id, e.name AS event_name, pay.amount_vnd,
        pay.status, pay.bank_gateway, pay.sepay_reference_code,
        pay.created_at, pay.paid_at, pay.expires_at
      FROM public.payments pay
      JOIN auth.users u ON u.id = pay.user_id
      LEFT JOIN public.profiles prof ON prof.id = pay.user_id
      LEFT JOIN public.events e ON e.id = pay.event_id
      LEFT JOIN public.billing_plans bp ON bp.code = pay.plan_code
      WHERE (p_status IS NULL OR pay.status = p_status)
        AND (p_plan IS NULL OR pay.plan_code = p_plan)
        AND (v_filter IS NULL OR u.email ILIKE '%' || v_filter || '%'
             OR pay.order_code ILIKE '%' || v_filter || '%'
             OR e.name ILIKE '%' || v_filter || '%')
      ORDER BY pay.created_at DESC, pay.id DESC
      LIMIT v_limit OFFSET v_offset
    ) t;

  ELSIF v_tab = 'monthly' THEN
    SELECT COUNT(*) INTO v_count
    FROM public.user_subscriptions s
    JOIN auth.users u ON u.id = s.user_id
    WHERE s.plan_code = 'monthly'
      AND (p_status IS NULL OR (CASE
             WHEN s.status <> 'active' THEN s.status
             WHEN s.expires_at <= NOW() THEN 'expired'
             WHEN s.starts_at > NOW() THEN 'scheduled'
             ELSE 'active' END) = p_status)
      AND (v_filter IS NULL OR u.email ILIKE '%' || v_filter || '%');

    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC, t.id DESC), '[]'::jsonb)
      INTO v_rows FROM (
      SELECT s.id, s.user_id, u.email AS buyer_email,
        COALESCE(NULLIF(prof.club_name,''), NULLIF(prof.full_name,''), u.email, 'Chưa có tên') AS buyer_name,
        s.plan_code, s.starts_at, s.expires_at, s.status AS stored_status,
        (CASE WHEN s.status <> 'active' THEN s.status
              WHEN s.expires_at <= NOW() THEN 'expired'
              WHEN s.starts_at > NOW() THEN 'scheduled'
              ELSE 'active' END) AS effective_status,
        s.event_limit,
        (SELECT COUNT(*) FROM public.subscription_events se WHERE se.subscription_id = s.id)::bigint AS events_used,
        s.payment_id, pay.order_code, pay.amount_vnd, pay.status AS payment_status,
        s.created_at
      FROM public.user_subscriptions s
      JOIN auth.users u ON u.id = s.user_id
      LEFT JOIN public.profiles prof ON prof.id = s.user_id
      LEFT JOIN public.payments pay ON pay.id = s.payment_id
      WHERE s.plan_code = 'monthly'
        AND (p_status IS NULL OR (CASE
              WHEN s.status <> 'active' THEN s.status
              WHEN s.expires_at <= NOW() THEN 'expired'
              WHEN s.starts_at > NOW() THEN 'scheduled'
              ELSE 'active' END) = p_status)
        AND (v_filter IS NULL OR u.email ILIKE '%' || v_filter || '%')
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT v_limit OFFSET v_offset
    ) t;

  ELSE -- events: includes Free events; no payment should be inferred from a Free plan.
    SELECT COUNT(*) INTO v_count
    FROM public.events e
    JOIN auth.users u ON u.id = e.organizer_id
    WHERE (p_status IS NULL OR e.lifecycle_status = p_status)
      AND (p_plan IS NULL OR e.plan_code = p_plan OR
           (p_plan = 'monthly' AND EXISTS
             (SELECT 1 FROM public.subscription_events se WHERE se.event_id = e.id)))
      AND (v_filter IS NULL OR u.email ILIKE '%' || v_filter || '%'
           OR e.name ILIKE '%' || v_filter || '%');

    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC, t.id DESC), '[]'::jsonb)
      INTO v_rows FROM (
      SELECT e.id, e.name AS event_name, e.organizer_id AS user_id,
        u.email AS buyer_email,
        COALESCE(NULLIF(prof.club_name,''), NULLIF(prof.full_name,''), u.email, 'Chưa có tên') AS buyer_name,
        e.plan_code, e.attendee_limit, e.lifecycle_status,
        e.requested_plan_code, e.created_at,
        EXISTS (SELECT 1 FROM public.subscription_events se WHERE se.event_id = e.id) AS used_monthly
      FROM public.events e
      JOIN auth.users u ON u.id = e.organizer_id
      LEFT JOIN public.profiles prof ON prof.id = e.organizer_id
      WHERE (p_status IS NULL OR e.lifecycle_status = p_status)
        AND (p_plan IS NULL OR e.plan_code = p_plan OR
             (p_plan = 'monthly' AND EXISTS
               (SELECT 1 FROM public.subscription_events se WHERE se.event_id = e.id)))
        AND (v_filter IS NULL OR u.email ILIKE '%' || v_filter || '%'
             OR e.name ILIKE '%' || v_filter || '%')
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT v_limit OFFSET v_offset
    ) t;
  END IF;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'plan_breakdown', v_plan_breakdown,
    'rows', v_rows,
    'total_count', v_count,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_get_billing_dashboard(text, integer, integer, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_billing_dashboard(text, integer, integer, text, text, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
