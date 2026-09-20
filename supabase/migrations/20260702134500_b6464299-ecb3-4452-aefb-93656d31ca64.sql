
-- Remove anonymous INSERT capability on participants; inserts go through
-- a server function using the service role (which validates input and
-- generates the confirmation_token server-side).
DROP POLICY IF EXISTS "Anyone can register as participant" ON public.participants;
REVOKE INSERT ON public.participants FROM anon;
