---
validated: yes
---
# Plan — Story s14c-cross-site-edit-activity

Branch: `feature/s14c-cross-site-edit-activity`
Research: `docs/research/s14-agency-client-handoff.md` — read it first; this plan does not repeat it.

## Target story

`docs/stories.md` → `s14-agency-client-handoff`, split at research. This is the third of three: one
view of recent edits across the account. Complexity 3. **Depends on `s14b`** (there is nothing
cross-site to look at until an account holds grants on several sites) **and `s03`** — see the
read-model decision, which changes the shape of that dependency.

Design: `docs/designs/s14c-cross-site-edit-activity.md` (+ `.html`, reference only, never copied).

Acceptance criterion this story carries, from the parent:

- AC 7 — one view lists recent edits across all the agency's sites, showing **site, editor,
  element** and timestamp. Absent today, and its named source does not exist: there is no
  `account_milestones` table anywhere in the 43 migrations, and no owner-facing cross-site query of
  any kind exists in `src/lib/auth/` (`listSiteEditors` takes one `siteId`; `listSitesForEditor` is
  keyed by an editor's email, not by an account).

### The read-model decision — this story owns it

Research open question 3 asked whether AC 7 should (a) repair `staging_history`, (b) wait for `s03`,
or (c) become its own story. It became its own story; the answer is **(a)**, and the reasoning has
to be written down because it contradicts a criterion in another story.

`s03` AC 8 says its `account_milestones` table is *"the single source for account-level edit
activity; `s14` and `s15` read from it rather than re-aggregating the activity log."* That claim
cannot be honoured, because `s03` AC 1 defines the table as **four write-once timestamps per
account** — account confirmed, first site registered, first verified install, first persisted
content update. Four timestamps per account is not a list of edits. AC 7 needs one row *per edit*,
carrying which site, which editor, which element. Those are different objects, and
`docs/research/s15-agency-digest.md:170-174` reached the same conclusion independently.

**The source is `staging_history`** — the only per-edit record in the database that can name a
non-account editor (`user_email`, written at
`src/app/api/staging/content/[siteId]/route.ts:247-256` and by the publish RPC at
`20260803020000_restore_atomic_publish.sql:63`). As it stands it cannot answer the query: no
`site_id` (the join runs through `content_elements`), no `created_at` index, and **zero readers**
anywhere in `src/`. So this story carries a migration, which is why it is the story that carries it
rather than a UI-only pass on someone else's table.

**This is also `s15-agency-digest`'s real dependency.** `s15` AC 1 says the monthly digest reports
edits per client site *"read from `s03`'s activity data"*. It cannot be — for the same reason.
`s15` aggregates the table this story repairs. Say so in the ADR (T8) so the next agent to read
`s15` does not go looking for `account_milestones` again. `s03`'s milestone table remains correct
for what it is: the activation funnel. It is not an activity log and must not be made into one.

## Tasks (ordered)

- [ ] **T1 — migration: `staging_history` gains `site_id`, filled by a trigger, indexed, with its
      RLS restated in the same file.** New `YYYYMMDDHHMMSS_staging_history_site_scope.sql`,
      forward-only, never editing an applied migration.
      - `ALTER TABLE staging_history ADD COLUMN site_id UUID REFERENCES sites(id) ON DELETE CASCADE`.
      - A `BEFORE INSERT` trigger that derives `site_id` from `content_element_id` when the column
        is not supplied. **This is the load-bearing choice:** there are three writers today — the
        content route, the atomic publish RPC, and `server/index.js:575-581`, which inserts
        `staging_history` directly over the socket in violation of ADR 004 rule 1. A trigger fills
        the column for all three without any of them being changed, so this migration cannot break
        the socket writer that `s07a` has not yet removed.
      - Backfill existing rows from `content_elements`.
      - `CREATE INDEX ... ON staging_history (site_id, created_at DESC)` — the index the cross-site
        query needs and the reason the join through `content_elements` is not good enough.
      - **RLS in the same migration** (AGENTS.md non-negotiable 6, ADR 002 rule 1). The existing
        `"Site admins can view staging history"` policy joins through `content_elements` and stays
        valid; add a policy expressed directly on `site_id` so the fast path and the RLS path are
        the same path, and drop the old one only after the new one is proven equivalent in a test.
        The service-role INSERT policy from `20260611020000_tighten_permissive_policies.sql:111-121`
        is unchanged.
      *Tests:* an insert through the content route populates `site_id` without the route naming it;
      an insert through the publish RPC populates it; a row belonging to site A is invisible under
      RLS to an admin of site B; the backfill leaves no `site_id IS NULL` row.

- [ ] **T2 — the read model: `listAccountEditActivity`.** New module `src/lib/activity/edit-activity.ts`.
      Resolves the account's sites as its **`admin` rows in `site_permissions`** — never a column
      on `sites` (AGENTS.md: counting via `sites.user_id` returns 0 and passes every quota check;
      that bug already shipped), never a team join, never account membership. Then reads
      `staging_history` filtered to those site ids, ordered `created_at DESC`, page-limited with a
      keyset cursor on `(created_at, id)`, joined to `content_elements` for `element_id` and
      `selector`, and to `sites` for `name`/`domain`.
      **The projection selects `sites.id, name, domain` and nothing else.** No `api_key`, no
      `buildSiteToken` call, no `embedScript`. `728b646` exists because a cross-site read handed a
      non-admin a minted 90-day site token, and `20260813120000_hide_sites_api_key.sql` revoked
      `sites.api_key` from anon/authenticated for the same reason (T1).
      The "no account" signal is derived by joining `site_editors` on `(site_id, lower(email))` —
      present means a grant holder. **Do not query `auth.users`.** A cross-site view that can be
      asked "does this address have an account" is an enumeration oracle wearing a dashboard's
      clothes, and it is unnecessary: the grant table already answers the only question the screen
      asks.
      *Tests:* a user with a non-admin collaborator row on a site sees none of its rows; a user with
      no admin rows gets an empty list, not an error; the returned objects contain no key matching
      `/api_key|token|secret/`; the keyset cursor returns each row exactly once across two pages.

- [ ] **T3 — `GET /api/activity`.** Session-authenticated, same-origin, **no CORS headers** (nothing
      outside the dashboard calls this — the same posture `/api/editor/editors` states in its
      header). Uses `supabase/server.ts` with **RLS on**, not the service-role client: the policy
      from T1 already expresses exactly this authorization, so the correct query needs no exception.
      That keeps the service-role count at 28 of 77 rather than 29 (ADR 002 rule 2 and its "Watch"
      clause; research T3 warns specifically against multiplying it with a cross-site view).
      Query parameters validated through `src/lib/api/validation.ts` — **not zod** (ADR 003):
      `siteId` (optional UUID, and it must be one of the caller's admin sites — validated by the
      query, not trusted), `editor` (optional email, capped), `range` (enum
      `today|7d|30d|90d`, default `30d`), `cursor` (optional, opaque), `limit` (capped).
      Rate limit before authorization (AGENTS.md), per user, `onStoreFailure` chosen and justified
      in a comment.
      *Tests:* an unauthenticated caller gets 401 before any query runs; a `siteId` the caller holds
      no admin row on returns an empty page, **not** a 403 (a 403 would confirm the site exists);
      an unknown `range` is a 400; the response carries no CORS header.

- [ ] **T4 — filter option sources.** The Site filter lists the caller's admin sites (the same set
      T2 already resolves — one query, two consumers, not a second definition of "the agency's
      sites"). The Editor filter lists distinct emails appearing in the caller's activity window,
      derived from the same bounded read rather than a separate unbounded scan over
      `staging_history`.
      *Tests:* the site options are exactly the caller's admin sites; a site the caller only
      collaborates on appears in neither list.

- [ ] **T5 — `/dashboard/activity` page and its hook.** New route, a sibling of `/dashboard/sites`
      and `/dashboard/analytics`. Server component by default; `"use client"` on line 1 only where
      state is needed. Server state through a custom hook — `useState` + `useEffect` + `fetch`
      returning `{ data, loading, error, refetch }`, with `src/hooks/useSites.ts` as the reference
      including its error handling: a non-ok response produces an error state, **never an empty
      list** (ADR 005, AGENTS.md). Not reached from `/dashboard/teams`, which `s04` retires.
      *Tests:* a 500 from the route renders the error state, not "No activity yet"; the hook
      refetches on filter change and does not fire on mount twice.

- [ ] **T6 — the row, and the day grouping.** Grouped by calendar day: one `.text-eyebrow` label
      ("Today" / "Yesterday" / "Aug 10, 2026") over one `Card variant="outline"` with divide-y
      rows, newest first inside the day. Each row, left to right: `Avatar` at 28px (initials for an
      account holder, a mail glyph for a grant holder — never initials from an email, which would
      imply an identity the product does not have) · the email, **always**, as the primary line
      unless a stored name exists · `Badge variant="outline"` "No account" on grant-holder rows
      only · `Badge variant="outline"` with the site's domain · the element's human label over its
      CSS selector in `font-mono text-xs text-muted-foreground` (the convention
      `s10-impression-history` and `ContentElementCard` already use for the same
      `content_elements` row) · `ContentValue expanded={false}` for the changed value · a
      right-aligned `.tabular` relative timestamp with the absolute time in `title`.
      **`Badge`, not `StatusBadge`, for both badges.** Which site an edit happened on is not a
      state, and neither is having no account; colour in this system signals state
      (`design-system.md:49-54`), so no site and no editor kind gets a tone.
      *Tests:* a grant-holder row renders the email and the "No account" badge; an account-holder
      row renders neither a mail glyph nor that badge; two sites' rows render identically styled
      site badges.

- [ ] **T7 — filters, states, and the missing `Select`.** Three fixed-option controls (Site,
      Editor, Date range; default Last 30 days).
      **`src/components/ui/` contains no `select.tsx`** — `design-system.md:117` lists `Select` as
      Radix-wrapped, but the file does not exist and every existing filter in the product uses a
      styled native `<select>` (`ShareSiteDialog.tsx:279`, `ContentFilterBar.tsx:68`,
      `AnalyticsDashboard.tsx:211`). Compose from that pattern. **Do not create
      `src/components/ui/select.tsx`** — inventing a primitive is forbidden, and the design system's
      claim is a documentation gap to report in the review, not a licence to fill it here.
      States, all four distinct:
      - **Loading** — `Skeleton` in the row's shape (circle, two bars, a badge bar, a multi-line
        bar, a short bar), about one day-group's worth. No spinner.
      - **Empty, true** — the account has never had an edit. `EmptyState`, icon `History`, "No
        activity yet", with `steps` describing the real mechanism (invite an editor from a site's
        detail view → they edit from the page they're on → the change appears here, attributed to
        their email). Filters row hidden: there is nothing to filter.
      - **Empty, filtered** — different copy, mandatorily. Icon `SearchX`, "No edits match these
        filters", a "Clear filters" `Button variant="outline" size="sm"`, no `steps`, filters row
        **kept visible**. A filled account showing "No activity yet" reads as broken, not as
        filtered — the design-system rule that empty is never how an error renders generalises
        here.
      - **Error** — `Alert variant="destructive"`, "Couldn't load activity" + retry, filters row
        still visible and interactive.
      - **Load more** — a plain `Button variant="outline" size="sm"`, centred. Composition of an
        existing primitive; there is no pagination component and none is to be written.
      *Tests:* true-empty and filtered-empty render different copy from the same component; the
      error state is not the empty state; "Load more" appends rather than replaces.

