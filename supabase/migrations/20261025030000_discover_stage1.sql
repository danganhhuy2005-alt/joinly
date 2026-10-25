-- JOINLY / Discover stage 1: opt-in event cover, category and optional availability.
-- IMPORTANT: Owner uploads the public cover. Never expose participant records.
-- Run ONLY after the previous 20261022032000 Event Discovery migration.
BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS discovery_category text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS discovery_cover_path text,
  ADD COLUMN IF NOT EXISTS discovery_show_slots boolean NOT NULL DEFAULT false;

-- Constrain current and future values, without requiring edits to older events.
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_discovery_category_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_discovery_category_check
  CHECK (discovery_category IN ('technology', 'education', 'workshop',
    'conference', 'business', 'arts', 'other'));

-- Covers are intentionally public assets; no registration data is stored here.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('joinly-discovery-covers', 'joinly-discovery-covers', true,
        5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

DROP POLICY IF EXISTS "joinly_discovery_covers_insert_owner" ON storage.objects;
CREATE POLICY "joinly_discovery_covers_insert_owner"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'joinly-discovery-covers'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1 FROM public.events AS e
    WHERE e.id::text = (storage.foldername(name))[1]
      AND e.organizer_id = (SELECT auth.uid())
  )
);

-- Supabase Storage remove() also needs owner SELECT permission.
DROP POLICY IF EXISTS "joinly_discovery_covers_select_owner" ON storage.objects;
CREATE POLICY "joinly_discovery_covers_select_owner"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'joinly-discovery-covers'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1 FROM public.events AS e
    WHERE e.id::text = (storage.foldername(name))[1]
      AND e.organizer_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "joinly_discovery_covers_delete_owner" ON storage.objects;
CREATE POLICY "joinly_discovery_covers_delete_owner"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'joinly-discovery-covers'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1 FROM public.events AS e
    WHERE e.id::text = (storage.foldername(name))[1]
      AND e.organizer_id = (SELECT auth.uid())
  )
);

CREATE OR REPLACE FUNCTION public.set_event_discovery_details(
  p_event_id uuid, p_category text, p_cover_path text, p_show_slots boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_event public.events%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Vui lòng đăng nhập.'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.organizer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Chỉ Owner mới được sửa thông tin Khám phá.';
  END IF;
  IF p_category IS NULL OR p_category NOT IN
    ('technology','education','workshop','conference','business','arts','other') THEN
    RAISE EXCEPTION 'Chủ đề sự kiện không hợp lệ.';
  END IF;
  IF p_show_slots IS NULL THEN RAISE EXCEPTION 'Cấu hình số suất không hợp lệ.'; END IF;
  IF p_cover_path IS NOT NULL AND (
     p_cover_path !~* '^[0-9a-f-]{36}/[a-z0-9-]+\.(jpg|jpeg|png|webp)$'
     OR split_part(p_cover_path, '/', 1) <> p_event_id::text
  ) THEN
    RAISE EXCEPTION 'Đường dẫn ảnh bìa không hợp lệ.';
  END IF;
  IF p_cover_path IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'joinly-discovery-covers'
      AND o.name = p_cover_path
  ) THEN
    RAISE EXCEPTION 'Ảnh bìa chưa được tải lên.';
  END IF;
  UPDATE public.events SET
    discovery_category = p_category,
    discovery_cover_path = p_cover_path,
    discovery_show_slots = p_show_slots
  WHERE id = p_event_id;
  RETURN jsonb_build_object('success', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_event_discovery_details(uuid,text,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_discovery_details(uuid,text,text,boolean)
  TO authenticated, service_role;

-- Both list and detailed discovery views use the same rules as the original
-- opt-in RPC, even if owners forget to turn off the switch later.
DROP FUNCTION IF EXISTS public.list_discoverable_events();
CREATE FUNCTION public.list_discoverable_events()
RETURNS TABLE (
  id uuid, name text, description text, location text, starts_at timestamptz,
  discovery_category text, discovery_cover_path text, remaining_seats integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT e.id, e.name, e.description, e.location, e.starts_at,
         e.discovery_category, e.discovery_cover_path,
         CASE WHEN e.discovery_show_slots THEN
           GREATEST(0, e.attendee_limit - (
             SELECT COUNT(DISTINCT lower(btrim(p.email)))::integer
             FROM public.participants p WHERE p.event_id = e.id
           ))
         ELSE NULL END AS remaining_seats
  FROM public.events AS e
  WHERE e.discovery_enabled = true
    AND e.lifecycle_status = 'active'
    AND NOT COALESCE(e.is_demo, false)
    AND NOT COALESCE(e.allowlist_enabled, false)
    AND e.starts_at > now()
  ORDER BY e.starts_at ASC, e.id ASC LIMIT 100;
$function$;
REVOKE ALL ON FUNCTION public.list_discoverable_events()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_discoverable_events()
  TO anon, authenticated, service_role;

-- Public marketing details are only readable for discoverable events.
CREATE OR REPLACE FUNCTION public.get_discoverable_event(p_event_id uuid)
RETURNS TABLE (
  id uuid, name text, description text, location text, starts_at timestamptz,
  discovery_category text, discovery_cover_path text, remaining_seats integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT e.id, e.name, e.description, e.location, e.starts_at,
         e.discovery_category, e.discovery_cover_path,
         CASE WHEN e.discovery_show_slots THEN
           GREATEST(0, e.attendee_limit - (
             SELECT COUNT(DISTINCT lower(btrim(p.email)))::integer
             FROM public.participants p WHERE p.event_id = e.id
           ))
         ELSE NULL END AS remaining_seats
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.discovery_enabled = true
    AND e.lifecycle_status = 'active'
    AND NOT COALESCE(e.is_demo, false)
    AND NOT COALESCE(e.allowlist_enabled, false)
    AND e.starts_at > now()
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.get_discoverable_event(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_discoverable_event(uuid)
  TO anon, authenticated, service_role;

COMMIT;
