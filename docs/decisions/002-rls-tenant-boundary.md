# ADR 002 — RLS is the tenant boundary; the service-role client is a named exception

- Status: accepted
- Date: 2026-08-16
- Scope: framing

## Context

RecopyFast is multi-tenant: one Postgres database holds every customer's content. The PRD
states the boundary plainly — *"Supabase Postgres with RLS as the multi-tenant boundary. Every
table needs a policy; a missing one is a cross-tenant leak"* — and makes "zero cross-tenant
reads" a non-negotiable quality gate.

The complication is the embed widget. It runs on a customer's domain, for a visitor who has no
Supabase session and could not have one. It authenticates with a **site token**, not a user.
RLS policies written against `auth.uid()` cannot express "this request carries a valid site
token", so those paths use `createServiceRoleClient()`, which **bypasses RLS entirely**.

Today 28 of 77 route files use the service-role client. That is not a small exception, and the
history says so: twelve of the 43 migrations exist only to close RLS gaps found after the fact
(`20260611010000_rls_hardening`, `20260611020000_tighten_permissive_policies`,
`20260731007000_rls_analytics_and_ab_tests`, `20260731008000_rls_policies_for_locked_tables`,
`20260804130000_restore_missing_rls_policies`, and more). Every one of those is a period where
a policy was assumed and was not there.

A decision is needed now because `s09` (impression ingest), `s11` (A/B bucketing) and `s16`
(webhooks) all add new widget-facing write paths — exactly the shape that reaches for the
service-role client.

## Decision

**RLS is the boundary. The service-role client is an exception that must be earned per route.**

1. Every tenant-scoped table carries an RLS policy. A new table without one is not shippable —
   the migration that creates it also creates the policy.
2. Route handlers acting on behalf of a signed-in user use `supabase/server.ts`. RLS stays on.
   Do not reach for service-role to make a query "just work"; a query that fails under RLS is
   usually telling you the authorization is wrong.
3. `createServiceRoleClient()` is permitted **only** where the caller is a site token or a
   scoped editor grant — i.e. a principal RLS cannot express — and then the route **must** call
   an explicit authorization helper before touching data:
   `authorizeSiteRequest` / `authorizeFirstPartySiteRequest` / `authorizeSiteOrigin`
   (`src/lib/security/site-auth.ts`) or `authorizeIngestRequest`
   (`src/lib/security/ingest-auth.ts`). Do not write a fourth auth path.
4. A service-role route additionally carries a **fail-closed** rate limiter keyed on the site
   (`onStoreFailure: "deny"`). The credential that opens these paths is published in the
   customer's own page markup; the limiter is what bounds the damage a copied token can do, so
   losing Redis must not remove it.
5. Ownership is read from `site_permissions` (an `admin` row), never from a column on `sites`.

## Considered options

- **Service-role everywhere, authorization purely in application code** — rejected. It makes
  the database boundary decorative and every future route one forgotten check away from a
  cross-tenant read. The twelve RLS-repair migrations are the evidence that application-layer
  discipline alone has already failed here.
- **RLS everywhere, no service-role at all** — rejected as not expressible. A visitor on a
  customer's site has no `auth.uid()`. Emulating one would mean minting a Supabase session per
  anonymous visitor, which is both more credential surface and more cost than the problem.
- **Custom Postgres GUCs / a `set_config`-based site-token claim so RLS can see the site id** —
  rejected for now, but it is the honest long-term answer. It would let widget paths run under
  RLS. Rejected because it means rewriting 28 routes and every policy on `content_elements`
  while the product is trying to reach its first customer, and getting it half-done is worse
  than either end state. Revisit if service-role routes grow past ~40.
- **A separate database or schema per tenant** — rejected. Operationally disproportionate for a
  product whose target customer pays for a handful of sites.

## Consequences

**Easier.** The rule is checkable rather than a matter of taste: grep for
`createServiceRoleClient` and confirm each hit has an authorization call above it. New
widget-facing stories have a stated pattern to follow instead of inventing one.

**Harder.** Service-role routes carry a permanent review burden — they are the routes where a
missing `if` is a customer-visible breach, not a 500. They should be the first place a
security review looks.

**Watch.** The count. 28 of 77 today. If new stories push that ratio up rather than holding it,
the GUC option above stops being premature and this ADR should be superseded.
