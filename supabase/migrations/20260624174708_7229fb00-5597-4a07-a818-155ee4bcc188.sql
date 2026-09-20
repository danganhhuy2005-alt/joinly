REVOKE EXECUTE ON FUNCTION public.get_participant_confirmation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_participant_confirmation(uuid) TO anon, authenticated;