-- Joinly: separate platform website reviews and platform bug reports.
-- Run in Supabase SQL Editor as a database owner. No administrator is seeded automatically.
BEGIN;

CREATE TABLE IF NOT EXISTS public.joinly_platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.joinly_platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.joinly_platform_admins FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.joinly_platform_admins TO authenticated;
DROP POLICY IF EXISTS platform_admin_read_self ON public.joinly_platform_admins;
CREATE POLICY platform_admin_read_self ON public.joinly_platform_admins
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- SECURITY DEFINER checks a non-editable server-side allow-list. Members can't add themselves.
CREATE OR REPLACE FUNCTION public.is_joinly_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.joinly_platform_admins a
    WHERE a.user_id = (SELECT auth.uid())
  );
$fn$;
REVOKE ALL ON FUNCTION public.is_joinly_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_joinly_platform_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS public.platform_reviews (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  website_rating smallint NOT NULL CHECK (website_rating BETWEEN 1 AND 5),
  ui_rating smallint CHECK (ui_rating BETWEEN 1 AND 5),
  performance_rating smallint CHECK (performance_rating BETWEEN 1 AND 5),
  features_rating smallint CHECK (features_rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 3000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_reviews ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.platform_reviews TO authenticated;
REVOKE ALL ON public.platform_reviews FROM anon;
DROP POLICY IF EXISTS platform_reviews_read ON public.platform_reviews;
DROP POLICY IF EXISTS platform_reviews_insert ON public.platform_reviews;
DROP POLICY IF EXISTS platform_reviews_update ON public.platform_reviews;
CREATE POLICY platform_reviews_read ON public.platform_reviews
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_joinly_platform_admin()));
CREATE POLICY platform_reviews_insert ON public.platform_reviews
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY platform_reviews_update ON public.platform_reviews
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.platform_bug_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 8 AND 140),
  area text NOT NULL CHECK (area IN ('event_creation','event_management','qr','quiz','payment','dashboard','other')),
  description text NOT NULL CHECK (char_length(description) BETWEEN 20 AND 5000),
  steps_to_reproduce text CHECK (steps_to_reproduce IS NULL OR char_length(steps_to_reproduce) <= 3000),
  screenshot_path text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','resolved','closed')),
  admin_response text CHECK (admin_response IS NULL OR char_length(admin_response) <= 3000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_bug_screenshot_owner CHECK (
    screenshot_path IS NULL OR
    (split_part(screenshot_path, '/', 1) = user_id::text AND
     screenshot_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](png|jpg|webp)$')
  )
);
CREATE INDEX IF NOT EXISTS platform_bug_reports_by_user ON public.platform_bug_reports(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_bug_reports_by_status ON public.platform_bug_reports(status, created_at DESC);
ALTER TABLE public.platform_bug_reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.platform_bug_reports TO authenticated;
REVOKE ALL ON public.platform_bug_reports FROM anon;
DROP POLICY IF EXISTS platform_bugs_read ON public.platform_bug_reports;
DROP POLICY IF EXISTS platform_bugs_insert ON public.platform_bug_reports;
DROP POLICY IF EXISTS platform_bugs_admin_update ON public.platform_bug_reports;
CREATE POLICY platform_bugs_read ON public.platform_bug_reports
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_joinly_platform_admin()));
CREATE POLICY platform_bugs_insert ON public.platform_bug_reports
  FOR INSERT TO authenticated WITH CHECK (
    user_id = (SELECT auth.uid()) AND status = 'new' AND admin_response IS NULL
  );
CREATE POLICY platform_bugs_admin_update ON public.platform_bug_reports
  FOR UPDATE TO authenticated USING ((SELECT public.is_joinly_platform_admin()))
  WITH CHECK ((SELECT public.is_joinly_platform_admin()));

CREATE OR REPLACE FUNCTION public.joinly_platform_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS platform_review_updated_at ON public.platform_reviews;
CREATE TRIGGER platform_review_updated_at BEFORE UPDATE ON public.platform_reviews
  FOR EACH ROW EXECUTE FUNCTION public.joinly_platform_touch_updated_at();
DROP TRIGGER IF EXISTS platform_bug_updated_at ON public.platform_bug_reports;
CREATE TRIGGER platform_bug_updated_at BEFORE UPDATE ON public.platform_bug_reports
  FOR EACH ROW EXECUTE FUNCTION public.joinly_platform_touch_updated_at();

-- Screenshots are private. A user can access only their own folder; platform admins can view for triage.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('joinly-platform-bug-images', 'joinly-platform-bug-images', false, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS joinly_bug_image_upload ON storage.objects;
DROP POLICY IF EXISTS joinly_bug_image_read ON storage.objects;
DROP POLICY IF EXISTS joinly_bug_image_delete ON storage.objects;
CREATE POLICY joinly_bug_image_upload ON storage.objects
 FOR INSERT TO authenticated WITH CHECK (
   bucket_id = 'joinly-platform-bug-images'
   AND (SELECT auth.uid())::text = split_part(name, '/', 1)
 );
CREATE POLICY joinly_bug_image_read ON storage.objects
 FOR SELECT TO authenticated USING (
   bucket_id = 'joinly-platform-bug-images'
   AND ((SELECT auth.uid())::text = split_part(name, '/', 1) OR (SELECT public.is_joinly_platform_admin()))
 );
CREATE POLICY joinly_bug_image_delete ON storage.objects
 FOR DELETE TO authenticated USING (
   bucket_id = 'joinly-platform-bug-images'
   AND (SELECT auth.uid())::text = split_part(name, '/', 1)
 );

NOTIFY pgrst, 'reload schema';
COMMIT;

-- After successful migration, use SQL Editor once to grant platform admin:
-- INSERT INTO public.joinly_platform_admins(user_id)
-- SELECT id FROM auth.users WHERE email = 'YOUR_GOOGLE_EMAIL@example.com'
-- ON CONFLICT (user_id) DO NOTHING;
-- Do NOT add ordinary organizers to this table.
