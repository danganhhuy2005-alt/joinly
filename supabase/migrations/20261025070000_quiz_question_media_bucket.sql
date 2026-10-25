-- JOINLY | Quiz question images/GIFs — Supabase Storage
-- The Quiz server function issues a signed upload token only after
-- validating the authenticated organizer and editable Quiz.
-- This bucket must be public because Quiz currently stores getPublicUrl(...).
-- No broad public INSERT/UPDATE/DELETE policy is created here.

BEGIN;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'quiz-question-media',
  'quiz-question-media',
  TRUE,
  5242880,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;

-- Return current bucket settings to verify the migration.
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'quiz-question-media';
