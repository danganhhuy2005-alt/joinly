-- Joinly | Danh sach tai khoan da thanh toan (moi user mot dong)
-- Applies AFTER 20261030153000_admin_billing_dashboard.sql.
-- Read only. Do not grant direct access to payment tables.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_paid_buyers(
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_plan text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset integer := LEAST(GREATEST(COALESCE(p_offset, 0), 0), 1000000);
  v_search text := NULLIF(BTRIM(p_search), '');
  v_rows jsonb := '[]'::jsonb;
  v_total bigint := 0;
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR NOT (SELECT public.is_joinly_platform_admin()) THEN
    RAISE EXCEPTION 'Only Joinly platform admins may view paid buyers'
      USING ERRCODE = '42501';
  END IF;

  WITH paid_buyers AS (
    SELECT
      p.user_id,
      u.email::text AS buyer_email,
      COALESCE(NULLIF(MAX(prof.club_name), ''),
               NULLIF(MAX(prof.full_name), ''),
               u.email::text, 'Chưa có tên') AS buyer_name,
      COUNT(*)::bigint AS paid_orders,
      COUNT(*) FILTER (WHERE p.plan_code = 'monthly')::bigint AS monthly_orders,
      COUNT(*) FILTER (WHERE p.plan_code IS DISTINCT FROM 'monthly')::bigint AS event_orders,
      COALESCE(SUM(p.amount_vnd), 0)::bigint AS total_spent_vnd,
      MAX(COALESCE(p.paid_at, p.created_at)) AS last_paid_at,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.plan_code), NULL) AS plan_codes
    FROM public.payments p
    JOIN auth.users u ON u.id = p.user_id
    LEFT JOIN public.profiles prof ON prof.id = p.user_id
    WHERE p.status = 'paid'
    GROUP BY p.user_id, u.email
  ),
  filtered AS (
    SELECT * FROM paid_buyers b
    WHERE (p_plan IS NULL OR p_plan = ANY (b.plan_codes))
      AND (v_search IS NULL OR b.buyer_email ILIKE '%' || v_search || '%'
           OR b.buyer_name ILIKE '%' || v_search || '%')
  ),
  page AS (
    SELECT * FROM filtered
    ORDER BY last_paid_at DESC NULLS LAST, user_id
    LIMIT v_limit OFFSET v_offset
  )
  SELECT
    (SELECT COUNT(*)::bigint FROM filtered),
    (SELECT COALESCE(
       JSONB_AGG(TO_JSONB(q) ORDER BY q.last_paid_at DESC NULLS LAST, q.user_id),
       '[]'::jsonb)
     FROM page q)
  INTO v_total, v_rows;

  RETURN JSONB_BUILD_OBJECT(
    'rows', v_rows,
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_get_paid_buyers(integer, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_paid_buyers(integer, integer, text, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
