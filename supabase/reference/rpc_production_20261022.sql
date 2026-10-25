-- JOINLY PRODUCTION RPC SNAPSHOT
-- Date: 2026-10-22
-- REFERENCE ONLY - NOT A MIGRATION
-- Do not execute directly on production.

-- =====================================
-- RPC: approve_coowner_request
-- HASH: cfdce2a459b6858ece8537bf43647d64
-- SECURITY DEFINER: true
-- ANON EXECUTE: false
-- AUTH EXECUTE: true
-- SERVICE EXECUTE: true
-- =====================================
CREATE OR REPLACE FUNCTION public.approve_coowner_request(_event_id uuid, _member_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  current_user_id uuid;
  owner_id uuid;
  target_member public.event_members%ROWTYPE;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Bạn chưa đăng nhập.';
  END IF;

  SELECT organizer_id
  INTO owner_id
  FROM public.events
  WHERE id = _event_id;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy sự kiện.';
  END IF;

  -- Chỉ Owner thật sự mới được duyệt
  IF current_user_id <> owner_id THEN
    RAISE EXCEPTION 'Chỉ Owner mới được duyệt Co-owner.';
  END IF;

  SELECT *
  INTO target_member
  FROM public.event_members
  WHERE id = _member_id
    AND event_id = _event_id
  LIMIT 1;

  IF target_member.id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy lời mời.';
  END IF;

  IF target_member.role <> 'co_owner' THEN
    RAISE EXCEPTION 'Thành viên này không phải Co-owner.';
  END IF;

  IF target_member.status <> 'pending' THEN
    RAISE EXCEPTION 'Lời mời này không ở trạng thái chờ duyệt.';
  END IF;

  UPDATE public.event_members
  SET
    status = 'active',
    updated_at = now()
  WHERE id = _member_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'active'
  );
END;
$function$;