- [ ] **T8 — write the ADR.** `docs/decisions/<next free number>-cross-site-edit-activity-read-model.md`
      (number assigned at execute time; sibling story branches may claim one first). It must record:
      `staging_history` + `site_id` is the per-edit read model; `s03`'s `account_milestones` is four
      write-once timestamps and cannot serve AC 7, so **`s03` AC 8's "single source" claim is
      narrowed to account-level milestones and does not cover per-edit activity**; `s15-agency-digest`
      aggregates this table, not `account_milestones`; the trigger fills `site_id` for all three
      writers including the socket writer `s07a` will remove. Options rejected: waiting for `s03`
      to emit per-edit rows it does not promise; a new activity table beside `staging_history`
      (rejected — it would be a second per-edit record with a second attribution path, which is the
      exact defect `server/index.js` already represents); reading through the
      `content_elements` join without an index (rejected — it is the reason the query is
      unaffordable today).

- [ ] **T9 — interdict regression tests.** Each asserts a boundary this screen is shaped to
      resemble and must not cross:
      - No request from this page reaches `/api/teams/*`, and no query in `edit-activity.ts`
        references `site_permissions.team_id`.
      - The user-facing copy contains none of "role", "member", "team", "org", "workspace".
      - The API response contains no key matching `/api_key|siteToken|embedScript|secret/`.
      - `728b646` not regressed: `GET /api/sites` still gates `siteToken`/`embedScript` on
        `permission === 'admin'`; site DELETE still requires the creator.
      - `aca2eb2` not regressed: the last-admin revoke guard still refuses.

