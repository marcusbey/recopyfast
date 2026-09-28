# ADR 042 — Content tables take no direct writes; the service role is the only writer

- Status: accepted
- Date: 2026-09-28
- Scope: s56-rls-content-writes-need-plan
- Amends:
  - [ADR 037](./037-dashboard-admin-service-role-writes.md) — adds a second kind of dashboard
    service-role writer: a signed-in `edit`/`admin` member writing content, behind
    `checkOwnerCanEdit`.
  - [ADR 041](./041-editing-needs-the-site-owners-plan.md) — closes its "Watch" entries "Direct
    database writes bypass this gate" and "`ab-tests/*` is in neither list", and the `bulk/update`
    rate-limiter half of the entry that starts "`bulk/update` still has no rate limiter". ADR
    041's body is not edited.

## Context

s51 put the site owner's plan in front of every application write (`checkOwnerCanEdit`, ADR 041).
Its review (finding 1) then went around the application. It signed up, took the `admin` row of a
site whose owner had no plan, and sent `PATCH /rest/v1/content_elements` to PostgREST with the
member's own JWT. The answer was 200, and the live `published_content` changed.

Two things made that possible, and both were live in production:

- **Write policies for members.** `content_elements` had "Users can edit content for authorized
  sites", `FOR ALL` to PUBLIC for any `edit`/`admin` row. `ab_tests` and `ab_test_variants` had
  INSERT, UPDATE and DELETE policies of the same shape, and variant content is served to visitors.
- **Write grants for web principals.** `anon` and `authenticated` held Supabase's default
  `arwdDxt(m)` on those tables. No migration granted it, and none revoked it.

Only four routes wrote these tables with a user JWT: `bulk/update`, `bulk/import`, `ai/translate`
and `ab-tests` POST/PUT. Every other writer was already the service role (staging, publish,
restore, v1, discovery, edit-board, the A/B visitor paths, the cron). No browser code and nothing
in `server/` writes them.

## Decision

**No web principal (`anon`, `authenticated`, PUBLIC) writes a content table. Every content write
is a route that writes through the service client after authorization and `checkOwnerCanEdit`.**

The nine content tables:

- `content_elements`, `content_versions`, `content_history`, `staging_history`;
- `ab_tests`, `ab_test_variants`, `ab_test_results`, `visitor_buckets`, `conversion_events`.

Migration `20260928140000_content_writes_are_service_role_only.sql` does three things:

- It drops every user write policy on them. Production and local/CI have diverged here:
  - **Production has seven.**
  - **A database replayed from the migration files, which is what local development and CI's
    `supabase start` build, has nine.** The other two are:
    - "Site editors can insert content versions" on `content_versions`
      (`20260611020000:129`);
    - "Site editors can append content history" on `content_history`
      (`20260731008000:341`).

  Both files are recorded as applied in production but aborted there, rolling back in full. That
  is the aborted-migration class `20260818000000_repair_aborted_migrations.sql` documents, and
  `20260818010000`'s header confirms it for `content_versions`. The migration drops all nine
  with `DROP POLICY IF EXISTS`. The two extra drops are a no-op in production, so both kinds of
  database converge on the same state: no user write policy on any of the nine tables.
- It revokes INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER from PUBLIC, `anon` and
  `authenticated`.
- It grants SELECT, INSERT, UPDATE and DELETE to `service_role` explicitly.

SELECT policies and SELECT grants are untouched, so public reads and member reads are unchanged.

A route may write a content table through the service client for a signed-in member when **all**
of the following hold, in this order:

1. A fail-closed rate limiter runs before `getUser()` (`onStoreFailure: "deny"`).
2. The caller is a signed-in user, read from the RLS-scoped client.
3. The caller's `edit` or `admin` row for the target site is read **through the RLS-scoped client**.
   The route refuses without it. A `view` row is not enough.
4. `checkOwnerCanEdit(siteId)` passes, keyed to the site the previous step checked.
5. Only then is the service client created. Every write it issues is scoped by the ids the checks
   established, never by ids taken from the body alone:
   - the `site_id` from the permission read;
   - element ids read back by site;
   - a test's own `site_id` for an update;
   - the variants' `test_id`, which is the test just inserted.

   An update writes an **allowlist** of fields and never spreads the request body.

