-- ADR 074: the account's latest DataFast visitor id, for the two server goals
-- whose request carries no cookie of ours (the embed check-in and the widget's
-- publish arrive from the customer's domain). Written only by the auth
-- callback/confirm routes through the service role, and only once
-- DATAFAST_API_KEY is set. Not a ledger: one row per account, overwritten by
-- each verified sign-in, deleted with the account.
--
-- Service-role only, like analytics_contexts: no web principal may read which
-- visitor an account is, or plant one for another account.
CREATE TABLE IF NOT EXISTS public.datafast_visitors (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  visitor_id text NOT NULL CHECK (visitor_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.datafast_visitors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.datafast_visitors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.datafast_visitors TO service_role;
DROP POLICY IF EXISTS datafast_visitors_service ON public.datafast_visitors;
CREATE POLICY datafast_visitors_service ON public.datafast_visitors
  FOR ALL TO service_role USING (true) WITH CHECK (true);
