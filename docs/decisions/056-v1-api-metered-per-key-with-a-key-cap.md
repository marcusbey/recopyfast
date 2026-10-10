# ADR 056 — The public content API is metered per key, and a site holds at most ten keys

- Status: accepted
- Date: 2026-10-09
- Scope: story s77-route-limiters-and-errors (s44 review m2, s42 review m3)
- Amends: ADR 002 §4 for `/api/v1/content` only — nothing else changes.
- Numbering: ADR 055 is taken by s76; renumber at merge if another branch claims 056 first.

## Context

ADR 002 §4 says a service-role route carries a fail-closed rate limiter **keyed on the site**,
because the limiter is what bounds the damage a copied credential can do. `/api/v1/content`
(s44) is a service-role route and meters **per API key** instead
(`src/app/api/v1/content/route.ts:82-97`): one bucket per key, shared by every verb, whose
ceiling is the key's own `rate_limit_per_minute` (default 100, the figure the dashboard prints
beside the key). s44's research justified it — the credential here is the key, a site may hold
several, the dashboard promises a per-key figure, the reviewed predecessor was per key
(`docs/research/s44-v1-rate-limiter.md:149-152`) — and its review asked for the decision to be
written down (`docs/reviews/s44-v1-rate-limiter.md:36-37`).

The review also named the consequence: with no cap on keys per site (s42 review m3), N keys give a
site N × the ceiling. Per-key metering was therefore unbounded per site, which is exactly what §4
exists to prevent.

## Decision

1. `/api/v1/content` stays metered per key, fail closed, behind its fail-closed per-IP guard
   (s44). The key's `rate_limit_per_minute` is not writable by any web principal (ADR 034), so the
   ceiling is ours, not the caller's.
2. A site holds at most **`MAX_API_KEYS_PER_SITE` = 10** keys, active or paused (a paused key can
   be resumed without a create), counted across every admin of the site. `POST /api/api-keys`
   refuses an eleventh with 409 before anything is written.
3. The per-site bound is therefore 10 × the key ceiling: 1,000 requests a minute at the default,
   the same ceiling every widget per-site limiter uses (`API_KEY_DEFAULT`).

## Considered options

- **Re-key the v1 limiter on the site** — rejected. The dashboard shows each key's limit; a
  site-wide bucket would let one integration starve another and make the printed figure false.
- **Both buckets, per key and per site** — rejected for now: with the cap, the per-site bucket
  would only restate decision 3, at one more Redis round trip per request.
- **A cap enforced in the database (trigger with a per-site advisory lock)** — not now. The
  application count is check-then-insert; concurrent creates can overshoot by the number in
  flight, which the fail-closed per-user write limiter (10/min) bounds, and only an admin of the
  site can do it, against their own site's budget. A migration buys exactness the threat does not
  need. Revisit if keys become creatable by anything other than a site admin.

## Consequences

- A site with ten keys must delete one before creating another; the dashboard's error box shows
  the server's message.
- A future change to `rate_limit_per_minute` that lets anyone but the service role write it
  breaks decision 3 and needs this ADR superseded.
- ADR 002 §4's per-site rule is unchanged for every other service-role route.
