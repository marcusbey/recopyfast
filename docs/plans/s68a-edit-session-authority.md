---
validated: yes
---
# Plan — Story s68a-edit-session-authority

Branch: `feature/s68a-edit-session-authority`
Research: `docs/research/s68a-edit-session-authority.md` — read it first; this plan does not repeat it.
Decision: [ADR 047](../decisions/047-edit-session-authority-is-the-live-grant.md) (drafted on the
s68 planning branch; it travels with this story).

## Owner decisions (2026-10-08)

Plan validated by the owner. Open question 1 resolved: if production's migration ledger lacks
`20260809120000`, apply it in the same push as the new migrations (it only re-issues revokes).

## Target story

`docs/stories.md` → s68a. An edit session grants at most the holder's live `site_permissions`
row, read at every validation, and nothing past 24 h from issue; removing a member deactivates
their sessions; only the service role writes `edit_sessions`; replay-only self-escalation
policies on `team_members` / `site_permissions` / `team_invitations` are dropped; the
definer-function and RLS invariants are enforced in CI against both replays and asserted at
apply time in production.

## Tasks (ordered)

Each task starts with the test that must fail first. "Replay" = the bare PG14 database
`node scripts/run-db-invariants.mjs` builds (`RCF_POSTGRES_BIN=/usr/local/opt/postgresql@14/bin`
locally); "Supabase stack" = `npx supabase start`.

1. [x] **Edit-session privileges suite (RED).** New `src/__tests__/db/edit-sessions-privileges.test.ts`
   (`describeDb`), modelled on `content-write-privileges.test.ts:216-347`:
   - catalogue: PUBLIC, `anon`, `authenticated` hold no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER
     on `edit_sessions` (table **and** `has_any_column_privilege`), `anon`/PUBLIC hold no SELECT, and
     no permissive INSERT/UPDATE/DELETE/ALL policy targets PUBLIC/`anon`/`authenticated`;
   - guard: `authenticated` keeps SELECT and, role-switched (`column-privileges.test.ts:459-462`
     pattern), a holder reads their own session and not another user's;
   - behaviour: role-switched `edit` member `INSERT … permissions '{admin}'` → SQLSTATE 42501;
     `service_role` insert succeeds;
   - data step: as superuser insert three rogue active rows (NULL `user_id`; `expires_at =
     created_at + 30 days`; `{admin}` for an `edit` member) and one legitimate row, re-run the
     migration file's SQL (read with `fs`, one `client.query`), assert the three are
     `is_active = false` with `revoked_at` set and the legitimate one untouched; run it a third time
     (idempotent).
   - PostgREST half (skipped to a "[gated]" test only when `RCF_TEST_POSTGREST_URL` is absent, as
     `:348`): an `edit` member's GoTrue JWT `POST /rest/v1/edit_sessions` is refused and no row exists.
   Fails today: the INSERT succeeds and the grants exist.
2. [x] **Migration `supabase/migrations/20261008100000_edit_sessions_service_role_writes.sql` (GREEN).**
   Header comment in house style (the H1 exploit, the replay proof, ADR 047, deploy order). Body:
   `DROP POLICY IF EXISTS "Users can create edit sessions for sites they have access to"`;
   `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.edit_sessions FROM PUBLIC, anon, authenticated`;
   `REVOKE SELECT ON public.edit_sessions FROM PUBLIC, anon`; `GRANT SELECT ON public.edit_sessions TO authenticated`;
   `GRANT SELECT, INSERT, UPDATE, DELETE ON public.edit_sessions TO service_role`; data step:
   `UPDATE public.edit_sessions SET is_active = false, revoked_at = COALESCE(revoked_at, now())
   WHERE is_active AND (user_id IS NULL OR expires_at > created_at + interval '24 hours' OR NOT
   EXISTS (<direct grant of the holder whose level covers every permission in the row>))`;
   postcondition `DO` block raising if any write grant/column grant/write policy for web principals
   remains. Task 1 green on the replay and the Supabase stack.
3. [x] **Replay-convergence suite (RED).** New `src/__tests__/db/replay-privilege-convergence.test.ts`,
   role-switched SQL, reproducing the research's three replay exploits as refusals:
   stranger `INSERT team_members (role 'owner')` → refused; invitee `UPDATE team_invitations SET
   role='manager', team_id=<other>` → 0 rows / refused, while a team manager's UPDATE still lands;
   collaborator admin `UPDATE site_permissions SET granted_by = <self>` (no WHERE) → refused /
   0 rows and the creator row is unchanged; guard: "Site admins can revoke non-creator permissions"
   (`20260813140000`) still exists. Plus a negative control for the postcondition of task 4: inside
   a rolled-back transaction create a `SECURITY DEFINER` function, `GRANT EXECUTE … TO anon`, run
   the postcondition block (extracted from the migration file between marker comments) → it raises.