## Run interdicts

- **This uses the GRANT model and must touch NO `/api/teams/*` route. Do not introduce a role.**
  A cross-site list of who did what, where, is the exact shape of the PRD graveyard's frozen "org
  activity" screen. The distinction is maintained deliberately: a row says *this email edited this
  site*, never what that person *is* to the account. Grants are per-site and expiring; roles are
  per-org and persistent. Do not read `site_permissions.team_id`, and do not reach this page from
  `/dashboard/teams`, which `s04` retires.
- **Scope is `admin` rows in `site_permissions`.** Never `sites.user_id`, never a team join, never
  account membership. Gate per site, not per account.
- **No install credential in any projection.** Not `sites.api_key`, not `buildSiteToken()`, not the
  embed snippet. This is the query shape `728b646` was written to close.
- **Do not query `auth.users`.** The "no account" signal comes from `site_editors`.
- **Use `supabase/server.ts` with RLS on.** No new `createServiceRoleClient()` call site — the T1
  policy expresses this authorization, so an exception would mean the authorization is wrong
  (ADR 002 rule 2).
- **Never edit an applied migration.** Forward-only, `YYYYMMDDHHMMSS_snake_case.sql`. The new column
  carries its RLS in the same file.
- **Do not change how `staging_history` is written.** Three writers exist; the trigger accommodates
  all three. Removing the socket writer is `s07a`'s work under ADR 004 rule 1, not this story's.
