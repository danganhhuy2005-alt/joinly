-- ============================================
-- JOINLY AVATAR STORAGE
-- ============================================

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152, -- 2MB
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ============================================
-- XEM AVATAR
-- ============================================

CREATE POLICY "Public can view avatars"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'avatars'
);


-- ============================================
-- USER CHỈ UPLOAD VÀO THƯ MỤC CỦA MÌNH
--
-- avatars/
--    user-id/
--       avatar.webp
-- ============================================

CREATE POLICY "Users can upload own avatar"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);


-- ============================================
-- USER CHỈ UPDATE AVATAR CỦA MÌNH
-- ============================================

CREATE POLICY "Users can update own avatar"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);


-- ============================================
-- USER CHỈ XÓA AVATAR CỦA MÌNH
-- ============================================

CREATE POLICY "Users can delete own avatar"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);