# Runbook — shipping s68a (an edit session never exceeds its holder's live grant)

s68a ([ADR 047](../decisions/047-edit-session-authority-is-the-live-grant.md)) closes H1: an `edit`
member could insert an `admin` edit session expiring in 2099 with their own JWT and publish to the
live site with it, and a removed member's session outlived the removal. It also closes M9 on
replayed databases and asserts the definer-function invariant (H2) at apply time.

- **Application** (the merge): `validateEditSessionAccess` intersects the session row with the
  holder's live `site_permissions` row on every use and refuses anything past 24 h from issue;
  `createEditSession` inserts through the service role; removing a member deactivates their
  sessions on that site.
- **Migrations**:
  - `supabase/migrations/20261008100000_edit_sessions_service_role_writes.sql` — drops the member
    INSERT policy on `edit_sessions`, revokes every web-principal write (and `anon`/PUBLIC SELECT),
    deactivates the rows the new validator would refuse, and asserts the end state.
  - `supabase/migrations/20261008110000_converge_replay_privileges.sql` — drops the replay-only
    self-escalation policies (only the invitation one exists in production), recreates the
    invitation UPDATE for managers/owners only, and aborts if any `SECURITY DEFINER` function is
    executable by `anon`/PUBLIC or by `authenticated` outside the three RLS predicates.

This is the operator's step, not the implementer's. Every production read below goes through the
`read-prod-database` path — never a write role.

## 0. Read-only pre-checks (before merging)

**The ledger** — open question 1 of the s68a research:

```sql
SELECT version FROM supabase_migrations.schema_migrations
 WHERE version >= '20260731008000' ORDER BY 1;
```

If `20260809120000` is absent, the dry run in step 2 will list it before the two s68a files. The
owner decided on 2026-10-08 that it is applied in the same push (it only re-issues revokes).
Record the answer in the PR and in `docs/quality/qa-register.md`.

**What the data step will deactivate.** Compare with the number of edit sessions the owner
expects to be live (production has one owner):

```sql
SELECT count(*) AS would_deactivate FROM public.edit_sessions s
 WHERE s.is_active AND (s.user_id IS NULL OR s.created_at IS NULL
   OR s.expires_at > s.created_at + interval '24 hours' + interval '5 minutes'
   OR s.created_at > now() + interval '5 minutes'
   OR NOT EXISTS (SELECT 1 FROM public.site_permissions p
                   WHERE p.site_id = s.site_id AND p.user_id = s.user_id
                     AND (p.permission = 'admin'
                          OR (p.permission = 'edit' AND s.permissions <@ ARRAY['view','edit'])
                          OR (p.permission = 'view' AND s.permissions <@ ARRAY['view']))));
```

**Whether the postcondition will abort the push.** Run the `definer exec` branch of the step-4
query on its own. Expect **zero rows**; any row names a function the convergence migration will
refuse — stop and decide before pushing (the push would abort in its transaction, which is safe,
but it is not the time to find out).

## 1. Deploy order — the application first, then the migrations

The s56 order ([content-writes-service-role.md](./content-writes-service-role.md)).

- **The migration breaks the OLD code's issuance.** `createEditSession` used to insert with the
  user's JWT; after `20261008100000` that insert is refused with 42501, so "Edit website" would
  fail.
- **The NEW code works on either schema.** It issues through `service_role`, which holds DML
  before and after, and it validates against the live grant whatever the schema says. The
  application deploy alone already closes H1's authority half; the migration closes issuance.

**In this repository, merging to `main` IS the production deploy** (Vercel Git integration).

1. **Merge** the reviewed PR.
2. **Confirm the Vercel production deploy is live** for the merge SHA: `Ready` and aliased to the
   production domain. Do not go on while it is `Building`, `Queued` or `Error`.

## 2. Dry run

From the merged `main`, with the Supabase CLI linked to the intended production project:

```bash
supabase migration list --linked
supabase db push --linked --dry-run
```

The dry run must list `20261008100000` and `20261008110000` — plus `20260809120000` before them
**only if** step 0 found it missing from the ledger (owner decision, 2026-10-08). Anything else,
or a different project identity: **stop**.

## 3. Apply

```bash
supabase db push --linked
```

## 4. Verify with the catalogue, not the ledger

A recorded migration is not proof it ran (`20260818000000`'s header). **Expect zero rows:**

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
 WHERE s.is_active AND (s.user_id IS NULL OR s.created_at IS NULL
                         OR s.expires_at > s.created_at + interval '24 hours' + interval '5 minutes'
                         OR s.created_at > now() + interval '5 minutes')
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

Both this query and the step-0 count were run against the **pre-fix** replay on 2026-10-08 (plan
`docs/plans/s68a-edit-session-authority.md`): they parse and flag what they claim, so an empty
result after the push is evidence, not a query that cannot match. Record the empty result in the
PR.

Then check that reads and the one writer survived:

```sql
SELECT has_table_privilege('authenticated', 'public.edit_sessions', 'SELECT') AS holder_reads,
       has_table_privilege('service_role', 'public.edit_sessions', 'INSERT') AS service_issues;
```

Expect `t`, `t`.

## 5. Smoke

The owner clicks **Edit website** on a test site: an edit session is created (service-role
issuance works) and the editor loads.

## 6. Rollback

Never edit either file. A rollback is a **new forward migration** that re-creates the INSERT
policy word for word from `20250817000000:483-492` and re-grants INSERT on `edit_sessions` to
`authenticated`. The new code never needs it — it issues through the service role and validates
against the live grant either way — so a rollback only reopens issuance. Use it only if the
migration itself turns out to be wrong. The convergence migration needs no rollback path: the
policies it drops exist only on replays, except the invitation UPDATE, which it recreates for
managers and owners.
