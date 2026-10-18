
BEGIN;

-- ==========================================
-- JOINLY FEEDBACK
-- BẢO TOÀN PHẢN HỒI KHI XÓA NGƯỜI THAM GIA
-- ==========================================

-- Cho phép lượt gửi không còn liên kết participant
ALTER TABLE public.feedback_submissions
ALTER COLUMN participant_id DROP NOT NULL;

-- Xóa ràng buộc cũ có ON DELETE CASCADE
ALTER TABLE public.feedback_submissions
DROP CONSTRAINT IF EXISTS
feedback_submissions_participant_id_fkey;

-- Tạo lại ràng buộc an toàn hơn
ALTER TABLE public.feedback_submissions
ADD CONSTRAINT feedback_submissions_participant_id_fkey
FOREIGN KEY (participant_id)
REFERENCES public.participants(id)
ON DELETE SET NULL;

COMMIT;