4. [x] **Migration `supabase/migrations/20261008110000_converge_replay_privileges.sql` (GREEN).**
   `DROP POLICY IF EXISTS` for "Team managers can add members", "Team managers can update members",
   "Team managers can remove members" (team_members), "Site admins can grant site permissions",
   "Site admins can update site permissions" (site_permissions) and "Invitees and managers can
   update invitations" (team_invitations); `CREATE POLICY "Team managers can update invitations"`
   FOR UPDATE TO authenticated USING/WITH CHECK `user_has_team_role(team_id, ARRAY['manager','owner'])`.
   Header: which of these exist in production (only the invitation policy) vs on a replay, and that
   teams are PRD graveyard. Postcondition between `-- BEGIN definer-grant postcondition` /
   `-- END …` markers: the `function-grants.test.ts` invariant in SQL (no definer function in
   `public` executable by PUBLIC/`anon`; `authenticated` only on the three identities at
   `function-grants.test.ts:81-85`), raising with the offender list.
5. [x] **CI enforces the invariants on both replays.** `scripts/run-db-invariants.mjs`: add
   `function-grants.test.ts`, `rls-policies.test.ts`, `edit-sessions-privileges.test.ts`,
   `replay-privilege-convergence.test.ts` to the jest list (`:181-197`) and re-apply both new
   migrations in the convergence loop (`:166-176`). `.github/workflows/ci.yml` e2e job: add the
   four files to the `RCF_REQUIRE_TEST_DB=1` step at `:278-288` (it already exports the PostgREST
   URL and keys). Proof: run the runner once with the DB stopped mid-way or with a wrong URL and
   see it fail (record in the PR), then green.
6. [x] **Authority at validation (RED → GREEN).** New `src/lib/auth/__tests__/edit-session-authority.test.ts`
   against `validateEditorAccess({ token: { kind: "edit-session", … } })` with a fake service
   client: (a) row `{admin}` + live `edit` → permissions `[view, edit]`; (b) no live row → invalid
   401 "Invalid or expired edit session"; (c) NULL `user_id` → same 401; (d) `created_at` 25 h ago,
   `expires_at` in the future → same 401; (e) live `admin` + row `{edit}` → `[view, edit]` (row
   narrows). Route test `src/__tests__/api/staging/publish-edit-session-authority.test.ts`: POST
   `/api/staging/publish` with `editToken`, no cookie: edit member's admin-stamped session → 403
   "Publish permission required" and no RPC; removed member → 401; live admin → 200. Then change
   `validateEditSessionAccess` (`editor-access.ts:416-457`): one extra service-role read of
   `site_permissions (permission)` by `site_id` + `session.user_id`; intersection via
   `normalizePermissions`; lifetime from `MAX_SESSION_LIFETIME_HOURS`; tombstone comment naming
   H1 and ADR 047. Update the mocked suites listed in research "Traps" (declared in the PR).
7. [x] **Issuance through the service role.** RED in `src/__tests__/api/edit-sessions/create-token-leak.test.ts`
   (or a new `create-service-role.test.ts`): the insert happens on the service client; the user
   client is used only for `getUser` and the `site_permissions` read. GREEN in
   `edit-sessions.ts:59-130`. Delete `cleanupExpiredSessions` (no caller, silently non-functional
   under RLS) with a one-line tombstone.
8. [x] **Removal revokes.** RED: new `src/__tests__/api/sites/share-revokes-edit-sessions.test.ts`
   — after a successful DELETE, the service client updates `edit_sessions` `is_active=false,
   revoked_at` filtered by `site_id` **and** `user_id = targetPermission.user_id`; a team-row
   delete (`user_id` null) issues no session update; a failing session update is logged and the
   200 stands (authority is already gone by task 6 — comment says so). GREEN in
   `share/route.ts` after `:514-526`.
9. [ ] **e2e seeds name the owner.** `e2e/share-edit-publish.spec.ts:431-437` and
   `e2e/realtime-parity.spec.ts:432` insert `user_id: ownerId`. Run `npm run test:e2e` on the local
   stack (`e2e/support/local-supabase.ts`); the strict count stays 45.
