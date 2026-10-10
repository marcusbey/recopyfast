# ADR 037 — Dashboard admin writes to service-role-only tables

- Status: accepted
- Date: 2026-09-25
- Scope: s42 review M2
- Amends: ADR 002 §3/§4 and AGENTS.md "Data access" — adds one permitted principal; nothing else changes.

## Context

ADR 002 reserves the service-role client for widget paths whose caller is a site token or an
editor grant, reached through an `authorize*` helper and a fail-closed per-site limiter. Read
literally, it forbids the service role anywhere else.

Some tables are deliberately writable only by `service_role`: `api_keys` since migration
20260804130000 ("writes → TO service_role"), and after ADR 034 removed table-level writes from
`authenticated`, the credential tables generally. Their owners still manage rows from the
dashboard. At least five routes already do it the same way — `sites/register`,
`sites/[siteId]` (delete), `sites/[siteId]/regenerate-snippet`, `webhooks`, and since s42
`api-keys` — so the rule as written and the code disagree. The s42 review found the
disagreement and accepted the pattern, on condition that it is written down.

The alternative, RLS write policies plus column grants for `authenticated`, would reverse ADR 034
and let a browser session write credential rows directly through PostgREST, choosing its own
`key_hash`, scopes or rate limit.

## Decision

A route may use the service-role client for a write when **all** of the following hold, in this
order:

1. A fail-closed IP flood guard runs before authentication.
2. The caller is a signed-in user, read from the RLS-scoped server client (`supabase.auth.getUser()`).
3. A fail-closed per-user write limiter runs before any permission lookup.
4. The user's `admin` row in `site_permissions` for the target site is read **through the
   RLS-scoped client**, and the route refuses without it.
5. Only then is the service-role client created, and every write it issues is scoped by the ids
   the checks established (site id, and the session `user_id` for per-user rows) — never by ids
   taken from the request alone.

Anything a credential created this way authorises must re-check that standing at use time
(s42 review M1: `validateAPIKey` re-reads the creator's admin row on every call).

## Consequences

- `api-keys` (s42) implements all five steps. The four older routes share steps 2, 4 and 5; their
  limiters were not audited when this was written, so each adopts steps 1 and 3 on its next change.
  A route that cannot state which step each line implements is not conforming.
- ADR 002's widget rule is unchanged: a site token or editor grant still reaches the service role
  only through the `authorize*` helpers.
- AGENTS.md "Data access" names this second principal so a future agent does not "fix" a
  conforming route back into an RLS write that ADR 034 forbids.
