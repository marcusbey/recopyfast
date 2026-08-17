-- ========================================
-- Pin search_path on every SECURITY DEFINER function
-- ========================================
-- Measured 2026-08-17 against pg_proc: fifteen SECURITY DEFINER functions exist in
-- `public`, and TEN of them have `proconfig IS NULL` — no pinned search_path. The
-- other five already pin it, so this is a consistency gap, not a new policy.
--
-- WHY IT MATTERS
-- --------------
-- A SECURITY DEFINER function runs with its owner's privileges. If its search_path
-- is not pinned, it resolves unqualified names using the CALLER's search_path. Any
-- role able to create an object earlier in that path can shadow a table or function
-- the body references and have the body operate on it as the owner. Pinning to
-- `public, pg_temp` removes the caller's influence entirely.
--
-- `pg_temp` is placed LAST deliberately. If it were first, a caller could create a
-- temporary table shadowing a real one — which is the same attack this migration
-- exists to close. Every definer function written here since 20260731008000 pins
-- exactly this pair in this order; these ten predate that convention.
--
-- The ten include the ticket/credit functions (`add_tickets`, `consume_tickets`,
-- `get_user_ticket_balance`) and the content-mutation RPCs
-- (`create_content_version`, `restore_content_version`,
-- `publish_staging_content_atomic`, `publish_staging_content`,
-- `revert_staging_content`) — the paths that move money and customer copy.
--
-- ALTER FUNCTION ... SET does not touch the body, the signature, the owner or the
-- ACL. `20260805190000_lock_down_content_version_rpcs` and
-- `20260809120000_lock_down_definer_functions` already narrowed EXECUTE on these;
-- this closes the remaining half of the same hardening.
--
-- Re-runnable: SET is idempotent, and the DO block skips any signature that is
-- absent rather than failing, so this survives a schema that drifts ahead of it.
-- ========================================

-- Driven from the catalogue rather than a hardcoded signature list. A literal list
-- would need parameter TYPES (to_regprocedure rejects parameter names) and would go
-- stale the moment a signature changes — which has already happened once in this
-- schema and is what makes 20251230100000 unreplayable. `oid::regprocedure` renders
-- a correctly-quoted, always-current signature.
DO $$
DECLARE
  r      RECORD;
  v_done INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND p.proconfig IS NULL
     ORDER BY p.proname
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
    RAISE NOTICE 'pinned: %', r.sig;
    v_done := v_done + 1;
  END LOOP;

  RAISE NOTICE 'Pinned search_path on % function(s).', v_done;
END $$;

-- Postcondition: no SECURITY DEFINER function in public may be left unpinned.
-- Scoped to the whole schema on purpose — a future definer function added without a
-- pinned search_path should fail here rather than ship quietly.
DO $$
DECLARE
  v_unpinned TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_unpinned
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND p.proconfig IS NULL;

  IF v_unpinned IS NOT NULL THEN
    RAISE EXCEPTION
      'SECURITY DEFINER function(s) still without a pinned search_path: %', v_unpinned;
  END IF;
END $$;
