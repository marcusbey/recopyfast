-- ========================================
-- RLS Hardening: Enable RLS + isolating policies
-- ========================================
-- Fix: billing_payment_methods, billing_invoices, billing_tickets,
--      billing_ticket_usage, team_activity, collaboration_sessions,
--      security_events, and rate_limits were missing RLS entirely.
-- All tables receive ENABLE ROW LEVEL SECURITY plus:
--   • user-scoped tables  → USING (user_id = auth.uid())
--   • site-scoped tables  → USING (EXISTS (SELECT 1 FROM site_permissions …))
--   • service-only write paths (security_events, rate_limits, billing_*)
--     receive separate INSERT/UPDATE policies scoped TO service_role so
--     the application backend can still write via the service-role key.
-- This migration is idempotent: policies use CREATE POLICY IF NOT EXISTS
-- and ALTER TABLE … ENABLE ROW LEVEL SECURITY is safe to re-run.

-- ============================================================
-- billing_payment_methods
-- (customer_id → billing_customers.user_id chain)
-- ============================================================
ALTER TABLE billing_payment_methods ENABLE ROW LEVEL SECURITY;

-- Users can read their own payment methods
CREATE POLICY IF NOT EXISTS "Users can view their own payment methods"
  ON billing_payment_methods
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM billing_customers bc
      WHERE bc.id = billing_payment_methods.customer_id
        AND bc.user_id = auth.uid()
    )
  );

-- Only service role may insert/update payment method records
CREATE POLICY IF NOT EXISTS "Service role can manage payment methods"
  ON billing_payment_methods
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can update payment methods"
  ON billing_payment_methods
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can delete payment methods"
  ON billing_payment_methods
  FOR DELETE
  TO service_role
  USING (true);

-- ============================================================
-- billing_invoices
-- (customer_id → billing_customers.user_id chain)
-- ============================================================
ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can view their own invoices"
  ON billing_invoices
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM billing_customers bc
      WHERE bc.id = billing_invoices.customer_id
        AND bc.user_id = auth.uid()
    )
  );

CREATE POLICY IF NOT EXISTS "Service role can manage invoices"
  ON billing_invoices
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can update invoices"
  ON billing_invoices
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can delete invoices"
  ON billing_invoices
  FOR DELETE
  TO service_role
  USING (true);

-- ============================================================
-- billing_tickets  (user_id column)
-- ============================================================
ALTER TABLE billing_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can view their own tickets"
  ON billing_tickets
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "Service role can manage tickets"
  ON billing_tickets
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can update tickets"
  ON billing_tickets
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can delete tickets"
  ON billing_tickets
  FOR DELETE
  TO service_role
  USING (true);

-- ============================================================
-- billing_ticket_usage  (user_id column)
-- ============================================================
ALTER TABLE billing_ticket_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can view their own ticket usage"
  ON billing_ticket_usage
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "Service role can manage ticket usage"
  ON billing_ticket_usage
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can update ticket usage"
  ON billing_ticket_usage
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- team_activity  (team_id; also has user_id for who acted)
-- Access: any member of the team may read; writes are service_role only.
-- ============================================================
ALTER TABLE team_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Team members can view team activity"
  ON team_activity
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = team_activity.team_id
        AND tm.user_id = auth.uid()
    )
  );

CREATE POLICY IF NOT EXISTS "Service role can insert team activity"
  ON team_activity
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================================
-- collaboration_sessions  (site_id + user_id)
-- ============================================================
ALTER TABLE collaboration_sessions ENABLE ROW LEVEL SECURITY;

-- Users can read sessions for sites they have access to
CREATE POLICY IF NOT EXISTS "Site members can view collaboration sessions"
  ON collaboration_sessions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = collaboration_sessions.site_id
        AND sp.user_id = auth.uid()
    )
  );

-- Users can manage their own session row
CREATE POLICY IF NOT EXISTS "Users can manage their own collaboration session"
  ON collaboration_sessions
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- security_events  (user_id nullable; written only by backend)
-- ============================================================
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;

-- Admins / own-user can read events referencing them
CREATE POLICY IF NOT EXISTS "Users can view their own security events"
  ON security_events
  FOR SELECT
  USING (user_id = auth.uid());

-- Only the service role inserts security events
CREATE POLICY IF NOT EXISTS "Service role can insert security events"
  ON security_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================================
-- rate_limits  (no user_id; purely internal tracking)
-- ============================================================
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- No rows should be readable by regular authenticated users —
-- the service role manages this table exclusively.
CREATE POLICY IF NOT EXISTS "Service role can manage rate limits"
  ON rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