-- =====================================
-- RPC: change_event_member_role
-- HASH: e495f0220de606825222473b2eb5088f
-- SECURITY DEFINER: true
-- ANON EXECUTE: false
-- AUTH EXECUTE: true
-- SERVICE EXECUTE: true
-- =====================================
CREATE OR REPLACE FUNCTION public.change_event_member_role(_event_id uuid, _member_id uuid, _new_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  current_user_id uuid;
  owner_id uuid;
  target_member public.event_members%ROWTYPE;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Bạn chưa đăng nhập.';
  END IF;

  IF _new_role NOT IN ('manager', 'co_owner') THEN
    RAISE EXCEPTION 'Vai trò không hợp lệ.';
  END IF;

  SELECT organizer_id
  INTO owner_id
  FROM public.events
  WHERE id = _event_id;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy sự kiện.';
  END IF;

  -- Chỉ Owner được đổi role
  IF current_user_id <> owner_id THEN
    RAISE EXCEPTION 'Chỉ Owner mới được thay đổi vai trò.';
  END IF;

  SELECT *
  INTO target_member
  FROM public.event_members
  WHERE id = _member_id
    AND event_id = _event_id
  LIMIT 1;

  IF target_member.id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy thành viên.';
  END IF;

  -- Chỉ đổi thành viên đang active
  IF target_member.status <> 'active' THEN
    RAISE EXCEPTION 'Chỉ có thể đổi vai trò của thành viên đang hoạt động.';
  END IF;

  IF target_member.role = _new_role THEN
    RAISE EXCEPTION 'Thành viên đã có vai trò này.';
  END IF;

  UPDATE public.event_members
  SET
    role = _new_role,
    updated_at = now()
  WHERE id = _member_id;

  RETURN jsonb_build_object(
    'success', true,
    'role', _new_role
  );
END;
$function$;

-- =====================================
-- RPC: create_event_upgrade_payment
-- HASH: 1dc5f9bd797d19d9be971c91f5bd9dcc
-- SECURITY DEFINER: true
-- ANON EXECUTE: false
-- AUTH EXECUTE: false
-- SERVICE EXECUTE: true
-- =====================================
CREATE OR REPLACE FUNCTION public.create_event_upgrade_payment(p_event_id uuid, p_user_id uuid, p_plan_code text, p_order_code text, p_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_from public.billing_plans%ROWTYPE;
  v_to public.billing_plans%ROWTYPE;
  v_existing public.payments%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_delta integer;
  v_rank_from integer;
  v_rank_to integer;
  v_pending_count integer;
BEGIN
  -- The server passes the authenticated user ID; this RPC is service_role-only.
  IF p_user_id IS NULL OR p_event_id IS NULL OR p_plan_code IS NULL THEN
    RAISE EXCEPTION 'Thiếu thông tin nâng cấp gói.';
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND OR v_event.organizer_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Chỉ Owner mới được nâng cấp sự kiện.';
  END IF;

  IF v_event.lifecycle_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Sự kiện chưa kích hoạt không thể nâng cấp.';
  END IF;

  v_rank_from := CASE v_event.plan_code
    WHEN 'small' THEN 1 WHEN 'standard' THEN 2 WHEN 'pro' THEN 3 ELSE 0 END;
  v_rank_to := CASE p_plan_code
    WHEN 'small' THEN 1 WHEN 'standard' THEN 2 WHEN 'pro' THEN 3 ELSE 0 END;

  IF v_rank_from = 0 OR v_rank_to <= v_rank_from THEN
    RAISE EXCEPTION 'Chỉ cho phép nâng từ Small lên Standard/Pro hoặc Standard lên Pro.';
  END IF;

  SELECT * INTO v_from FROM public.billing_plans
  WHERE code = v_event.plan_code AND billing_type = 'event';
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy gói hiện tại.'; END IF;

  SELECT * INTO v_to FROM public.billing_plans
  WHERE code = p_plan_code AND billing_type = 'event' AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gói đích không khả dụng.'; END IF;

  v_delta := v_to.price_vnd - v_from.price_vnd;
  IF v_delta <= 0 THEN
    RAISE EXCEPTION 'Giá nâng cấp không hợp lệ, vui lòng liên hệ hỗ trợ.';
  END IF;

  -- Serialise payment creation with other requests for the same event.
  -- Do not silently replace a still-valid QR for another package.
  SELECT count(*) INTO v_pending_count
  FROM public.payments WHERE event_id = p_event_id AND status = 'pending';
  IF v_pending_count > 1 THEN
    RAISE EXCEPTION 'Sự kiện có nhiều đơn chờ, cần đối soát trước khi tiếp tục.';
  END IF;

  SELECT * INTO v_existing
  FROM public.payments
  WHERE event_id = p_event_id AND status = 'pending'
  FOR UPDATE NOWAIT;

  IF FOUND THEN
    IF v_existing.expires_at > now() THEN
      IF v_existing.plan_code IS DISTINCT FROM p_plan_code
          OR v_existing.amount_vnd <> v_delta
          OR v_existing.upgrade_from_plan_code IS DISTINCT FROM v_event.plan_code THEN
        RAISE EXCEPTION 'Đang có đơn thanh toán khác. Vui lòng chờ đơn hết hạn hoặc liên hệ hỗ trợ.';
      END IF;
      v_payment := v_existing;
    ELSE
      UPDATE public.payments SET status = 'expired'
      WHERE id = v_existing.id AND status = 'pending';
    END IF;
  END IF;

  IF v_payment.id IS NULL THEN
    IF p_order_code !~ '^JN[0-9]{10}$' THEN
      RAISE EXCEPTION 'Mã đơn thanh toán không hợp lệ.';
    END IF;
    IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '31 minutes' THEN
      RAISE EXCEPTION 'Thời hạn thanh toán không hợp lệ.';
    END IF;

    INSERT INTO public.payments
      (event_id, user_id, plan_code, upgrade_from_plan_code,
       amount_vnd, order_code, status, expires_at)
    VALUES
      (p_event_id, p_user_id, p_plan_code, v_event.plan_code,
       v_delta, p_order_code, 'pending', p_expires_at)
    RETURNING * INTO v_payment;
  END IF;

  RETURN jsonb_build_object(
    'id', v_payment.id,
    'order_code', v_payment.order_code,
    'amount_vnd', v_payment.amount_vnd,
    'plan_code', v_payment.plan_code,
    'event_id', v_payment.event_id,
    'status', v_payment.status,
    'expires_at', v_payment.expires_at
  );
END;
$function$;

-- =====================================
-- RPC: create_monthly_event
-- HASH: 36c4911badb9cb5c8c0e4d4c52b3b263
-- SECURITY DEFINER: false
-- ANON EXECUTE: false
-- AUTH EXECUTE: false
-- SERVICE EXECUTE: true
-- =====================================
CREATE OR REPLACE FUNCTION public.create_monthly_event(p_user_id uuid, p_name text, p_description text, p_location text, p_latitude double precision, p_longitude double precision, p_checkin_radius integer, p_starts_at timestamp with time zone, p_expected integer, p_rooms jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_sub record;
  v_plan record;
  v_used bigint;
  v_event_id uuid;
  v_room jsonb;
  v_room_name text;
  v_room_code text;
  v_position integer := 0;
BEGIN
  -- Hàm chỉ dành cho backend
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Không có quyền tạo sự kiện Monthly.';
  END IF;

  -- Kiểm tra cấu hình gói
  SELECT attendee_limit, event_limit
  INTO v_plan
  FROM public.billing_plans
  WHERE code = 'monthly'
    AND billing_type = 'monthly'
    AND is_active = true;

  IF NOT FOUND
     OR v_plan.attendee_limit IS DISTINCT FROM 500
     OR v_plan.event_limit IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'Cấu hình Monthly không hợp lệ.';
  END IF;

  -- Khóa subscription để chống tạo đồng thời
  SELECT s.id, s.event_limit, s.expires_at
  INTO v_sub
  FROM public.user_subscriptions s
  WHERE s.user_id = p_user_id
    AND s.plan_code = 'monthly'
    AND s.status = 'active'
    AND s.starts_at <= now()
    AND s.expires_at > now()
  ORDER BY s.expires_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gói Monthly đã hết hạn hoặc chưa kích hoạt.';
  END IF;

  -- Đếm số suất đã sử dụng
  SELECT COUNT(*)
  INTO v_used
  FROM public.subscription_events
  WHERE subscription_id = v_sub.id;

  IF v_used >= LEAST(v_sub.event_limit, 3) THEN
    RAISE EXCEPTION 'Đã sử dụng hết 3 suất sự kiện Monthly.';
  END IF;

  -- Kiểm tra thông tin sự kiện
  IF p_name IS NULL
     OR length(btrim(p_name)) NOT BETWEEN 1 AND 120
     OR length(COALESCE(p_description, '')) > 2000
     OR length(COALESCE(p_location, '')) > 200
     OR p_expected IS NULL
     OR p_expected NOT BETWEEN 1 AND 500
     OR p_starts_at IS NULL
     OR p_starts_at <= now()
     OR p_checkin_radius IS NULL
     OR p_checkin_radius NOT BETWEEN 20 AND 5000
     OR p_latitude IS NULL
     OR p_latitude NOT BETWEEN -90 AND 90
     OR p_longitude IS NULL
     OR p_longitude NOT BETWEEN -180 AND 180
  THEN
    RAISE EXCEPTION 'Thông tin sự kiện không hợp lệ.';
  END IF;

  IF p_rooms IS NULL
     OR jsonb_typeof(p_rooms) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Danh sách phòng không hợp lệ.';
  END IF;

  IF jsonb_array_length(p_rooms) < 1 THEN
    RAISE EXCEPTION 'Sự kiện phải có ít nhất một phòng.';
  END IF;

  -- Tạo sự kiện được hưởng quyền Monthly
  INSERT INTO public.events (
    organizer_id,
    name,
    description,
    location,
    latitude,
    longitude,
    checkin_radius,
    starts_at,
    expected_attendees,
    plan_code,
    attendee_limit,
    lifecycle_status,
    requested_plan_code
  )
  VALUES (
    p_user_id,
    btrim(p_name),
    p_description,
    p_location,
    p_latitude,
    p_longitude,
    p_checkin_radius,
    p_starts_at,
    p_expected,
    'monthly',
    500,
    'active',
    NULL
  )
  RETURNING id INTO v_event_id;

  -- Tạo các phòng
  FOR v_room IN
    SELECT value
    FROM jsonb_array_elements(p_rooms) AS x(value)
  LOOP
    v_room_name :=
      btrim(COALESCE(v_room->>'name', ''));

    v_room_code :=
      NULLIF(
        upper(btrim(COALESCE(v_room->>'accessCode', ''))),
        ''
      );

    IF length(v_room_name) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'Tên phòng không hợp lệ.';
    END IF;

    IF v_room_code IS NOT NULL
       AND v_room_code !~ '^[A-Z0-9]{4,6}$' THEN
      RAISE EXCEPTION 'Mã phòng không hợp lệ.';
    END IF;

    INSERT INTO public.event_rooms (
      event_id,
      name,
      position,
      access_code
    )
    VALUES (
      v_event_id,
      v_room_name,
      v_position,
      v_room_code
    );

    v_position := v_position + 1;
  END LOOP;

  -- Ghi nhận sự kiện đã dùng một suất Monthly
  INSERT INTO public.subscription_events (
    subscription_id,
    event_id
  )
  VALUES (
    v_sub.id,
    v_event_id
  );

  RETURN v_event_id;
END;
$function$;

-- =====================================
-- RPC: delete_unpaid_event_draft
-- HASH: b86724587d8a51e83877c5d92af3980f
-- SECURITY DEFINER: true
-- ANON EXECUTE: false
-- AUTH EXECUTE: true
-- SERVICE EXECUTE: true
-- =====================================
CREATE OR REPLACE FUNCTION public.delete_unpaid_event_draft(p_event_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_owner uuid;
  v_status text;
BEGIN
  SELECT organizer_id, lifecycle_status
  INTO v_owner, v_status
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND OR v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Bạn không có quyền xóa bản nháp.';
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Chỉ được xóa bản nháp chưa kích hoạt.';
  END IF;

  -- Khóa các đơn để tránh thay đổi đồng thời
  PERFORM 1
  FROM public.payments
  WHERE event_id = p_event_id
  FOR UPDATE;

  -- Không xóa khi đã ghi nhận tiền
  IF EXISTS (
    SELECT 1
    FROM public.payments
    WHERE event_id = p_event_id
      AND (
        status IN ('paid', 'refunded')
        OR paid_at IS NOT NULL
        OR sepay_transaction_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Sự kiện có giao dịch cần đối soát, không thể xóa.';
  END IF;

  -- Lưu liên kết sự kiện cũ, hủy các đơn pending
  UPDATE public.payments
  SET
    cancelled_draft_event_id = COALESCE(
      cancelled_draft_event_id,
      event_id
    ),
    status = CASE
      WHEN status = 'pending' THEN 'cancelled'
      ELSE status
    END
  WHERE event_id = p_event_id;

  -- Xóa sự kiện; lịch sử payments được giữ
  DELETE FROM public.events
  WHERE id = p_event_id
    AND organizer_id = auth.uid()
    AND lifecycle_status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không thể xóa bản nháp.';
  END IF;

  RETURN true;
END;
$function$;

-- =====================================
-- RPC: get_event_role
-- HASH: 6bd765589fd9c5f8ea27fb9ec3ff5dcd
-- SECURITY DEFINER: true
-- ANON EXECUTE: true
-- AUTH EXECUTE: true
-- SERVICE EXECUTE: true
-- =====================================
CREATE OR REPLACE FUNCTION public.get_event_role(_event_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  current_user_id uuid;
  member_role text;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Người tạo event luôn là Owner
  IF EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = _event_id
      AND e.organizer_id = current_user_id
  ) THEN
    RETURN 'owner';
  END IF;

  -- Co-owner / Manager chỉ có quyền khi status = active
  SELECT em.role
  INTO member_role
  FROM public.event_members em
  WHERE em.event_id = _event_id
    AND em.user_id = current_user_id
    AND em.status = 'active'
  LIMIT 1;

  RETURN member_role;
END;
$function$;

-- =====================================
-- RPC: invite_event_member
-- HASH: 8daf6ffe549d894be0cff45cf24a6e80
-- SECURITY DEFINER: true
-- ANON EXECUTE: false
-- AUTH EXECUTE: true
-- SERVICE EXECUTE: true
-- =====================================
CREATE OR REPLACE FUNCTION public.invite_event_member(_event_id uuid, _email text, _role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  current_user_id uuid;
  v_current_role text;

  target_user_id uuid;
  target_email text;

  owner_id uuid;

  member_status text;
  existing_member public.event_members%ROWTYPE;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Bạn chưa đăng nhập.';
  END IF;

  IF _role NOT IN ('manager', 'co_owner') THEN
    RAISE EXCEPTION 'Vai trò không hợp lệ.';
  END IF;

  SELECT organizer_id
  INTO owner_id
  FROM public.events
  WHERE id = _event_id;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy sự kiện.';
  END IF;

  -- Lấy role của người đang thao tác
  v_current_role := public.get_event_role(_event_id);

  IF v_current_role IS NULL THEN
    RAISE EXCEPTION 'Bạn không có quyền quản lý sự kiện này.';
  END IF;

  -- Manager không được mời ai
  IF v_current_role = 'manager' THEN
    RAISE EXCEPTION 'Manager không có quyền mời thành viên quản lý.';
  END IF;

  -- Tìm tài khoản Joinly bằng email chính xác
  SELECT id, email
  INTO target_user_id, target_email
  FROM auth.users
  WHERE LOWER(email) = LOWER(TRIM(_email))
  LIMIT 1;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy tài khoản Joinly với email này.';
  END IF;

  -- Không tự mời chính mình
  IF target_user_id = current_user_id THEN
    RAISE EXCEPTION 'Bạn không thể tự mời chính mình.';
  END IF;

  -- Không mời Owner
  IF target_user_id = owner_id THEN
    RAISE EXCEPTION 'Tài khoản này đã là Owner của sự kiện.';
  END IF;

  -- Kiểm tra thành viên cũ
  SELECT *
  INTO existing_member
  FROM public.event_members
  WHERE event_id = _event_id
    AND user_id = target_user_id
  LIMIT 1;

  IF existing_member.id IS NOT NULL THEN
    IF existing_member.status = 'active' THEN
      RAISE EXCEPTION 'Tài khoản này đã là thành viên quản lý của sự kiện.';
    END IF;

    IF existing_member.status = 'pending' THEN
      RAISE EXCEPTION 'Tài khoản này đang có lời mời chờ duyệt.';
    END IF;
  END IF;

  -- Manager: Owner hoặc Co-owner mời đều active ngay
  IF _role = 'manager' THEN
    member_status := 'active';
  END IF;

  -- Co-owner
  IF _role = 'co_owner' THEN
    IF v_current_role = 'owner' THEN
      member_status := 'active';

    ELSIF v_current_role = 'co_owner' THEN
      member_status := 'pending';

    ELSE
      RAISE EXCEPTION 'Bạn không có quyền mời Co-owner.';
    END IF;
  END IF;

  -- Nếu user từng bị rejected thì dùng lại row cũ
  IF existing_member.id IS NOT NULL THEN
    UPDATE public.event_members
    SET
      role = _role,
      status = member_status,
      invited_by = current_user_id,
      updated_at = now()
    WHERE id = existing_member.id;

  ELSE
    INSERT INTO public.event_members (
      event_id,
      user_id,
      role,
      status,
      invited_by
    )
    VALUES (
      _event_id,
      target_user_id,
      _role,
      member_status,
      current_user_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'email', target_email,
    'role', _role,
    'status', member_status
  );
END;
$function$;

-- =====================================
-- RPC: list_event_checkin_operators
-- HASH: 8eedeeadae1307553a464e41ffdbed8d
-- SECURITY DEFINER: true
-- ANON EXECUTE: true
-- AUTH EXECUTE: true
-- SERVICE EXECUTE: true
-- =====================================
CREATE OR REPLACE FUNCTION public.list_event_checkin_operators(_event_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, role text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH permission AS (
    SELECT public.get_event_role(_event_id) AS current_role
  ),

  operators AS (
    -- Owner
    SELECT
      e.organizer_id AS user_id,
      'owner'::text AS role
    FROM public.events e
    WHERE e.id = _event_id

    UNION

    -- Co-owner + Manager
    SELECT
      em.user_id,
      em.role
    FROM public.event_members em
    WHERE em.event_id = _event_id
      AND em.role IN ('co_owner', 'manager')
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

-- =====================================
-- RPC: list_event_members
-- HASH: da112d16cebef7dd500e106855be5507
-- SECURITY DEFINER: true
-- ANON EXECUTE: false
-- AUTH EXECUTE: true
-- SERVICE EXECUTE: true
-- =====================================
CREATE OR REPLACE FUNCTION public.list_event_members(_event_id uuid)
 RETURNS TABLE(member_id uuid, user_id uuid, email text, role text, status text, invited_by uuid, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_current_role text;
BEGIN
  v_current_role := public.get_event_role(_event_id);

  -- Chỉ Owner / Co-owner được xem danh sách quản trị
  IF v_current_role IS NULL
     OR v_current_role = 'manager' THEN
    RAISE EXCEPTION 'Bạn không có quyền xem danh sách thành viên quản lý.';
  END IF;

  RETURN QUERY

  -- Owner
  SELECT
    NULL::uuid AS member_id,
    u.id AS user_id,
    u.email::text AS email,
    'owner'::text AS role,
    'active'::text AS status,
    NULL::uuid AS invited_by,
    e.created_at AS created_at
  FROM public.events e
  JOIN auth.users u
    ON u.id = e.organizer_id
  WHERE e.id = _event_id

  UNION ALL

  -- Co-owner / Manager
  SELECT
    em.id AS member_id,
    u.id AS user_id,
    u.email::text AS email,
    em.role::text AS role,
    em.status::text AS status,
    em.invited_by AS invited_by,
    em.created_at AS created_at
  FROM public.event_members em
  JOIN auth.users u
    ON u.id = em.user_id
  WHERE em.event_id = _event_id
    AND em.status IN ('active', 'pending')

  ORDER BY
    role,
    created_at;
END;
$function$;

-- =====================================
-- RPC: quiz_delete_confirmed
-- HASH: 34f4c2564bcdc79d9ce0c0b63f0cc49e
-- SECURITY DEFINER: true
-- ANON EXECUTE: false
-- AUTH EXECUTE: false
-- SERVICE EXECUTE: true
-- =====================================
CREATE OR REPLACE FUNCTION public.quiz_delete_confirmed(p_quiz_id uuid, p_confirm_active boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_has_active BOOLEAN;
BEGIN
  -- Khóa bộ Quiz trong lúc xóa.
  PERFORM 1
  FROM public.quizzes
  WHERE id = p_quiz_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUIZ_NOT_FOUND';
  END IF;

  -- Kiểm tra phiên đang mở.
  SELECT EXISTS (
    SELECT 1
    FROM public.quiz_sessions
    WHERE quiz_id = p_quiz_id
      AND status IN ('waiting', 'active', 'paused')
  )
  INTO v_has_active;

  -- Phải có xác nhận rõ ràng.
  IF v_has_active
     AND NOT COALESCE(p_confirm_active, FALSE)
  THEN
    RAISE EXCEPTION 'QUIZ_CONFIRM_ACTIVE_REQUIRED';
  END IF;

  -- Xóa câu trả lời trước để tránh
  -- ràng buộc khóa ngoại của câu hỏi.
  DELETE FROM public.quiz_answers
  WHERE quiz_id = p_quiz_id;

  -- Xóa lượt tham gia và điểm.
  DELETE FROM public.quiz_attempts
  WHERE quiz_id = p_quiz_id;

  -- Xóa mọi phiên, kể cả đang mở.
  DELETE FROM public.quiz_sessions
  WHERE quiz_id = p_quiz_id;

  -- Xóa câu hỏi.
  DELETE FROM public.quiz_questions
  WHERE quiz_id = p_quiz_id;

  -- Xóa bộ Quiz.
  DELETE FROM public.quizzes
  WHERE id = p_quiz_id;

  RETURN TRUE;
END;
$function$;

-- =====================================
-- RPC: quiz_submit_answer_received
-- HASH: 9068cdf95a703174bf1f76c9a4bd8b49
-- SECURITY DEFINER: false
-- ANON EXECUTE: false
-- AUTH EXECUTE: false
-- SERVICE EXECUTE: true
-- =====================================
CREATE OR REPLACE FUNCTION public.quiz_submit_answer_received(p_attempt_id uuid, p_token_hash text, p_question_id uuid, p_selected_index integer, p_received_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_a public.quiz_attempts%ROWTYPE;
  v_s public.quiz_sessions%ROWTYPE;
  v_q public.quiz_questions%ROWTYPE;

  v_expected UUID;
  v_elapsed NUMERIC;
  v_correct BOOLEAN;
  v_points INTEGER;

  v_prior_answers INTEGER := 0;
  v_player_total INTEGER := 1;
  v_crowd_ratio NUMERIC := 0;

  v_answered INTEGER;
  v_total INTEGER;
BEGIN

  -- 1. Kiểm tra thời điểm nhận từ server.
  -- Không lấy thời gian trực tiếp từ thiết bị người chơi.

  IF p_received_at IS NULL
     OR p_received_at > clock_timestamp() + INTERVAL '5 seconds'
     OR p_received_at < clock_timestamp() - INTERVAL '90 seconds'
  THEN
    RETURN jsonb_build_object('status', 'invalid_time');
  END IF;

  -- 2. Xác thực người chơi và khóa attempt.
  -- Ngăn hai request đồng thời cộng điểm hai lần.

  SELECT *
  INTO v_a
  FROM public.quiz_attempts
  WHERE id = p_attempt_id
    AND player_token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid_player');
  END IF;

  IF v_a.status <> 'in_progress' THEN
    RETURN jsonb_build_object('status', 'already_finished');
  END IF;

  -- 3. Kiểm tra phiên Quiz.

  SELECT *
  INTO v_s
  FROM public.quiz_sessions
  WHERE id = v_a.session_id
    AND quiz_id = v_a.quiz_id
  FOR SHARE;

  IF NOT FOUND OR v_s.status <> 'active' THEN
    RETURN jsonb_build_object('status', 'not_active');
  END IF;

  -- 4. Kiểm tra câu hỏi.

  SELECT *
  INTO v_q
  FROM public.quiz_questions
  WHERE id = p_question_id
    AND quiz_id = v_a.quiz_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid_question');
  END IF;

  IF p_selected_index IS NULL
     OR p_selected_index < 0
     OR p_selected_index >= jsonb_array_length(v_q.options)
  THEN
    RETURN jsonb_build_object('status', 'invalid_choice');
  END IF;

  -- Không cho trả lời cùng câu hai lần.

  IF EXISTS (
    SELECT 1
    FROM public.quiz_answers
    WHERE attempt_id = v_a.id
      AND question_id = p_question_id
  ) THEN
    RETURN jsonb_build_object('status', 'already_answered');
  END IF;

  -- 5. Kiểm tra tiến độ và thời gian.

  IF v_s.mode = 'live' THEN

    SELECT id
    INTO v_expected
    FROM public.quiz_questions
    WHERE quiz_id = v_a.quiz_id
    ORDER BY position, id
    OFFSET v_s.current_question
    LIMIT 1;

    IF v_expected IS DISTINCT FROM p_question_id THEN
      RETURN jsonb_build_object('status', 'wrong_question');
    END IF;

    IF v_s.question_started_at IS NULL THEN
      RETURN jsonb_build_object('status', 'not_started');
    END IF;

    IF v_s.results_revealed
       OR (
         v_s.auto_play_enabled
         AND v_s.live_phase <> 'question'
       )
    THEN
      RETURN jsonb_build_object('status', 'time_up');
    END IF;

    -- Tính từ lúc SERVER mở câu hỏi
    -- đến lúc SERVER nhận yêu cầu trả lời.

    v_elapsed := EXTRACT(
      EPOCH FROM (p_received_at - v_s.question_started_at)
    );

    IF v_elapsed < 0 THEN
      RETURN jsonb_build_object('status', 'not_started');
    END IF;

    IF v_elapsed >= v_q.time_limit_seconds THEN
      RETURN jsonb_build_object('status', 'time_up');
    END IF;

  ELSIF v_s.mode = 'self_paced' THEN

    -- Mỗi người chơi có tiến độ riêng.

    SELECT q.id
    INTO v_expected
    FROM public.quiz_questions q
    WHERE q.quiz_id = v_a.quiz_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.quiz_answers ans
        WHERE ans.attempt_id = v_a.id
          AND ans.question_id = q.id
      )
    ORDER BY q.position, q.id
    LIMIT 1;

    IF v_expected IS DISTINCT FROM p_question_id THEN
      RETURN jsonb_build_object('status', 'wrong_question');
    END IF;

  ELSE
    RETURN jsonb_build_object('status', 'invalid_mode');
  END IF;

  -- 6. Đếm số người trả lời trước.
  -- Giữ nguyên cơ chế tính điểm theo thứ tự.
  -- Cửa sổ 0,5 giây không bị ảnh hưởng bởi số này.

  IF v_s.mode = 'live'
     AND v_s.auto_play_enabled
  THEN

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_s.id::TEXT || ':' || v_q.id::TEXT,
        0
      )
    );

    SELECT COUNT(*)::INTEGER
    INTO v_prior_answers
    FROM public.quiz_answers ans
    JOIN public.quiz_attempts a
      ON a.id = ans.attempt_id
    WHERE a.session_id = v_s.id
      AND ans.question_id = v_q.id;

    v_player_total := GREATEST(
      1,
      COALESCE(v_s.scoring_player_count, 1)
    );

    v_crowd_ratio := LEAST(
      1,
      v_prior_answers::NUMERIC / v_player_total
    );

  END IF;

  -- 7. Chấm điểm.

  v_correct := p_selected_index = v_q.correct_index;

  IF NOT v_correct THEN

    v_points := 0;

  ELSIF v_s.mode = 'live'
        AND v_s.auto_play_enabled
        AND v_elapsed <= 0.5
  THEN

    -- Mọi đáp án đúng trong 0,5 giây đầu
    -- đều nhận chính xác 1000 điểm.

    v_points := 1000;

  ELSIF v_s.mode = 'live'
        AND v_s.auto_play_enabled
  THEN

    -- Sau 0,5 giây, điểm giảm theo:
    -- 1. Thời gian trả lời
    -- 2. Tỷ lệ người đã trả lời trước
    -- Giới hạn 200 - 1000 điểm.

    v_points := LEAST(
      1000,
      GREATEST(
        200,
        FLOOR(
          1000
          * GREATEST(
              0,
              1 - GREATEST(0, v_elapsed - 0.5)
                  / v_q.time_limit_seconds
            )
          * (
              1 - 0.70 * POWER(v_crowd_ratio, 2)
            )
        )::INTEGER
      )
    );

  ELSE

    -- Self-paced và Live không bật Auto Play:
    -- giữ điểm được cấu hình trong câu hỏi.

    v_points := v_q.points;

  END IF;

  -- 8. Lưu đáp án.

  INSERT INTO public.quiz_answers (
    quiz_id,
    attempt_id,
    question_id,
    selected_index,
    is_correct,
    points_earned
  )
  VALUES (
    v_a.quiz_id,
    v_a.id,
    p_question_id,
    p_selected_index,
    v_correct,
    v_points
  );

  -- 9. Cập nhật tổng điểm.

  UPDATE public.quiz_attempts
  SET
    score = score + v_points,
    correct_count = correct_count
      + CASE WHEN v_correct THEN 1 ELSE 0 END
  WHERE id = v_a.id;

  SELECT COUNT(*)::INTEGER
  INTO v_answered
  FROM public.quiz_answers
  WHERE attempt_id = v_a.id;

  SELECT COUNT(*)::INTEGER
  INTO v_total
  FROM public.quiz_questions
  WHERE quiz_id = v_a.quiz_id;

  -- Không tiết lộ đúng/sai và điểm trước Reveal.

  RETURN jsonb_build_object(
    'status', 'ok',
    'answered_count', v_answered,
    'total_questions', v_total
  );

END;
$function$;

-- =====================================
-- RPC: reject_coowner_request
-- HASH: 5f28eea7ac4485e181b1096c1a3ce662
-- SECURITY DEFINER: true
-- ANON EXECUTE: false
-- AUTH EXECUTE: true
-- SERVICE EXECUTE: true
-- =====================================
CREATE OR REPLACE FUNCTION public.reject_coowner_request(_event_id uuid, _member_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  current_user_id uuid;
  owner_id uuid;
  target_member public.event_members%ROWTYPE;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Bạn chưa đăng nhập.';
  END IF;

  SELECT organizer_id
  INTO owner_id
  FROM public.events
  WHERE id = _event_id;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy sự kiện.';
  END IF;

  IF current_user_id <> owner_id THEN
    RAISE EXCEPTION 'Chỉ Owner mới được từ chối Co-owner.';
  END IF;

  SELECT *
  INTO target_member
  FROM public.event_members
  WHERE id = _member_id
    AND event_id = _event_id
  LIMIT 1;

  IF target_member.id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy lời mời.';
  END IF;

  IF target_member.role <> 'co_owner' THEN
    RAISE EXCEPTION 'Thành viên này không phải Co-owner.';
  END IF;

  IF target_member.status <> 'pending' THEN
    RAISE EXCEPTION 'Lời mời này không ở trạng thái chờ duyệt.';
  END IF;

  UPDATE public.event_members
  SET
    status = 'rejected',
    updated_at = now()
  WHERE id = _member_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'rejected'
  );
END;
$function$;

-- =====================================
-- RPC: remove_event_member
-- HASH: 7d135af4f75825cef393406e81a990f2
-- SECURITY DEFINER: true
-- ANON EXECUTE: false
-- AUTH EXECUTE: true
-- SERVICE EXECUTE: true
-- =====================================
CREATE OR REPLACE FUNCTION public.remove_event_member(_event_id uuid, _member_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  current_user_id uuid;
  v_current_role text;
  target_member public.event_members%ROWTYPE;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Bạn chưa đăng nhập.';
  END IF;

  v_current_role := public.get_event_role(_event_id);

  -- Chỉ Owner và Co-owner được xóa thành viên
  IF v_current_role IS NULL
     OR v_current_role NOT IN ('owner', 'co_owner') THEN
    RAISE EXCEPTION 'Bạn không có quyền xóa thành viên.';
  END IF;

  -- Kiểm tra và khóa thành viên đích
  SELECT *
  INTO target_member
  FROM public.event_members
  WHERE id = _member_id
    AND event_id = _event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy thành viên.';
  END IF;

  -- Không cho xóa Owner hoặc vai trò không hợp lệ
  IF target_member.role IS NULL
     OR target_member.role NOT IN ('manager', 'co_owner') THEN
    RAISE EXCEPTION 'Không được xóa thành viên này.';
  END IF;

  -- Co-owner chỉ được xóa Manager
  IF v_current_role = 'co_owner'
     AND target_member.role <> 'manager' THEN
    RAISE EXCEPTION 'Co-owner chỉ được xóa Manager.';
  END IF;

  DELETE FROM public.event_members
  WHERE id = _member_id
    AND event_id = _event_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- =====================================
-- RPC: replace_pending_payment
-- HASH: 4785ec5be37f5521b8e94c37ea69b26c
-- SECURITY DEFINER: true
-- ANON EXECUTE: false
-- AUTH EXECUTE: false
-- SERVICE EXECUTE: true
-- =====================================
CREATE OR REPLACE FUNCTION public.replace_pending_payment(p_event_id uuid, p_user_id uuid, p_plan_code text, p_order_code text, p_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_event record;
  v_amount integer;
  v_payment public.payments%ROWTYPE;
BEGIN
  -- Khóa sự kiện để chống tạo đồng thời
  SELECT organizer_id, lifecycle_status, requested_plan_code
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_event.organizer_id IS DISTINCT FROM p_user_id
     OR v_event.lifecycle_status <> 'draft'
     OR v_event.requested_plan_code IS DISTINCT FROM p_plan_code
  THEN
    RAISE EXCEPTION 'Bản nháp không hợp lệ hoặc không có quyền.';
  END IF;

  IF p_order_code !~ '^JN[0-9]{10}$'
     OR p_expires_at <= now()
  THEN
    RAISE EXCEPTION 'Mã hoặc thời hạn thanh toán không hợp lệ.';
  END IF;

  SELECT price_vnd
  INTO v_amount
  FROM public.billing_plans
  WHERE code = p_plan_code
    AND billing_type = 'event'
    AND is_active = true;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Gói thanh toán không hợp lệ.';
  END IF;

  -- Không tạo đơn mới nếu đã ghi nhận thanh toán
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE event_id = p_event_id
      AND (
        status = 'paid'
        OR paid_at IS NOT NULL
        OR sepay_transaction_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Sự kiện đã có giao dịch cần xử lý.';
  END IF;

  -- Ngừng sử dụng các mã pending cũ
  UPDATE public.payments
  SET status = 'expired'
  WHERE event_id = p_event_id
    AND status = 'pending';

  -- Tạo đơn mới, giữ nguyên lịch sử đơn cũ
  INSERT INTO public.payments (
    user_id, event_id, plan_code,
    order_code, amount_vnd, status, expires_at
  )
  VALUES (
    p_user_id, p_event_id, p_plan_code,
    p_order_code, v_amount, 'pending', p_expires_at
  )
  RETURNING * INTO v_payment;

  RETURN jsonb_build_object(
    'id', v_payment.id,
    'order_code', v_payment.order_code,
    'amount_vnd', v_payment.amount_vnd,
    'plan_code', v_payment.plan_code,
    'event_id', v_payment.event_id,
    'status', v_payment.status,
    'expires_at', v_payment.expires_at
  );
END;
$function$;

-- =====================================
-- RPC: update_event_allowlist_settings
-- HASH: df1136cbf4b7f0ea8beb72bdc57b12e5
-- SECURITY DEFINER: true
-- ANON EXECUTE: false
-- AUTH EXECUTE: true
-- SERVICE EXECUTE: true
-- =====================================
CREATE OR REPLACE FUNCTION public.update_event_allowlist_settings(_event_id uuid, _enabled boolean DEFAULT NULL::boolean, _scope text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role text;
BEGIN
  v_role := public.get_event_role(_event_id);

  IF v_role IS NULL
     OR v_role NOT IN ('owner', 'co_owner', 'manager') THEN
    RAISE EXCEPTION 'Bạn không có quyền quản lý Allow-list.';
  END IF;

  IF _scope IS NOT NULL
     AND _scope NOT IN ('event', 'room') THEN
    RAISE EXCEPTION 'Phạm vi Allow-list không hợp lệ.';
  END IF;

  UPDATE public.events
  SET
    allowlist_enabled =
      COALESCE(_enabled, allowlist_enabled),

    allowlist_scope =
      COALESCE(_scope, allowlist_scope)

  WHERE id = _event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy sự kiện.';
  END IF;

  RETURN jsonb_build_object(
    'success', true
  );
END;
$function$;
