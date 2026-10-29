-- Joinly | Up to 5 private screenshots per bug report.
-- Requires: 20261029190000_platform_review_and_bug_reports.sql
-- Keeps screenshot_path for backwards compatibility with previously submitted reports.
BEGIN;

ALTER TABLE public.platform_bug_reports
  ADD COLUMN IF NOT EXISTS screenshot_paths text[] NOT NULL DEFAULT ARRAY[]::text[];

-- Preserve reports created with the old one-image version.
UPDATE public.platform_bug_reports
SET screenshot_paths = ARRAY[screenshot_path]
WHERE screenshot_path IS NOT NULL
  AND cardinality(screenshot_paths) = 0;

-- Immutable check function used by the constraint. Accepts only paths belonging to
-- this report's owner in the existing private Storage bucket layout.
CREATE OR REPLACE FUNCTION public.joinly_valid_bug_screenshot_paths(
  p_paths text[], p_user_id uuid
) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT p_paths IS NOT NULL
    AND cardinality(p_paths) <= 5
    AND NOT EXISTS (
      SELECT 1 FROM unnest(p_paths) AS p(path)
      WHERE p.path IS NULL
         OR split_part(p.path, '/', 1) <> p_user_id::text
         OR p.path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](png|jpg|webp)$'
    )
    AND cardinality(p_paths) = (
      SELECT count(DISTINCT p.path) FROM unnest(p_paths) AS p(path)
    );
$fn$;

ALTER TABLE public.platform_bug_reports
  DROP CONSTRAINT IF EXISTS platform_bug_screenshot_paths_owner;
ALTER TABLE public.platform_bug_reports
  ADD CONSTRAINT platform_bug_screenshot_paths_owner
  CHECK (public.joinly_valid_bug_screenshot_paths(screenshot_paths, user_id));

-- Do not change Storage policies: uploads remain private, confined to each user's folder.
-- Per-object limit stays 5 MiB; the new limit is 5 objects per report.
NOTIFY pgrst, 'reload schema';
COMMIT;
