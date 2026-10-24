-- ========================================
-- s122 — "Install detected" owner email: one send ledger row per site
-- ========================================
-- `markSiteLive` (src/lib/sites/site-status.ts) already reports the one request
-- whose guarded update flipped a site to `live`. That is the trigger. This table
-- is the second, independent guard ADR 011 asks for: the claim is written
-- BEFORE the provider call, and the primary key on `site_id` makes a second
-- claim for the same site match nothing — so a retried request, two concurrent
-- check-ins, or a site that somehow re-enters `awaiting-install` can never mail
-- the owner twice.
--
-- Not reclaimable, unlike ADR 011's digest ledger: nothing re-fires the trigger
-- after a failure, and "exactly once per site" is the requirement. A `failed`
-- row is the operator's record (status + a short error code, never an address).
--
-- Service-role only, like datafast_visitors and blog_generation_claims: no web
-- principal needs to read whether an email went out, or to plant a row that
-- would suppress one.

CREATE TABLE IF NOT EXISTS public.site_install_emails (
  site_id UUID PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  -- A short machine code ("no_owner", "provider_rejected", ...). Never a
  -- provider message, which can echo the recipient address.
  error_code TEXT CHECK (error_code IS NULL OR error_code ~ '^[a-z_]{1,64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  CONSTRAINT site_install_emails_state_consistent CHECK (
    (status = 'pending' AND sent_at IS NULL AND error_code IS NULL)
    OR (status = 'sent' AND sent_at IS NOT NULL AND error_code IS NULL)
    OR (status = 'failed' AND sent_at IS NULL AND error_code IS NOT NULL)
  )
);

COMMENT ON TABLE public.site_install_emails IS
  'Service-role-only, write-once claim per site for the s122 "Install detected" owner email; the primary key is the idempotency key.';

ALTER TABLE public.site_install_emails ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.site_install_emails
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.site_install_emails TO service_role;

DROP POLICY IF EXISTS site_install_emails_service ON public.site_install_emails;
CREATE POLICY site_install_emails_service ON public.site_install_emails
  FOR ALL TO service_role USING (true) WITH CHECK (true);
