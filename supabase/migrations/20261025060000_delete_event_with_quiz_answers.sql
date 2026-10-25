-- JOINLY | Xóa sự kiện có Quiz không bị vướng khóa ngoại
-- Chạy một lần trên Supabase SQL Editor, dùng tài khoản quản trị database.
-- Không thay đổi quyền xóa sự kiện: RLS trên events vẫn chỉ cho phép Owner.
BEGIN;

CREATE OR REPLACE FUNCTION public.joinly_cleanup_quiz_answers_before_event_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- quiz_answers tham chiếu quiz_questions mà không có ON DELETE CASCADE.
  -- Xóa câu trả lời trước khi CASCADE từ events -> quizzes -> quiz_questions.
  -- Chỉ đụng đến câu trả lời của Quiz thuộc đúng event đang bị xóa.
  DELETE FROM public.quiz_answers AS answer
  WHERE EXISTS (
    SELECT 1
    FROM public.quizzes AS quiz
    WHERE quiz.id = answer.quiz_id
      AND quiz.event_id = OLD.id
  );

  RETURN OLD;
END;
$function$;

-- Function dùng bởi trigger, không mở quyền gọi trực tiếp cho client.
REVOKE ALL ON FUNCTION public.joinly_cleanup_quiz_answers_before_event_delete()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS joinly_cleanup_quiz_answers_before_event_delete
ON public.events;

CREATE TRIGGER joinly_cleanup_quiz_answers_before_event_delete
BEFORE DELETE ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.joinly_cleanup_quiz_answers_before_event_delete();

COMMIT;
