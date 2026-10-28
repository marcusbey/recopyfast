-- ========================================
-- s125 — credit_purchases column boundary and copy_styles preset boundary
-- ========================================
-- Source: docs/reviews/security-audit-2026-10.md, findings H1 and M1.
-- Decisions: ADR 033 (a column grant does not subtract a table grant, so the
-- table-level REVOKE comes first), ADR 042 (writes are service-role only, here
-- extended to copy_styles), ADR 075 (a web role's write to a billing row is
-- column-scoped and trigger-pinned).
--
-- Idempotent and safe to replay: every statement either converges
-- (REVOKE/GRANT, CREATE OR REPLACE, DROP ... IF EXISTS) or is guarded.
-- No existing row is deleted or updated.

-- ----------------------------------------
-- 1. credit_purchases (H1)
-- ----------------------------------------
-- `authenticated` held table-wide UPDATE (Supabase default grants), so a buyer
-- could rewrite `stripe_payment_intent_id` and the refund / dispute clawback,
-- which looks the row up by that column, found nothing to claw back. The only
-- web-role writer is the SECURITY INVOKER `spend_credits`, which locks the row
-- (`FOR UPDATE` needs UPDATE on at least one column) and decrements
-- `credits_remaining`. That one column is all it gets back. TRUNCATE,
-- REFERENCES and TRIGGER go too (ADR 042/034/047): TRUNCATE ignores RLS and
-- fires no row trigger, so it would bypass both walls below.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.credit_purchases
  FROM PUBLIC, anon, authenticated;
GRANT UPDATE (credits_remaining) ON public.credit_purchases TO authenticated;

-- Second wall: even if a broader grant comes back (a Supabase default, a
-- hand-run GRANT), a non-service role may change `credits_remaining` only, and
-- only downwards. The jsonb diff covers every column, including ones added
-- later, with no list to maintain. The exemption set and the search_path are
-- unchanged from 20260731003000 (not SECURITY DEFINER).
CREATE OR REPLACE FUNCTION enforce_credit_purchase_monotonicity()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    IF to_jsonb(NEW) - 'credits_remaining'
       IS DISTINCT FROM to_jsonb(OLD) - 'credits_remaining' THEN
      RAISE EXCEPTION 'credit_purchases: only credits_remaining may change (non-service role)';
    END IF;
    IF NEW.credits_remaining > OLD.credits_remaining THEN
      RAISE EXCEPTION 'credit_purchases.credits_remaining may only decrease (attempted % -> %)',
        OLD.credits_remaining, NEW.credits_remaining;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------
-- 2. copy_styles (M1)
-- ----------------------------------------
-- The member INSERT policy never constrained `is_preset`, so a site admin could
-- plant a "preset" every tenant's Edit Board lists and can apply. No
-- application code writes copy_styles as a web role (styles/route.ts and
-- styles/apply/route.ts use the service role), so web-role writes go entirely,
-- as ADR 042 did for content tables. Both SELECT policies stay.
DROP POLICY IF EXISTS "Site admins can create styles" ON public.copy_styles;
DROP POLICY IF EXISTS "Site admins can update styles" ON public.copy_styles;
DROP POLICY IF EXISTS "Site admins can delete styles" ON public.copy_styles;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.copy_styles
  FROM PUBLIC, anon, authenticated;

-- A preset is global and a global style is a preset, for every writer. IS NOT
-- DISTINCT FROM because `is_preset` is nullable: a plain `=` would let NULL
-- through. Added NOT VALID so a row already planted in production cannot fail
-- the deploy; validated below only when no row violates it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.copy_styles'::regclass
       AND conname = 'copy_styles_preset_is_global'
  ) THEN
    ALTER TABLE public.copy_styles
      ADD CONSTRAINT copy_styles_preset_is_global
      CHECK (is_preset IS NOT DISTINCT FROM (site_id IS NULL)) NOT VALID;
  END IF;
END;
$$;

-- Existing rows are reported, never deleted (story s125). A violating row is
-- left in place for the owner to inspect, and the constraint stays NOT VALID:
-- it still holds for every new or updated row.
DO $$
DECLARE
  v_violations INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_violations
    FROM public.copy_styles
   WHERE is_preset IS DISTINCT FROM (site_id IS NULL);

  IF v_violations = 0 THEN
    ALTER TABLE public.copy_styles
      VALIDATE CONSTRAINT copy_styles_preset_is_global;
  ELSE
    RAISE WARNING 'copy_styles: % row(s) violate copy_styles_preset_is_global (is_preset must equal site_id IS NULL); left in place and the constraint left NOT VALID — inspect them before validating',
      v_violations;
  END IF;
END;
$$;