- **Do not create `src/components/ui/select.tsx`** or any other new primitive. Compose.
- **No zod** (ADR 003). Validation through `src/lib/api/validation.ts`.
- **Do not modify an existing test to accommodate a change in behaviour** (AGENTS.md).

## The point everything turns on

**The set of sites in this view is the caller's `admin` rows in `site_permissions`, resolved once,
and every row on the page has to be inside it.**

This is the first read in the product that crosses sites, and a cross-site read gets its scope
wrong in ways a single-site read cannot. Three failure shapes, all of which look like a working
screen:

1. **Scoping by the wrong column.** AGENTS.md records that counting ownership via `sites.user_id`
   returns 0 and passes every quota check — *that bug already shipped*. The same mistake in a read
   returns rows instead of zero, and the rows are somebody else's.
2. **Scoping by account membership rather than by an `admin` row per site.** A collaborator with
   `edit` on one site is not an admin of it, and a view that treats "is on the account" as "may see
   the activity" hands a client's edit history to another client.
3. **Widening the projection while widening the scope.** `728b646` exists because a cross-site
   `GET /api/sites` handed non-admins a minted 90-day site token. A cross-site activity projection
   that reaches into `sites` for convenience is one `select("*")` away from the same breach —
   which is why T2 names the three columns it may take.

The structural defence is that the scope is computed **once**, in `listAccountEditActivity`, and the
RLS policy from T1 says the same thing independently, so a bug in one is caught by the other. The
filters are consumers of that one set, never second definitions of it. And the `siteId` filter is
*validated by the query* rather than trusted: an id the caller holds no admin row on returns an
empty page, not a 403 — a 403 would confirm the site exists.

## Files touched

