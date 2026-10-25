-- JOINLY · Khám phá in Create/Edit + lifecycle (upcoming/live/ended)
-- Prerequisite: 20261022032000_event_discovery_opt_in.sql + 20261025030000_discover_stage1.sql
-- Safe defaults: existing events stay 'manual' & never become publicly discoverable by this migration.
BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_start_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS run_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS run_ended_at timestamptz;

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_event_start_mode_check;
ALTER TABLE public.events ADD CONSTRAINT events_event_start_mode_check
  CHECK (event_start_mode IN ('manual', 'automatic'));

-- Allows saving an owner's planned public appearance while an event is a paid draft.
-- Drafts, allowlisted events, demos and ended events never appear in public discovery RPCs.
CREATE OR REPLACE FUNCTION public.save_event_discovery_config(
  p_event_id uuid,
  p_category text,
  p_cover_path text,
  p_show_slots boolean,
  p_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_event public.events%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Vui lòng đăng nhập.'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.organizer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Chỉ Owner được chỉnh thông tin Khám phá.';
  END IF;
  IF p_category IS NULL OR p_category NOT IN (
    'technology', 'education', 'workshop', 'conference', 'business', 'arts', 'other'
  ) THEN RAISE EXCEPTION 'Chủ đề không hợp lệ.'; END IF;
  IF p_enabled IS NULL OR p_show_slots IS NULL THEN RAISE EXCEPTION 'Cấu hình không hợp lệ.'; END IF;
  IF p_cover_path IS NOT NULL AND (
    p_cover_path !~* '^[0-9a-f-]{36}/[a-z0-9-]+\.(jpg|jpeg|png|webp)$'
    OR split_part(p_cover_path, '/', 1) <> p_event_id::text
  ) THEN RAISE EXCEPTION 'Đường dẫn ảnh không hợp lệ.'; END IF;
  IF p_cover_path IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM storage.objects AS o
    WHERE o.bucket_id = 'joinly-discovery-covers' AND o.name = p_cover_path
  ) THEN RAISE EXCEPTION 'Ảnh bìa chưa tải lên.'; END IF;
  IF p_enabled AND COALESCE(v_event.is_demo, false) THEN
    RAISE EXCEPTION 'Sự kiện demo không thể công khai.';
  END IF;
  IF p_enabled AND COALESCE(v_event.allowlist_enabled, false) THEN
    RAISE EXCEPTION 'Tắt Allow-list trước khi công khai sự kiện.';
  END IF;
  IF p_enabled AND v_event.run_ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Sự kiện đã kết thúc không thể công khai.';
  END IF;
  UPDATE public.events SET
    discovery_enabled = p_enabled,
    discovery_category = p_category,
    discovery_cover_path = p_cover_path,
    discovery_show_slots = p_show_slots
  WHERE id = p_event_id;
  RETURN jsonb_build_object('success',true,'discovery_enabled',p_enabled);
END;
$fn$;
REVOKE ALL ON FUNCTION public.save_event_discovery_config(uuid,text,text,boolean,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_event_discovery_config(uuid,text,text,boolean,boolean)
  TO authenticated, service_role;

-- A manual start mode is the default. An automatic event becomes LIVE at starts_at
-- without requiring cron, websocket or an open browser. This function is authoritative
-- for management state; payment's lifecycle_status is deliberately untouched.
CREATE OR REPLACE FUNCTION public.get_event_run_state(p_event_id uuid)
RETURNS TABLE (status text, mode text, scheduled_at timestamptz,
  started_at timestamptz, ended_at timestamptz, is_active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_event public.events%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(public.get_event_role(p_event_id), '') NOT IN ('owner','co_owner','manager') THEN
    RAISE EXCEPTION 'Bạn không có quyền xem trạng thái vận hành.';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy sự kiện.'; END IF;
  RETURN QUERY SELECT
    CASE WHEN v_event.run_ended_at IS NOT NULL THEN 'ended'
      WHEN v_event.lifecycle_status = 'active' AND (
        v_event.run_started_at IS NOT NULL OR
        (v_event.event_start_mode = 'automatic' AND v_event.starts_at IS NOT NULL AND v_event.starts_at <= now())
      ) THEN 'live'
      ELSE 'upcoming' END::text,
    v_event.event_start_mode::text,
    v_event.starts_at,
    v_event.run_started_at,
    v_event.run_ended_at,
    (v_event.lifecycle_status = 'active');
END;
$fn$;