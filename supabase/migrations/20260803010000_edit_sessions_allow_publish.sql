-- Let an edit session carry the `publish` permission.
--
-- Found by running the core E2E for the first time. It fails at the first
-- insert with 23514:
--
--   new row for relation "edit_sessions"
--   violates check constraint "edit_sessions_permissions_check"
--   Failing row contains (..., {view,edit,publish}, ...)
--
-- POST /api/edit-sessions/create validates the request against
-- ["view", "edit", "publish", "admin"] (route.ts:52), types the value as that
-- union (route.ts:89), and writes it. The database then refuses it. The API
-- documents and accepts an input it cannot store, which is the same failure
-- shape as the Starter checkout that raised 23514 while the card was already
-- charged.
--
-- `publish` is the rest of the vocabulary everywhere else: `staging_access` and
-- `site_editors` both permit it, and `EditorPermission` in
-- src/lib/auth/editor-access.ts is exactly these four values. `edit_sessions`
-- was the only table disagreeing, which is why an editor granted publish rights
-- could not get a session at all — the publish half of the core loop.
--
-- How it regressed, because the mechanism matters more than the fix:
--
--   20250817000000  created edit_sessions with CHECK (view, edit, admin).
--   20260617000000  corrected it to (view, edit, publish, admin).
--   20260801200000  restored ten base tables that had never reached
--                   production, recreating edit_sessions from the ORIGINAL
--                   20250817000000 definition — reinstating the old
--                   constraint and silently undoing the correction.
--
-- So the migration history declares the right constraint and production holds
-- the wrong one. A restore migration reverted an earlier fix. Anything that
-- rebuilds a table from a first-generation definition has to be checked against
-- every later ALTER to that table, or it is a time machine.
--
-- This is written as a forward correction rather than an edit to either of
-- those files: both are applied, and rewriting applied migrations makes the
-- recorded history disagree with what actually ran.

ALTER TABLE edit_sessions
  DROP CONSTRAINT IF EXISTS edit_sessions_permissions_check;

ALTER TABLE edit_sessions
  ADD CONSTRAINT edit_sessions_permissions_check
  CHECK (permissions <@ ARRAY['view', 'edit', 'publish', 'admin']::TEXT[]);
