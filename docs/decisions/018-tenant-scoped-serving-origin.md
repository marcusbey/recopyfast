# ADR 018 — A tenant-scoped serving origin, resolved per request from a permanent claims table

- Status: accepted
- Date: 2026-08-16
- Scope: story s20-agency-branded-subdomain

## Context

The embed origin is a process-wide constant today, not a per-account value. `getPublicAppUrl()`
(`src/lib/sites/embed-script.ts:42-46`) reads exactly one env var, `NEXT_PUBLIC_APP_URL`, with no
argument that could vary it per caller. `canonicalizePublicAppUrl` (`embed-script.ts:29-40`)
hardcodes a single apex→www rewrite, and the comment above it (`:20-24`) records why that rewrite
exists at all:

> The apex host 308s to www. Browser CORS preflights cannot follow that redirect, so a snippet
> that points at recopyfa.st makes the widget look dead on every customer site (B-11). Rewrite
> only that exact hostname; previews, localhost, and an already-canonical www stay as configured.

Both functions take zero tenant-identifying input. There is no way, today, for two different
accounts to be served from two different origins in the same process — the concept of "whose
origin is this" does not exist anywhere in the code path a snippet is built from.

`s13-agency-plan` (`docs/stories.md:755-803`) is explicit that a branded subdomain is in scope —
the PRD rules it in deliberately: *"White-label full domain (a branded subdomain in the Agency
plan is in scope; a full white-label product is not)"* (`prd.md:159-160`). Research
(`docs/research/s13-agency-plan.md` § M4) found this is not a parameter change to
`getPublicAppUrl()`; it is a new concept — *a tenant-scoped serving origin* — that has to be
threaded through five independent surfaces, each of which is deliberate, load-bearing code
carrying its own tombstone comment for an incident it already closed:

1. **Snippet emission.** Three call sites build the embed script with no `appUrl` override, so
   each defaults silently to the single global origin: `src/app/api/sites/route.ts:107-109`,
   `src/app/api/sites/register/route.ts:189-190`,
   `src/components/dashboard/SiteDetailView.tsx:98-103`.
2. **The content route's CORS grant.** `withCors` in
   `src/app/api/content/[siteId]/route.ts:172-190` accepts one `allowedOrigin` and, when none is
   passed, falls back straight to `process.env.NEXT_PUBLIC_APP_URL` (`:178`). A request whose
   `Origin` is a branded host the route has never been told about gets no grant — indistinguishable
   from an unrecognised, unauthorized origin, because today it *is* one.
3. **Our CSP.** `src/middleware.ts:196-259` derives `connect-src` from a fixed set of env-derived
   origins (`:207-235`) and `default-src 'self'` is evaluated per serving origin. A branded host
   is not in that set by construction — nothing populates it from a database.
4. **The auth-redirect resolver.** `resolvePublicOrigin` (`src/app/auth/public-origin.ts:70-111`)
   ranks `NEXT_PUBLIC_APP_URL` above the request's own host (`:76-85`) precisely because an
   earlier incident showed why: confirming a magic link against one host and redirecting to
   another leaves the just-set session cookie behind, landing the user signed out (`:28-46`,
   the `warnIfConfiguredOriginIsElsewhere` tombstone). Left unmodified, a session set on a
   branded host would be redirected straight back to the canonical origin — reproducing that
   exact incident for every agency that claims a subdomain.
5. **The Stripe return-URL builder.** `getAppBaseUrl` in `src/lib/stripe/checkout.ts:68-84` has
   the identical shape and the identical incident behind it: register item F-14 (`:60-67`)
   records a customer charged on a preview deployment and returned to
   `https://www.recopyfa.st` holding a cookie scoped to the preview host — charged, and staring
   at a paywall while logged out. `getAppBaseUrl` and `resolvePublicOrigin` are deliberately
   "the same resolver" so the two never disagree about which host a given user belongs on
   (`checkout.ts:64-66`).

A tenant-scoped origin has to thread through all five without reopening any of these. It also has
to answer a question none of the five have ever had to ask: not just *which* origin is canonical,
but *whose* it is, resolved from data instead of from `process.env`.

## Decision

**Store the claim once, in a table shaped for permanence, and resolve it through exactly one
function that every calling surface uses and nothing else.**