10. [ ] **Docs, gates, commits.** Runbook `docs/operations/edit-session-authority.md` (below:
    order, dry run, pre/post read-only queries, rollback); `docs/quality/qa-register.md`: replace
    the stale "`20260809120000` still blocked" status with the owner's 2026-10-08 production facts
    and the ledger answer (open question 1) — or "unknown, see runbook step 0" if not yet read;
    AGENTS.md "Data access": one line "an edit session never exceeds its holder's live grant
    ([ADR 047])". `npm run precommit` and `npm run prepush` green in the worktree,
    `node scripts/run-db-invariants.mjs` green, `npm run build:embed -- --check` clean. Commits:
    one story commit; the two migrations + their DB suites as a separate commit (revertible alone).

## Rollout (operator, after merge — the implementer runs none of this)

Order: **application first, then the migrations** (the s56 order, ADR 047 consequences). The new
code issues sessions through the service role and validates against the live grant on either
schema; old code on the new schema cannot issue sessions. The app deploy alone already closes
H1's authority half; the migration closes issuance.

0. **Read-only pre-checks** (through the `read-prod-database` path, never a write role):
   ```sql
   SELECT version FROM supabase_migrations.schema_migrations
    WHERE version >= '20260731008000' ORDER BY 1;
   SELECT count(*) AS would_deactivate FROM public.edit_sessions s
    WHERE s.is_active AND (s.user_id IS NULL OR s.expires_at > s.created_at + interval '24 hours'
      OR NOT EXISTS (SELECT 1 FROM public.site_permissions p
                      WHERE p.site_id = s.site_id AND p.user_id = s.user_id
                        AND (p.permission = 'admin'
                             OR (p.permission = 'edit' AND s.permissions <@ ARRAY['view','edit'])
                             OR (p.permission = 'view' AND s.permissions <@ ARRAY['view']))));
   ```
   plus the `definer exec` branch of the verification query below (expect zero — otherwise the
   task-4 postcondition will abort the push).
1. Merge; confirm the Vercel production deployment for the merge SHA is `Ready` and aliased.
2. `supabase migration list --linked` then `supabase db push --linked --dry-run`. It must list
   **exactly** `20261008100000` and `20261008110000`. If it lists anything else (notably
   `20260809120000`), stop: that is open question 1, an owner decision.