| File | Change |
|---|---|
| `supabase/migrations/<ts>_staging_history_site_scope.sql` | new — `site_id`, BEFORE INSERT trigger, backfill, `(site_id, created_at DESC)` index, RLS policy in the same file |
| `src/lib/activity/edit-activity.ts` | new — `listAccountEditActivity`, admin-scoped, keyset-paginated, credential-free projection |
| `src/app/api/activity/route.ts` | new — session-authenticated, RLS-on, no CORS, validated filters |
| `src/app/dashboard/activity/page.tsx` | new — the Activity screen |
| `src/components/dashboard/ActivityFeed.tsx` | new — day groups, rows, all four states |
| `src/components/dashboard/ActivityFilters.tsx` | new — three native `<select>` filters, styled per `ShareSiteDialog` |
| `src/hooks/useEditActivity.ts` | new — `{ data, loading, error, refetch }`, `useSites.ts` as reference |
| `src/lib/api/validation.ts` | extended if the filter parsing needs a validator it lacks |
| `src/__tests__/api/activity/route.test.ts` | new — scope, filters, credential absence, 401/400 |
| `src/__tests__/lib/activity/edit-activity.test.ts` | new — admin scoping, pagination, projection |
| `src/__tests__/db/staging-history-site-scope.test.ts` | new — trigger, backfill, RLS isolation |
| `src/components/dashboard/__tests__/ActivityFeed.test.tsx` | new — the four states, row rendering |
| `docs/decisions/<next>-cross-site-edit-activity-read-model.md` | new ADR |
| `docs/plans/s14c-cross-site-edit-activity.md` | checkboxes ticked as tasks land |

Not touched, deliberately: `src/app/api/staging/content/[siteId]/route.ts` (the trigger means the
writer needs no change), `supabase/migrations/20260803020000_restore_atomic_publish.sql` (applied),
`server/index.js` (`s07a` owns it), `src/app/api/teams/*`, `src/app/dashboard/teams/*`,
`src/lib/analytics/tracker.ts` and `account_milestones` (`s03` owns them; this story narrows a
claim about them in an ADR, it does not edit them).

## Test strategy

**The migration is tested, not assumed.** `src/__tests__/db/` already holds database-level tests
(`function-grants.test.ts` is the shape). Three assertions matter and none of them is about SQL
syntax: the trigger fills `site_id` for a writer that does not name it; the backfill leaves no
nulls; and RLS isolates two sites from each other's admins. The third is the one that would be a
cross-tenant leak rather than a bug (AGENTS.md non-negotiable 6).

**The tests that must fail before the code exists:**

1. `listAccountEditActivity` returns rows for the caller's admin sites and none for a site they
   merely collaborate on.
2. A `siteId` filter naming a site the caller has no admin row on returns an empty page, not a 403.
3. The API response contains no key matching `/api_key|siteToken|embedScript|secret/`.
4. A grant-holder edit is attributed to the email the grant was issued to and carries the
   "No account" badge; it is never rendered as "unknown".
5. An insert into `staging_history` that does not name `site_id` still gets one.
6. An admin of site B cannot SELECT site A's rows under RLS.
7. True-empty and filtered-empty render different copy.
8. A 500 renders the error state, not an empty list.

**Fixtures.** The cross-site tests need at least two sites with different admins and one editor
holding a grant on one of them — build that once, as a shared fixture, because every scoping
assertion depends on it and a single-site fixture makes all of them pass vacuously.

**Coverage.** Ratchet only upward (`jest.config.js`, 22% lines floor today).

## Definition of Done

- [ ] Every task above checked, with its named tests present and green.
- [ ] An agency with three client sites sees, in one view, who changed what on which site and when
      — including edits by people who have no account, identified by the email the grant was issued
      to. Verified by hand against real rows, not only in tests.
- [ ] The migration applies cleanly forward, backfills every existing row, and its RLS is asserted
      by a test that a second site's admin cannot read the first site's rows.
- [ ] `lint`, `type-check`, `format:check`, `build`, `test` all green.
- [ ] The ADR is written and committed on this branch, and it states plainly that `s15-agency-digest`
      reads this table and that `s03` AC 8's "single source" claim covers milestones only.
- [ ] Mechanically checkable interdicts checked and stated in the PR: no `/api/teams/*` and no
      `team_id` in the diff; no new `createServiceRoleClient` call site; no `zod` import; no new
      file under `src/components/ui/`; no `sites.api_key` or `buildSiteToken` in any new query.
- [ ] The words "role", "member", "team", "org" and "workspace" appear nowhere in this story's
      user-facing copy.
- [ ] The migration is its own commit, separable from the story commit — it is the one thing here
      you would want to revert on its own (AGENTS.md, data & docs lifecycle).
- [ ] `docs/reviews/s14c-cross-site-edit-activity.md` ends `Ship allowed: yes` with no critical
      finding.
