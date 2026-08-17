# ADR 019 — The agency is the only payer; a site is never invoiced separately from its owner

- Status: accepted
- Date: 2026-08-17
- Scope: story `s13-agency-plan` (and `s20-agency-branded-subdomain`, which inherits it)
- Settles: PRD open decision 7 (`prd.md:444-446`)

## Context

`prd.md:444-446` left one question open and named it as blocking `s13`:

> **Agency plan shape.** Who is billed — agency only, or agency with client-paid
> upgrades? `s13-agency-plan` assumes agency-only, single invoice. Confirm before `s13`
> reaches `/ks-plan`.

Research (`docs/research/s13-agency-plan.md` § Q1) established that this is not a pricing detail.
The two answers produce different data models, and the difference lands on the single most
load-bearing function in the entitlement path.

Today, **billing is a property of a user, and a site has no payer at all**. Nothing in the schema
answers "which subscription pays for this site":

- `resolveEntitlement(supabase, userId)` (`src/lib/billing/effective-plan.ts:198`) takes one
  identifier — a user — and is called from `src/middleware.ts` with a request-scoped client, so it
  sits in the router, not merely in the gates.
- `canCreateWebsite` (`src/lib/auth/permissions.ts:110-125`) counts a user's `admin` rows against
  exactly one plan's `limits.websites`.
- `getUserSubscription` (`src/lib/billing/subscription.ts:301-313`) takes the most recent live row
  for a user; `billing_subscriptions` carries no uniqueness on (user, scope).
- `resolveSiteOwnerId` (`permissions.ts:155`) answers "whose plan pays for a seat" — a question
  that presumes one plan per site by way of one owner.

Every one of those four presumes a single payer per user. That presumption is not documented
anywhere; it is simply the shape the code has.

## Decision

**Agency-only, single invoice. The agency holds one subscription; every site it owns is covered by
that subscription; no client of an agency ever holds a subscription that pays for an agency's
site.**

Concretely, `s13` stays a catalogue-and-quota story:

- One new `plans` row for Agency, one widened CHECK constraint, one Stripe price id read from env
  per non-negotiable 7 — no hardcoded price.
- One Stripe customer and one subscription, on the agency's `auth.users` id, indistinguishable in
  shape from every other subscription the system already issues.
- `resolveEntitlement`, `countOwnedSites`, `canCreateWebsite`, `getUserSubscription` and
  `resolveSiteOwnerId` are **unchanged**. Not "changed compatibly" — untouched.
- `s13`'s AC 7 ("an agency is billed once, not per site") is therefore satisfied by the system as
  it already stands: billing is per-user, sites are never invoiced individually, and no code needs
  to be written to make that true. The story's job is to prove it with a test, not to build it.

The rule this ADR fixes, stated so a future reader can check code against it in one pass:
**payer identity and site ownership are the same identity, always.** A site's payer is its owner's
subscription. There is no second answer, no override column, and no join table.

## Considered options

- **(a) Agency with client-paid upgrades — the client of an agency pays for their own site's
  plan.** Rejected. Research enumerated exactly what it costs, and none of it is optional:
  1. A payer identity distinct from the site owner has to be recorded — a
     `billing_subscription_id` on `sites`, or a `subscription_sites` join table, plus its RLS
     policy in the same migration (non-negotiable 6).
  2. `resolveEntitlement(supabase, userId)` becomes `(userId, siteId)`. Because it is called from
     `src/middleware.ts`, that signature change propagates into the router — every authenticated
     request path, not just the billing gates.
  3. `canCreateWebsite` loses its meaning: it counts a user's sites against *one* plan's limit,
     and under (a) there is no single plan to count against.
  4. `getUserSubscription` becomes a coin flip: two live subscriptions of different scope, no
     uniqueness constraint, "most recent row" as the tiebreak.
  5. `resolveSiteOwnerId` starts answering the wrong question — "whose plan pays for a seat"
     becomes "whose subscription covers this site", a different lookup with a different failure
     mode.

  Each of those five is a change to a shared path that `s01-trial-signup` also depends on. `s01`
  is already merged-pending and its entitlement chokepoint is built on the current signature.
  Taking (a) re-scores `s13` from complexity 4 to a 5, which under the pipeline's own rule
  (`AGENTS.md`) would force another split — and it would do so on the story that gates `s14` and
  `s20` both.

  This is rejected as a *sequencing* judgement, not a permanent one: nothing here forecloses
  client-paid upgrades later. It says the first Agency plan does not carry a schema change to the
  entitlement path, because that change is a story of its own and has never been scoped as one.

- **(b) Build the join table now, use only the agency branch.** Rejected as speculative
  generality — the table would exist with exactly one value in it, its RLS policy would guard a
  distinction that no code makes, and the two-argument `resolveEntitlement` would ship untested on
  its second argument. A migration is not free to reverse; an unapplied idea is.

## Consequences

**Easier, and this is the main reason it wins.** `s13`'s AC 7 requires no new code, so the story
shrinks to what it actually is: a plan row, a quota, and the tests that prove an agency's Nth site
does not produce an Nth invoice. `s20` inherits a single unambiguous answer to *"whose branded
origin serves this site"* — the owner's, because the owner is the payer — which is exactly the
question ADR 018's resolver has to answer per request. Under (a) that question has two candidate
answers and the resolver would need a rule to choose between them.

**Constrains the product, deliberately.** An agency cannot hand a client a bill. If that becomes a
requirement, it arrives as a new story with its own research, its own migration and its own ADR
superseding this one — not as a widened column added under an existing story.

**A trap this closes.** Because entitlement stays a per-user question, a reviewer will keep seeing
`resolveEntitlement(supabase, userId)` in the middleware and in the gates. Anyone who later adds a
per-site payer must change it in both places at once; the fact that it is *one* function called
from the router is what makes that a visible, greppable change rather than a quiet divergence.
