-- A-21 — one open subscription checkout per user.
--
-- Two tabs can both pass getUserSubscription before either webhook writes
-- billing_subscriptions, and both get a Stripe session. This table is the
-- reservation that makes the second attempt a 409 before Stripe is called.
--
-- user_id is the primary key, so a concurrent insert is a unique violation
-- rather than a second live Checkout. Abandoned sessions age out in
-- application code (30 minutes); the row is reused rather than deleted so
-- the unique constraint never has a gap.

CREATE TABLE IF NOT EXISTS public.checkout_reservations (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  intent text NOT NULL CHECK (intent = 'subscription'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.checkout_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own checkout reservations"
  ON public.checkout_reservations;
CREATE POLICY "Users manage their own checkout reservations"
  ON public.checkout_reservations
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkout_reservations
  TO authenticated;
GRANT ALL ON public.checkout_reservations TO service_role;
