
-- JOINLY: CHECK-IN OPERATORS
-- Chỉ lấy thành viên quản lý đang hoạt động.
-- Giữ nguyên quyền gọi RPC hiện tại.

BEGIN;

CREATE OR REPLACE FUNCTION
public.list_event_checkin_operators(
  _event_id uuid
)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  role text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$

  WITH permission AS (
    SELECT
      public.get_event_role(_event_id)
        AS current_role
  ),

  operators AS (

    -- Owner của sự kiện
    SELECT
      e.organizer_id AS user_id,
      'owner'::text AS role
    FROM public.events e
    WHERE e.id = _event_id

    UNION

    -- Chỉ Co-owner và Manager đã active
    SELECT
      em.user_id,
      em.role
    FROM public.event_members em
    WHERE em.event_id = _event_id
      AND em.role IN (
        'co_owner',
        'manager'
      )
      AND em.status = 'active'

  )

  SELECT
    o.user_id,
    COALESCE(
      NULLIF(TRIM(p.full_name), ''),
      'Thành viên'
    ) AS full_name,
    o.role

  FROM operators o

  LEFT JOIN public.profiles p
    ON p.id = o.user_id

  WHERE (
    SELECT current_role
    FROM permission
  ) IS NOT NULL;

$function$;

-- Giữ quyền thực thi tương ứng
-- với bản production đã xuất.

REVOKE ALL ON FUNCTION
public.list_event_checkin_operators(uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
public.list_event_checkin_operators(uuid)
TO anon, authenticated, service_role;

COMMIT;