The four routes moved onto this path:

- `bulk/update`, which also gained its first limiter;
- `bulk/import`;
- `ai/translate`, which now refuses a `view` member with 403 before any charge;
- `ab-tests` POST and PUT, which gained a limiter and the gate, and PUT writes only an allowlist.

`ab-tests/generate` was already a service-role writer. It now runs the gate too, and it reads the
`abTesting` capability from the **owner's** entitlement and charges the **owner** before the model
is called, in the `ai/suggest` shape (ADR 035, ADR 040).

`checkOwnerCanEdit` stays the one enforcement point. No plan rule is written in SQL.

## Considered options

- **(a) An `owner_has_plan(site_id)` predicate in the write policies.** Rejected. It would restate
  `resolveEntitlement`'s `plan` rule in SQL: entitlement revocation, expiry, trial and offer
  sources, lifetime purchases, live subscription statuses, retired plan ids and the catalogue's
  active flag. ADR 040 already refused that, after ADR 035: "the plan, trial and window rules
  would exist twice and drift". Its failure mode is also the worst one available. TypeScript
  says `plan`, SQL says no, and a paying owner's bulk rows fail one by one. It would also need a
  fourth SECURITY DEFINER predicate executable by `authenticated`, and it would keep four
  RLS-dependent writers.
- **Drop only the policies.** Rejected, for three reasons:
  - TRUNCATE ignores RLS and would stay granted.
  - PostgREST would answer a member's PATCH or DELETE with 200 and an empty body, a silent
    refusal.
  - The next permissive policy anyone adds would be reachable at once. GraphQL and any future
    Data API surface read the grant, not the route.
- **Revoke only the grants.** Rejected. Policies that say "members may write" would still sit on
  the tables, misdocumenting the model, and one re-applied default grant would silently revive
  them. The invariant is one list-wide rule, "no web principal holds a write grant or a write
  policy on a content table", and `src/__tests__/db/content-write-privileges.test.ts` asserts both
  halves.

## Consequences

**Easier.**

- The Data API has no content write path at all. A member's direct INSERT, UPDATE or DELETE
  answers 403 with code 42501, and a paying member's is refused too: no product surface writes
  directly.
- "Every content write needs the owner's plan" is now true of the database, not only of the
  routes.
- The proof runs in CI by name, through real PostgREST with real GoTrue JWTs, and through the real
  bulk handlers with a real session.

**Harder.**

- **`content_history.changed_by` is NULL on the moved paths.** The audit trigger records
  `auth.uid()`, and the service role has none. It was already NULL for every other writer, all of
  them service role. Its only reference is the type in `src/types/index.ts`.
- **A `view` member of a site gets 403 from `ai/translate`.** Before, they were charged, and then
  RLS silently refused their write. This is a behaviour change, and it is a fix.
- **`ab-tests/generate` bills the owner.** Its response's `remaining_credits` is the owner's
  balance.
- **The deploy order is code first, then the migration.** This is the reverse of
  `docs/operations/founding-offer.md`. The migration breaks the old code's four user-JWT writes,
  and bulk import and update are live in the dashboard. The new code works on either schema,
  because `service_role` holds DML on both. Runbook:
  [content-writes-service-role.md](../operations/content-writes-service-role.md).
- Every moved write loses RLS as a second check. The route's own scoping (step 5 above) is now
  the only thing between a member and another tenant's row.

**Watch.**

- **Direct credential issuance is still open.** A lapsed owner's `edit`/`admin` member can still
  write these through PostgREST:
  - `edit_sessions` (INSERT for PUBLIC);
  - `staging_access` (INSERT and UPDATE for PUBLIC);
  - `site_editors` (INSERT and UPDATE for `authenticated`).

  It is not a content bypass: every write those credentials make is route-gated. It does break
  ADR 041's literal "every credential issuance". Queued for s53.
- **`ai/translate` still bills the caller**, not the owner (ADR 041 "Watch", unchanged here).