3. `supabase db push --linked`.
4. **Verify the catalogue, not the ledger** (a recorded migration is not proof it ran —
   `20260818000000`'s header). Expect **zero rows**:
   ```sql
   WITH web(role) AS (VALUES ('anon'), ('authenticated'))
   SELECT 'grant' AS kind, w.role || ' ' || p.priv AS offender
     FROM web w CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
    WHERE has_table_privilege(w.role, 'public.edit_sessions', p.priv)
   UNION ALL
   SELECT 'column grant', w.role || ' ' || p.priv
     FROM web w CROSS JOIN (VALUES ('INSERT'),('UPDATE')) p(priv)
    WHERE has_any_column_privilege(w.role, 'public.edit_sessions', p.priv)
   UNION ALL
   SELECT 'anon read', 'edit_sessions'
    WHERE has_table_privilege('anon', 'public.edit_sessions', 'SELECT')
   UNION ALL
   SELECT 'write policy', c.relname || ' :: ' || pol.polname
     FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
    WHERE c.relnamespace = 'public'::regnamespace
      AND pol.polcmd IN ('a', 'w', 'd', '*')
      AND (c.relname = 'edit_sessions'
           OR pol.polname IN ('Team managers can add members', 'Team managers can update members',
                              'Team managers can remove members',
                              'Site admins can grant site permissions',
                              'Site admins can update site permissions',
                              'Invitees and managers can update invitations'))
      AND (pol.polroles = '{0}'
           OR EXISTS (SELECT 1 FROM unnest(pol.polroles) r
                       WHERE pg_get_userbyid(r) IN ('anon', 'authenticated')))
   UNION ALL
   SELECT 'live rogue session', s.id::text FROM public.edit_sessions s
    WHERE s.is_active AND (s.user_id IS NULL OR s.expires_at > s.created_at + interval '24 hours')
   UNION ALL
   SELECT 'definer exec', p.proname || ' -> ' ||
          CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
     FROM pg_proc p
     CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace
      AND a.privilege_type = 'EXECUTE'
      AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))
      AND NOT (a.grantee <> 0 AND pg_get_userbyid(a.grantee) = 'authenticated'
               AND p.proname IN ('user_has_site_permission', 'user_is_team_member', 'user_has_team_role'));
   ```
   Then: `SELECT has_table_privilege('authenticated','public.edit_sessions','SELECT'),
   has_table_privilege('service_role','public.edit_sessions','INSERT');` → `t, t`.
   Both this query and the step-0 count were run against the **pre-fix** replay on 2026-10-08:
   they parse, and they flag what they claim (25 rows — the `edit_sessions` grants and INSERT
   policy, the six M9 policies, one planted rogue session; the step-0 count found the same row).
   An empty result after the push is therefore evidence, not a query that cannot match.
5. Smoke: the owner clicks "Edit website" on a test site — an edit session is created (service-role
   issuance works) and the editor loads.
6. Rollback (never edit the two files): a new forward migration re-creating the INSERT policy from
   `20250817000000:483-492` and re-granting INSERT to `authenticated`. The new code never needs it;
   use only if the migration itself is wrong.

## Run interdicts

- `git diff main...HEAD -- public/embed/ server/` is empty (s67 owns the embed; s68c owns `server/`).
- `git diff main...HEAD -- src/app/api/staging/publish/route.ts` is empty: the fix lives in the
  shared validator so every edit-token route inherits it.
- No applied migration file changes: `git diff main...HEAD --stat -- supabase/migrations/` shows
  only the two new files.
- `package.json`, `package-lock.json`, `server/package*.json` unchanged.
- No `supabase db push`, no `supabase link`, no production SQL, no deploy, no `--no-verify`.
- Every pre-existing test edited is listed in the PR with the reason (AGENTS.md "Tests").

## The point everything turns on

Authority comes from the live direct grant `(site_id, user_id)`, intersected with the row. Where
this could be wrong:
1. **Team-only members.** A team grant has `user_id` NULL; first-party access and
   `createEditSession` (`edit-sessions.ts:66-71`) both require a direct row, so no legitimate
   session can depend on a team grant. Compare with `authorizeFirstPartyEditorAccess`
   (`editor-access.ts:160-170`); if any issuance path accepts team grants, the intersection would
   refuse its sessions.
2. **The data step deactivating something legitimate.** A legitimate row always has a `user_id`,
   `expires_at ≤ created_at + 24 h` (create caps one grant at 24 h, extend at the absolute 24 h
   ceiling), and permissions within its holder's level. Compare the pre-check count (step 0) with
   the number of sessions the owner expects to be live (production has one owner).
3. **The postcondition aborting in production.** It encodes `function-grants.test.ts` exactly;
   compare its offender list with the step-0 query before pushing.

## Files touched

New: the two migrations; `src/__tests__/db/edit-sessions-privileges.test.ts`,
`src/__tests__/db/replay-privilege-convergence.test.ts`,
`src/lib/auth/__tests__/edit-session-authority.test.ts`,
`src/__tests__/api/staging/publish-edit-session-authority.test.ts`,
`src/__tests__/api/sites/share-revokes-edit-sessions.test.ts`,
`docs/operations/edit-session-authority.md`.
Modified: `src/lib/auth/editor-access.ts`, `src/lib/auth/edit-sessions.ts`,
`src/app/api/sites/[siteId]/share/route.ts`, `scripts/run-db-invariants.mjs`,
`.github/workflows/ci.yml`, `e2e/share-edit-publish.spec.ts`, `e2e/realtime-parity.spec.ts`, the
mocked suites named in research, `docs/quality/qa-register.md`, `AGENTS.md`, ADR 047,
`docs/stories.md` (ticks), this plan.

## Test strategy

Real Postgres first (catalogue + role-switched behaviour + PostgREST with real JWTs), because the
defect is a database grant that every mocked suite passed over. Then unit tests on the validator,
route tests on publish/create/share, and the two e2e specs as the end-to-end proof that a
legitimate owner's edit session still edits and publishes. Coverage thresholds only move up.

## Definition of Done

Repo DoD, plus: every s68a AC checked with its named test; both DB suites, `function-grants` and
`rls-policies` run by name with `RCF_REQUIRE_TEST_DB=1` in both CI steps; ADR 047 merged; the
runbook merged; production verification query returns zero rows after the operator's apply,
recorded in the PR; qa-register no longer claims `20260809120000` is blocked without evidence.
