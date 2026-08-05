-- billing_customers: state the policy production actually enforces.
--
-- `20250817000000` created this table with
--   CREATE POLICY ... ON billing_customers FOR ALL USING (user_id = auth.uid());
-- and Postgres reuses a FOR ALL policy's USING expression as its WITH CHECK, so
-- that definition permits an authenticated user to INSERT their own row.
-- Production does not: an INSERT under a user token is rejected 42501, verified
-- against the live database through PostgREST. The repo and the deployed schema
-- disagreed, so a fresh environment let checkout through and production did not
-- -- the schema-versus-code inversion this project has already been bitten by.
--
-- Resolve it towards production rather than away from it, because production is
-- also the correct answer. `billing_payment_methods` and `billing_invoices` were
-- hardened to user-reads / service-role-writes in `20260611010000`; billing rows
-- are written by the server after it has talked to Stripe, never by a browser
-- holding a user token. This brings the customer table into that same shape.
--
-- Idempotent: safe to run against a database that is already in this state.

ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;

-- Replaces the FOR ALL policy. Named as in 20250817000000 so the drop matches
-- whichever of the two definitions a given environment happens to hold.
DROP POLICY IF EXISTS "Users can view their own billing info" ON billing_customers;

CREATE POLICY "Users can view their own billing info"
  ON billing_customers
  FOR SELECT
  USING (user_id = auth.uid());

-- Enrolment is a server action: createOrGetCustomer opens the Stripe customer
-- and records it in the same call, under the service role.
DROP POLICY IF EXISTS "Service role can manage billing customers" ON billing_customers;

CREATE POLICY "Service role can manage billing customers"
  ON billing_customers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
