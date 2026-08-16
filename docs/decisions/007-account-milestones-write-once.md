# ADR 007 — Account milestones are write-once, enforced by a table-level trigger, and milestone 1 is captured by a trigger on `auth.users`

- Status: accepted
- Date: 2026-08-16
- Scope: story s03-activation-funnel

## Context

`s03-activation-funnel` needs four account-level timestamps — confirmed, first site
registered, first verified install, first persisted content update — each written **exactly
once** and never overwritten by a later event (`docs/stories.md` AC4), with a test that
replays a duplicate event and asserts the original value survives.

Two things make this genuinely new work rather than boilerplate, per
`docs/research/s03-activation-funnel.md`:

1. **No write-once column exists anywhere in the 43 applied migrations.** Every existing
   table either allows overwrite or has no "first occurrence" semantics at all. There is no
   pattern to copy.
2. **Milestone 1 ("account confirmed") has no application-level hook.** Supabase Auth
   (GoTrue) owns signup and confirmation entirely; `src/app/api/auth/` contains only
   `logout`, `profile`, `session` — no confirm route exists to instrument. The three other
   milestones each have a real `route.ts` call site already; this one does not.

The four milestones are also written from three different code paths (a DB trigger, the
site-registration route, the staging-content route, and — pending `s02` — a fourth call site
this story cannot yet build). Relying on each call site to individually remember a
`WHERE column IS NULL` guard is exactly the kind of per-call-site discipline this codebase's
own history argues against: twelve of the 43 migrations exist only to close RLS gaps that
per-route discipline failed to catch (ADR 002).

## Decision

**One write-once mechanism, enforced at the table, not at the caller.**

1. `account_milestones` is one row per account (`account_id uuid PRIMARY KEY REFERENCES
   auth.users(id) ON DELETE CASCADE`), four nullable `timestamptz` columns, and an
   `unmeasurable boolean NOT NULL DEFAULT false` set once by a migration-time backfill for
   accounts that predate this story. RLS mirrors `checkout_reservations`
   (`20260813130000_checkout_reservations.sql`): `authenticated` may `SELECT` its own row and
   nothing else; `service_role` holds `ALL`. No `INSERT`/`UPDATE`/`DELETE` grant to
   `authenticated` — every write is system-driven.
2. A `BEFORE UPDATE` trigger on `account_milestones` itself clamps any of the four timestamp
   columns back to its `OLD` value whenever it is already non-null. This is the single point
   that makes "exactly once" true, regardless of which of the four writers (three now, a
   fourth once `s02` ships) attempts the write, and regardless of whether a future caller
   remembers to guard its own `UPDATE`.
3. Milestone 1 is captured by an `AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users`
   trigger, firing `WHEN (NEW.email_confirmed_at IS NOT NULL)` — covering both a normal
   confirm-by-link flow (`UPDATE`) and an OAuth account that arrives already confirmed
   (`INSERT`). It upserts into `account_milestones`; the `BEFORE UPDATE` trigger from (2)
   protects it identically to every other writer. This is the first trigger in this
   codebase that reaches from the `auth` schema into `public`.

## Considered options

- **Application-level `WHERE column IS NULL` guard at each call site, no DB trigger** —
  rejected. `docs/research/s03-activation-funnel.md` names this explicitly as race-prone
  under concurrent requests unless paired with a unique constraint or `ON CONFLICT DO
  NOTHING` semantics, and it has to be re-implemented correctly at every call site,
  including the one this story cannot yet write (`s02`'s future call). One missed guard
  anywhere silently breaks "exactly once" — the write paths use the service-role client,
  which bypasses RLS, so there is no second layer catching it.
- **Proxy milestone 1 off "first authenticated dashboard visit" instead of a trigger** —
  rejected. It conflates confirmation with first product interaction. An account that
  confirms by email and never opens the dashboard would never register step 1, which
  corrupts the funnel's own base count and every drop-off percentage computed from it — the
  exact "unfalsifiable activation claim" failure mode this story exists to close, reproduced
  for a different reason.
- **A cron job polling `auth.users` for newly confirmed accounts** — rejected. It adds
  latency (this story does not otherwise need any), and correctly detecting "confirmed since
  the last poll" requires diffing against previous poll state — strictly harder to get right
  than a trigger that fires exactly once per row transition. No sub-daily cron infrastructure
  exists in this repo to begin with (`vercel.json` carries one daily cron).
- **A `SECURITY DEFINER` RPC function per milestone, called from application code instead of
  a plain table write** — rejected. It adds to the SECURITY DEFINER lockdown debt this
  codebase is actively paying down: two migrations
  (`20260805190000_lock_down_content_version_rpcs.sql`,
  `20260809120000_lock_down_definer_functions.sql`) exist purely to retrofit `REVOKE`/`GRANT`
  on functions that were reachable by the anon key the moment they were created. A plain
  `.upsert()` through the service-role client that already bypasses RLS needs no additional
  PostgREST-exposed surface and adds nothing to that list.

## Consequences

**Easier.** The "exactly once" guarantee lives in one trigger, not in four (eventually four)
independently-written call sites. A future writer — including `s02`'s not-yet-built call for
milestone 3 — inherits the guarantee for free; it cannot forget the guard, because the guard
is not its job.

**Harder.** This is the first trigger in the codebase that reaches from `auth` into `public`.
It has no sibling to be reviewed alongside, and a future Supabase Auth / GoTrue upgrade that
changes `email_confirmed_at` semantics (for example, a provider that confirms via a different
column) needs this trigger re-verified specifically, not assumed to still be correct.

**Watch.** OAuth-confirmed accounts, where `email_confirmed_at` is set at row creation rather
than by a later `UPDATE` — the trigger must fire on both `INSERT` and `UPDATE`, and this is
the one case in this design that is easy to test and easy to silently omit. The db-invariant
suite for this trigger (`src/__tests__/db/account-milestones-confirm-trigger.test.ts`) must
cover both paths explicitly.