- A new table, `agency_branded_origins` — `user_id` (the claiming agency), `subdomain`
  (lowercased, globally `UNIQUE`), `status` (`'pending' | 'active'`, CHECK-constrained),
  `claimed_at`, `verified_at` — with its RLS policy in the same migration, per non-negotiable 6:
  the owner may `SELECT` their own row; every write is `service_role` only. There is deliberately
  **no delete path and no `ON DELETE CASCADE` from the user**, and `status` never returns to
  `pending` and never becomes `revoked`. Both absences are explained under Consequences below —
  a reviewer who "fixes" either is disabling the guarantee the table exists to provide.
- A new resolver, `src/lib/sites/serving-origin.ts`, exporting one function that maps a site (or
  its owning account) to the origin its snippet, its CORS grant, its CSP admission, its
  auth-redirect and its Stripe return URL must all agree on:
  - An `active` claim yields the branded origin, passed through the same canonicalisation
    contract `canonicalizePublicAppUrl` already enforces — returned only in the form that serves
    directly, **never** a form that 308s. This is not a second canonicalisation rule; it is the
    same one, applied to a second possible input.
  - A `pending` claim, no claim at all, or a failed lookup all yield exactly what
    `getPublicAppUrl()` yields today. Fail-safe here means failing *toward* the origin already
    proven to work, not toward the one just requested — an outage in the lookup must degrade to
    "acts like this story doesn't exist yet," never to "acts like every snippet is broken."
- `embed-script.ts`'s `getPublicAppUrl` and `canonicalizePublicAppUrl` are not replaced and do not
  change behaviour. The resolver *wraps* them — it is the default branch of the new function, and
  remains the only behaviour any snippet issued before this story, or any account with no claim,
  will ever observe. This is the architectural move stated plainly: **the serving origin stops
  being a process-wide constant and becomes a tenant-scoped lookup**, but the constant does not
  go anywhere — it becomes the fallback every other branch resolves to.
- The content route's CORS grant widens to accept the resolved branded origin **in addition to**
  the default, never instead of it. Absence of the `Access-Control-Allow-Origin` header is how
  "no grant" is expressed on this codebase (AGENTS.md § API routes) — that must keep meaning
  exactly what it means today for every account with no claim, which is the overwhelming majority
  of installs and will remain so indefinitely.
- The five call sites each call the resolver and nothing else. The plan (`docs/plans/
  s20-agency-branded-subdomain.md`, T4–T8) enforces this as five separate, individually testable
  threading tasks precisely so that no call site quietly invents its own second notion of
  "the origin."

## Considered options

- **(a) Leave the origin a global constant; do not build the feature.** This is the status quo,
  and it is not neutral — the PRD names the branded subdomain the agency white-label wedge and
  rules it explicitly in scope (`prd.md:159-160`) while ruling a full white-label product out.
  Declining to build it leaves the Agency plan (`s13`) without the one differentiator its pricing
  row already promises, and leaves `docs/research/s13-agency-plan.md`'s M4 finding — that this is
  a second, independent external-systems axis — permanently unresolved rather than deliberately
  scoped down. Rejected: it is a real cost, not a free option.
- **(b) Full custom domains per agency, not subdomains of ours.** Rejected on two independent
  grounds. First, scope: the PRD's graveyard explicitly rules full white-label *out* while ruling
  a branded subdomain of ours *in* (`prd.md:159-160`) — building custom domains answers a question
  the PRD already answered the other way. Second, operational surface: a customer-owned domain
  means customer-owned TLS, a certificate issuance and renewal path we do not control, and a DNS
  delegation relationship per agency instead of one wildcard (or one issuance flow) under our own
  zone. That is a materially larger, materially less controllable surface for the same product
  outcome a subdomain already delivers.
- **(c) A redirect from the branded origin to the canonical one.** Rejected outright, and this is
  not a judgement call — it reproduces a documented, already-fixed failure. The exact reason
  `canonicalizePublicAppUrl` exists is that *"Browser CORS preflights cannot follow that
  redirect, so a snippet that points at recopyfa.st makes the widget look dead on every customer
  site"* (`embed-script.ts:20-23`, incident B-11). A branded host that 308s to the canonical
  origin is the same bug wearing a different hostname, and it would break every client site of
  every agency simultaneously, silently, because the widget degrades without an error surface on
  the customer's page (`architecture.md:298-300`).
