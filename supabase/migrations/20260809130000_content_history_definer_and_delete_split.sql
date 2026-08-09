-- ========================================
-- A-35 — deleting a site with any content in it cannot succeed
-- A-13 (code side) — the audit trigger writes as whoever is calling
-- ========================================
-- Both defects live in one trigger, so one migration closes both.
--
-- A-35, THE DELETE IS IMPOSSIBLE
-- ------------------------------
-- `content_change_trigger` is declared AFTER INSERT OR UPDATE OR DELETE on
-- `content_elements` (20250817000000_complete_database_setup.sql:542-544). Its
-- DELETE branch inserts a row into `content_history`, whose FK is
--
--   content_element_id UUID REFERENCES content_elements(id) ON DELETE CASCADE
--                                                  (20250817000000:44)
--
-- AFTER DELETE means the parent row is already gone when that insert runs, so the
-- FK cannot be satisfied and every content element delete raises:
--
--   ERROR: insert or update on table "content_history" violates foreign key
--          constraint "content_history_content_element_id_fkey"
--   CONTEXT: PL/pgSQL function log_content_change() line 10
--
-- `content_elements.site_id REFERENCES sites(id) ON DELETE CASCADE`
-- (20250817000000:28) inherits the failure, so `DELETE FROM sites` fails for any
-- site that holds content — which is every site anybody has actually installed
-- the widget on, since installing it is what creates the rows. Measured against a
-- scratch database, not inferred (docs/QA-PRODUCTION-AUDIT-2026-08-07.md, A-35).
-- A site with no content elements deletes cleanly, because the cascade finds
-- nothing and the function never runs; that is a registered-but-never-installed
-- site and the exception rather than the case that matters.
--
-- The fix is the trigger's timing, not its body. Splitting DELETE onto a BEFORE
-- trigger runs the history insert while the parent row still exists, so the FK
-- holds. INSERT and UPDATE stay on AFTER, where they were already correct.
--
-- What that produces, stated exactly, because it is not what one might expect:
-- the delete-branch history row IS written, and is then immediately removed by
-- the same ON DELETE CASCADE, in the same statement. So a successful delete
-- leaves no history behind. That is the schema's own design decision — a table
-- whose rows cascade away with their parent cannot retain a tombstone for it —
-- and this migration deliberately does not change it. Making the delete record
-- outlive the element would mean dropping the cascade or nulling the FK, which is
-- a data-retention decision with its own RLS and reporting consequences, and is
-- not required to let a customer delete their own site.
--
-- A-13, THE TRIGGER WRITES AS THE INVOKER
-- ---------------------------------------
-- `log_content_change()` was declared without SECURITY DEFINER (20250817000000:524),
-- so its `INSERT INTO content_history` is judged against the policies of whoever
-- fired it. Both callers use the anon-key user client, i.e. the `authenticated`
-- role: src/app/api/bulk/update/route.ts:20-30 and
-- src/app/api/ai/translate/route.ts:142. The only migration granting
-- `authenticated` INSERT on `content_history` is
-- 20260731008000_rls_policies_for_locked_tables.sql:337-348 — the one recorded as
-- aborted in production; 20260804130000 restores SELECT and the service_role
-- policy but not that INSERT.
--
-- An `AFTER ... FOR EACH ROW` refusal aborts the statement that fired it, so if
-- the policy really is absent in production then every bulk find-and-replace and
-- every AI translation is dead, and the route reports it as a per-element error
-- rather than a systemic one. Whether it is absent is B-3 and is not answerable
-- from this repository — which is the point of fixing it this way. SECURITY
-- DEFINER makes the audit write run as the function's owner, so the answer to
-- B-3 stops mattering: the trigger no longer depends on the caller's policy set
-- at all.
--
-- `SET search_path = public, pg_temp` is not optional on a SECURITY DEFINER
-- function — without it a caller-controlled `search_path` chooses which
-- `content_history` gets written. Same form as the RLS predicates in
-- 20260731008000:33-42.

CREATE OR REPLACE FUNCTION log_content_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO content_history (content_element_id, content, changed_by, change_type)
    VALUES (NEW.id, NEW.current_content, auth.uid(), 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.current_content IS DISTINCT FROM NEW.current_content THEN
    INSERT INTO content_history (content_element_id, content, changed_by, change_type)
    VALUES (NEW.id, NEW.current_content, auth.uid(), 'update');
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO content_history (content_element_id, content, changed_by, change_type)
    VALUES (OLD.id, OLD.current_content, auth.uid(), 'delete');
  END IF;
  -- BEFORE DELETE now reaches this line, and there a NULL return would CANCEL
  -- the delete. NEW is NULL on DELETE, so COALESCE yields OLD and the delete
  -- proceeds. On the AFTER trigger the return value is ignored either way.
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ----------------------------------------
-- Split the trigger by timing
-- ----------------------------------------
-- One function, two triggers, because a single trigger cannot be BEFORE for one
-- event and AFTER for another. INSERT and UPDATE must stay AFTER: they record the
-- row as it was actually committed, and a BEFORE trigger would log values a later
-- BEFORE trigger could still change.
DROP TRIGGER IF EXISTS content_change_trigger ON content_elements;
DROP TRIGGER IF EXISTS content_change_delete_trigger ON content_elements;

CREATE TRIGGER content_change_trigger
  AFTER INSERT OR UPDATE ON content_elements
  FOR EACH ROW EXECUTE FUNCTION log_content_change();

CREATE TRIGGER content_change_delete_trigger
  BEFORE DELETE ON content_elements
  FOR EACH ROW EXECUTE FUNCTION log_content_change();

-- ----------------------------------------
-- Keep the new SECURITY DEFINER function off the anon key
-- ----------------------------------------
-- Adding SECURITY DEFINER above puts this function in scope for the A-3/A-5
-- invariant (src/__tests__/db/function-grants.test.ts), which forbids EXECUTE to
-- `anon` and PUBLIC on every SECURITY DEFINER function in `public` — and Supabase's
-- default privileges granted exactly that when the function was first created.
--
-- Safe for the triggers above, and not merely believed to be: Postgres checks
-- ACL_EXECUTE on a trigger function once, in CreateTrigger, and performs no
-- permission check when the trigger fires (src/backend/commands/trigger.c — the
-- comment on CreateTriggerFiringOn says so, and the firing path calls
-- FunctionCallInvoke directly). A user running an UPDATE therefore needs no
-- EXECUTE privilege on this function. The owner keeps EXECUTE, which is what the
-- CREATE TRIGGER statements above need, so the revoke is placed after them.
--
-- Direct RPC exposure was never the risk here — a function returning `trigger`
-- cannot be called any other way ("trigger functions can only be called as
-- triggers"). This closes the ACL so the invariant reads clean rather than
-- carrying a documented exception.
REVOKE ALL ON FUNCTION log_content_change() FROM PUBLIC, anon, authenticated;