- **(d) Per-tenant deploys — a separate Vercel deployment/environment per branded agency.**
  Rejected. It multiplies the deployed-artifact surface that AGENTS.md non-negotiable 2 already
  treats as singular and permanent per install, turning one `/embed/recopyfast.js` promise into
  N of them, each independently capable of drifting. Every migration, every env var, and every
  future story touching the serving origin would need to fan out across N deployments instead of
  reading one row in one table in the one database ADR 001 already commits to as the tenant
  boundary. It also does not remove any of the five threading points above — a per-tenant deploy
  still needs its own CSP, its own CORS grant, its own auth-redirect resolution — it just pays for
  each of them N times instead of once. A claims table inside the single existing deployment is
  strictly less surface for the identical observable outcome.

## Consequences

**Irreversible, and it outlives the relationship that created it.** AGENTS.md non-negotiable 2
states plainly that `/embed/recopyfast.js` *"is already baked into every snippet ever issued. It
can never move or break for existing installs."* A branded subdomain inherits that exact promise
the moment its first snippet is copied onto a client's page, and it compounds it: the snippet is
not on the agency's own site, where the agency could at least in principle notice and fix a
problem — it is on their **client's** site, a domain this product does not control, cannot audit,
and cannot patch. When an agency's Agency subscription is cancelled, expires, or is downgraded,
`agency_branded_origins.status` does not change, because nothing in the resolver or anywhere else
reads billing state to decide it. The claim's lifecycle (`pending` → `active`) is deliberately
decoupled from the subscription's lifecycle (`active` → `past_due` → `canceled`), and that
decoupling is the whole point: `acme.recopyfa.st` must keep serving after Acme has stopped
paying, because Acme's *clients'* sites are still live and still pointed at it, and neither Acme
nor we will hear about a failure first — the widget's silent degradation (non-negotiable 4) means
a withdrawn origin does not alert anyone, it just produces "editing stopped working on one site,"
reported weeks later, by someone three steps removed from the account that churned. This is why
`agency_branded_origins` has no delete path, no `ON DELETE CASCADE`, and no code path anywhere
that transitions `status` back to `pending` or to a `revoked` value that does not exist: there is
no un-claim, by design. The only route to correcting a claim is a human operator acting directly
against the database, outside any product surface, aware of exactly what that costs — the plan's
run interdict 2 states this as a rule, not a gap: *"Never expose a way to change, release or
re-point a claimed subdomain. Not in the UI, not in the API, not in an admin script."*

**Easier.** Every one of the five threading tasks (T4–T8 in the plan) becomes "call the resolver"
instead of "invent a per-surface answer to whose origin this is." A reviewer checking for a
missed surface has one function to grep for, not five independent implementations to compare.
The byte-identity test (plan T10a) becomes meaningful specifically because both origins run
through the identical handler — the resolver's only effect is which `Origin` gets echoed back.

**Harder.** The resolver's failure mode has to be right in one place for every caller: a bug that
makes it return a branded origin for a `pending` or absent claim is an open redirect at the
auth-redirect surface (T7) and a same-bug-two-places CORS leak at the content route (T5). The
plan's fail-safe rule — a failed lookup falls back to the default, never to a branded guess — is
the single property every one of those five surfaces depends on being true.

**Watch — this ADR does not settle where the branded host physically resolves.** Whether
`*.recopyfa.st` is served by the same Vercel project under one wildcard domain and one wildcard
certificate, or whether each claimed subdomain is provisioned as an individual domain with its
own certificate issuance, is recorded in the plan as **Blocking #1** and is explicitly an
operator/Vercel decision, not a code decision this ADR or its implementation can make. Nothing in
`serving-origin.ts` provisions DNS or a certificate, and nothing should. What this ADR does
commit to, regardless of how that question is answered: the branded host must be canonical from
the first byte and must never be a redirect target (option (c), above) — that constraint binds
identically under a wildcard certificate and under per-subdomain issuance, and the plan's
Definition of Done withholds `validated: yes` until the question is settled.
