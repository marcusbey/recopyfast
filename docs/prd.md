# PRD — RecopyFast

> Source of truth for scope. Everything in `docs/` is subordinate to this file.
> Status: product is built and in production with 0 users. This PRD is a
> **re-framing of an existing codebase**, not a greenfield spec. Its job is to
> say what earns its place, what gets frozen, and what we sell.

---

## Target SaaS

**TinaCMS** (https://tina.io) and **CloudCannon** (https://cloudcannon.com) — visual/inline
editing layers that let a non-developer click text on a live site and change it.

They are the closest functional match to RecopyFast: same promise (edit the real
rendered page, not a backend form), same buyer (the person who owns the site and is
tired of being the bottleneck).

Secondary reference points, not direct targets: Contentful/Storyblok (headless CMS —
solve the same pain by re-architecting), Webflow Editor (solves it by owning the site).

## Kill mode

**Competing product — we sell it.** Multi-tenant SaaS, self-serve signup, Stripe billing,
plan tiers, public marketing surface, support obligation.

Implications for scope, non-negotiable:

- Every feature must survive a stranger using it without us in the room.
- Billing, entitlements and quota enforcement are core loop, not plumbing.
- The embed script runs on domains we do not control. Security and performance
  regressions there are customer-facing incidents, not bugs.
- We need a pricing page, a comparison surface, and an acquisition engine — hence
  the SEO and GTM sections below, which are part of the product, not marketing afterthought.

## Why kill it

**What the target costs.** TinaCMS Team plans start around $49/mo and price per user
above that. CloudCannon starts around $45 per site per month. For an agency with 15
client sites, CloudCannon is ~$8k/year before a single client logs in.

**What it does badly for our case:**

1. **It demands a migration before the first word is edited.** TinaCMS requires wrapping
   your app in their React components and adopting a git-backed content backend.
   CloudCannon requires your site be a supported static-site generator that *they*
   build and host. Neither works on a WordPress theme, a bespoke PHP site, a Squarespace
   export, or the 200-line HTML page a local plumber paid €600 for in 2019 — which is
   the majority of the addressable market.
2. **It is a developer product wearing a marketer's clothes.** The onboarding assumes
   a repo, a build, a schema. A dentist will never complete it.
3. **Per-seat and per-site pricing punishes the exact usage pattern we serve** — many
   sites, each edited rarely, by people who log in four times a year.
4. **The client still needs an account.** Every competitor puts an auth wall between the
   business owner and their own homepage copy.

**What we do not need from it:** their build pipelines, their hosting, their media DAM,
their content-model/schema designer, their git-branch-per-editor workflow, their
page/route creation, their layout editing. We do not build sites. We edit sites that
already exist.

---

## Problem

Changing one word on a website costs a developer ticket, two days of latency, and
€50–150 — or it costs an agency an hour of unbillable maintenance they will never
invoice. The people who own the words are structurally unable to change them.

Every existing answer to this requires re-platforming the site first. So most sites
just go stale: wrong opening hours, last year's prices, a promo that ended in March.

**Why now:** AI makes the *editing* part nearly free (rewrite, translate, suggest), which
moves the bottleneck entirely to access. Whoever solves access — not editing — wins.

## Target users

**1. Local business owner** (restaurant, dental practice, gym, law firm, plumber).
Site was built once by an agency or a freelancer. Needs to change hours, a price, a
promo banner, a phone number — roughly 4–10 times a year. Zero technical skill, zero
patience, will not learn a CMS, will not remember a password. Currently emails the
agency, or does nothing.

**2. Agency / freelance web studio** — the buyer. 5–50 client sites across mixed stacks
(WordPress, Webflow, Next.js, hand-rolled HTML). Copy changes are a recurring,
unbillable support drain that they cannot price and cannot refuse. Wants to hand clients
a *safe, bounded* editing surface: no dashboard, no layout access, no way to break the
site. Cares about their own margin, not about CMS features.

**3. In-house marketer on a dev-owned site.** Wants to change a headline and measure it
without waiting for a sprint. This is who buys Pro (A/B + per-section impressions).

Primary buyer is **(2)**. Primary user is **(1)**. Design for (1), sell to (2). They are
not the same person and the product must never confuse them.

---

## Perimeter — the 20% that matters

### Replicated (core loop)

The core loop, stated once: **register a site → get a script tag → install it → invite
someone by email → they edit the live page → it publishes.** Everything below either
serves that loop or serves the business around it.

| # | Feature | Complexity (1-5) | Why this score |
|---|---|---|---|
| 1 | Auth + account (email/password, session, profile) | 2 | Standard Supabase Auth. Form + persistence + session. No SSO, no magic-link-only flows. |
| 2 | Site registration → site id + signed site token + embed snippet | 3 | Business logic: token signing, domain binding, ownership row in `site_permissions`. Several states (registered / unverified / live). |
| 3 | Script generation + sharing + install verification | 3 | Snippet generation is trivial; *proving the script is live on their domain* is not. Needs `domains/verify` + a green "we can see your site" state. This is the activation gate. |
| 4 | Embed runtime: DOM scan, resilient selector generation, content map, MutationObserver | 4 | Runs on hostile third-party DOM. Selectors must survive re-renders and framework hydration. Perf budget < 30KB gz, no layout shift. Hardest correctness surface in the product. |
| 5 | Inline editing on the live page (edit mode) | 3 | In-context editing overlay, debounced persist, optimistic UI. |
| 6 | Email invitation → **non-account** edit grant (request-code → submit-code → scoped, expiring grant; handoff create/redeem; refresh) | 4 | Auth-adjacent with roles, expiry, revocation and scope. Security-critical: a leaked grant is a defacement. This is the angle, so it must be the most hardened thing we own. |
| 7 | Payment flow: Stripe subscriptions (tiers) + AI credit top-ups + entitlement resolution | 4 | Payments, roles, quota enforcement, webhook reconciliation, DB-driven catalogue, lifetime grants. Already serialized checkout + CAS credit spend. |
| 8 | AI edit — suggest / rewrite in place | 3 | External API, credit metering, prompt + context extraction from the live element. |
| 9 | AI translate + language variants | 3 | Same machinery as (8) plus the `language` dimension already in `content_elements`. |
| 10 | Images — upload / replace in place | 3 | Storage, validation, format/size limits, serving. Bounded scope: replace an existing `<img>`, never add new media blocks. |
| 11 | Real-time multi-user sync (Socket.io, room per site) | 5 | Separate deployed service, reconnection, Redis pub/sub for horizontal scale, conflict handling. A 5 that stays because "the page updates while you watch" *is* the demo. |
| 12 | Content versioning + rollback | 3 | Append-only history + restore. Cheap, and it is what makes handing edit rights to a stranger survivable. |
| 13 | Staging → publish workflow | 4 | Draft/live split across the whole content model, approval state, publish transaction. Earns its place because agencies will not hand clients direct-to-live access. |
| 14 | A/B testing: variants, traffic bucketing, lifecycle cron, results | 5 | Real-time bucketing at the edge of the embed script, statistical results, scheduled lifecycle. Kept because it is the Pro upsell and it shares infrastructure with (15). **Built, then parked out of the launch on 2026-08-03 (`dashboard/_ab-tests`). Decision: re-enabled — see stories s08/s09.** |
| 15 | Per-section impression tracking (Pro) | 4 | IntersectionObserver in the embed script + high-volume ingest + aggregation. Volume risk is real. This is the differentiator no competitor has. |
| 16 | Analytics dashboard + export | 3 | Read models over (15) plus edit activity. |
| 17 | Public API v1 + API keys | 3 | Key issuance, scoping, rate limiting. Present because TinaCMS's audience is developers and parity matters in the comparison table. |
| 18 | Outgoing webhooks (content changed) | 3 | Delivery, retries, signing. Required for static-site customers who must trigger a rebuild — exactly the target's turf. |
| 19 | Bulk import / export (content in/out) | 2 | CSV/JSON round-trip. Cheap, and it kills the lock-in objection in the sales call. |

Scale: 1 trivial CRUD · 2 form + persistence + list · 3 business logic / several states ·
4 integrations, payments, roles · 5 real-time, migrations, external systems.

**Two 5s survive** (real-time sync, A/B). Both are load-bearing: the first is the demo,
the second is the reason anyone pays for Pro. Everything else is 4 or below.

### Explicitly NOT replicated (graveyard)

Built or partially built, now **frozen** — no new work, no bug budget, no surface in
the UI unless a paying customer blocks on it:

- **Teams with org roles** (`/api/teams/*`, members, org activity). Superseded by the
  email-invite grant model in (6). Owner + invited editor is the whole permission model.
- **Audit log / compliance console** (`/api/audit/*`). Enterprise-shaped. No buyer at
  our price point.
- **Security events dashboard** (`/api/security/events`, `/stats`). Keep the logging,
  drop the customer-facing surface.
- **Notification centre** (`/api/notifications`). Email is enough at this scale.
- **Site-wide theme editor** (`edit-board/themes`, `edit-board/styles/apply`). We do not
  restyle a site. The moment we edit design at that scope we inherit "you broke my site"
  support forever.
  **Not covered by this entry:** per-element typography and colour controls in the editor
  toolbar (`TypographyPanel`, `ColorPicker`, `FontSizeSelector`, `TextAlignmentControls`).
  Changing one heading's size is content-adjacent, it is shipped, and it stays.

Never built, and never will be:

- Page / route creation, layout editing, component insertion. **We edit what exists.**
- Content-model / schema designer.
- Git backend, build pipelines, hosting, preview deploys, media DAM.
- SSO/SAML, SCIM, audit exports, data residency, self-host, on-prem.
- White-label full domain (a branded subdomain in the Agency plan is in scope; a full
  white-label product is not).
- Native mobile apps.
- WYSIWYG page builder of any kind.

**Resolved**: no free tier. Access is gated by a **14-day Pro trial without a card**
(story `s01-trial-signup`). The code today denies any account with no plan
(`getEffectivePlan` has no free tier to fall through to); the trial is modelled as a
time-boxed grant of the `pro` plan, reusing the mechanism `lifetime_pro` already uses —
not as a new catalogue row.

### The angle (done differently / better)

1. **Zero migration.** One script tag, any stack, any host, no rebuild, no API
   integration, no repo access. Time-to-first-edit measured in minutes, not an
   afternoon. This is structural, not a feature — it is the reason the other four
   angles are reachable at all.
2. **Editing without an account.** The client receives an email link, lands on their
   own page in edit mode, changes the text, done. No signup, no password, no dashboard,
   no training. Every competitor puts an auth wall here. Removing it is the single
   biggest activation win available and the hardest thing to copy without rebuilding
   their permission model.
3. **AI edit and translate in place.** Rewrite or translate a section on the real
   rendered page, in context, seeing the surrounding design. Competitors bolt AI onto a
   backend form where the model cannot see what the sentence sits next to.
4. **Per-section impression analytics.** We know which paragraph is actually seen, so we
   can tell you which one to fix. Nobody ties editing to per-block visibility. It turns
   a CMS into a decision tool.
5. **Simple enough for four uses a year.** The local-business reality: the interface must
   be re-learnable from zero, every time, with no memory of the last session. This is a
   hard design constraint, not a nice-to-have — it disqualifies dashboards, sidebars,
   modes, and settings from the client-facing surface.
6. **Agency-first: bounded autonomy as a product.** The agency decides what a client can
   touch, for how long, with rollback and staging behind it. We sell an agency the
   ability to say yes to their client without risk. That framing — not "CMS" — is the
   wedge.

---

## Constraints

**Technical**

- Next.js 16 (App Router) + React 19 + TypeScript strict, deployed on Vercel.
- Socket.io server is a **separate deployed service** (Railway/Render). Cross-service
  auth, CORS and scaling are permanent costs of feature (11).
- Supabase Postgres with RLS as the multi-tenant boundary. Every table needs a policy;
  a missing one is a cross-tenant leak.
- Stripe with a **DB-driven catalogue** — `plans` table is source of truth, Stripe price
  ids come from env. No hardcoded fallback prices (deliberate: a stale fallback once
  served drifted prices at checkout).
- **Embed script budget: < 30KB gzipped, async, zero layout shift, zero uncaught errors.**
  It runs on customer domains — a regression here degrades *their* Core Web Vitals and
  becomes a churn event and an SEO liability for them.
- Third-party context constraints: CSP, CORS, third-party cookie deprecation, Shadow DOM,
  hydration races. The runtime must degrade to read-only rather than break the host page.
- Redis for rate limiting, sessions and pub/sub.
- Sentry for errors; existing QA register and Playwright/Jest suites.

**Business / time**

- Small team. Two 5-complexity features already in flight is the ceiling.
- 0 users today: **no migration debt, no backwards-compatibility obligation.** This is a
  one-time window to cut scope hard. It closes with the first paying customer.
- Existing production deployment must stay green throughout.

**Dependencies**

- Stripe (billing), Supabase (DB/auth/storage), OpenAI (AI features), Resend (email),
  Vercel + Railway/Render (hosting), Redis.

---

## Success criteria

**Primary metric: time-to-first-edit < 5 minutes** — from account creation to the first
persisted change on the customer's real site. Instrumented as
`signup → site registered → script detected on domain → first content_element update`,
measured at p50 and p90. TinaCMS and CloudCannon both measure this in hours because both
require a migration first. This is the head-to-head win and it is objective.

**Parity checklist on the perimeter** — each must be demonstrable by a stranger, unaided:

- [ ] Register a site and get a working snippet in < 60s.
- [ ] Install snippet on a WordPress site, a Next.js site and a plain HTML page; content
      is detected on all three; install verification turns green automatically.
- [ ] Edit text on the live page; change persists and appears in a second browser in
      < 1s (real-time parity).
- [ ] Invite by email; recipient edits **without creating an account**; grant expires;
      grant is revocable and revocation is immediate.
- [ ] Rollback restores a prior version.
- [ ] Staging edits are invisible to public traffic until published.
- [ ] AI rewrite and AI translate produce a usable result in-place and debit credits
      correctly (balance never goes negative under concurrent spend).
- [ ] Replace an image in place.
- [ ] Run an A/B test end to end: variants, split, results, automatic lifecycle.
- [ ] Per-section impressions visible to Pro, gated for Starter.
- [ ] Export all content and re-import it losslessly.
- [ ] Subscribe, upgrade, downgrade, cancel, reactivate — entitlements track correctly
      at every step; a webhook replay does not double-grant.

**Angle criteria (measurable, beyond parity)**

| Angle | Measure | Target |
|---|---|---|
| Zero migration | Stacks with a verified install recipe | ≥ 8 (WordPress, Shopify, Webflow, Squarespace, Framer, Next.js, Astro, plain HTML) |
| No-account editing | Share of edits made by non-account grant holders | ≥ 50% of all edits |
| Simple for rare use | Invited editor completes first edit unaided, no support contact | ≥ 80% |
| AI in place | Share of edits touching AI rewrite/translate | ≥ 30% |
| Per-section impressions | Pro accounts with ≥ 1 impression-informed edit | ≥ 40% |
| Agency wedge | Paying accounts with ≥ 3 client sites | primary revenue cohort |

**Quality gates (non-negotiable, this is a production system)**

- Embed script ≤ 30KB gz; no CLS contribution; no host-page console errors.
- Test coverage ≥ 80%; `lint`, `type-check`, `build`, `test` green before merge.
- Zero cross-tenant reads: RLS policy present on every tenant-scoped table.
- No unauthenticated write path to content, A/B, or event ingest.

---

## SEO strategy

SEO is not downstream of the product here — the product's reach *is* the SEO thesis.
"Works with any stack" is only credible if there is a real page proving it for each stack.

**Existing surface:** `src/app/sitemap.ts`, `robots.ts`, `blog/[slug]`,
`opengraph-image.tsx`, `manifest.ts`, and a `cron/generate-blog-post` job.

### Intent map

| Intent | Query shape | Landing surface |
|---|---|---|
| Problem-aware | "edit website without developer", "let client update their own website", "change website text myself" | Home + `/for/<vertical>` |
| Solution-aware | "inline CMS for existing website", "add CMS to existing site", "CMS without rebuilding site" | Product pages |
| Comparison | "TinaCMS alternative", "CloudCannon alternative", "Contentful vs", "Decap CMS alternative" | `/alternatives/<competitor>` |
| Stack-specific | "CMS for Astro", "let client edit Next.js site", "WordPress alternative for static site" | `/cms-for/<stack>` |
| Agency | "stop doing free client website updates", "client content updates agency" | `/agencies/*` |

### Programmatic clusters

Four clusters, each with a **non-thin differentiator** — a page that only swaps a noun
gets deindexed under the Helpful Content system. The differentiator is always a real,
tested install recipe or a real dataset.

1. **`/alternatives/<competitor>`** — tinacms, cloudcannon, contentful, storyblok,
   decap-cms, prismic, builder-io, sanity, webflow-editor, siteleaf.
   Differentiator: honest comparison table including where *they* win, plus a migration
   note. Comparison pages that admit weakness get cited by LLMs; pure marketing does not.
2. **`/cms-for/<stack>`** — wordpress, shopify, webflow, squarespace, framer, next-js,
   astro, hugo, jekyll, eleventy, gatsby, php, laravel, rails, plain-html.
   Differentiator: the exact snippet and install location for that stack, tested, with a
   screenshot of it working. This doubles as product documentation — one artefact, two jobs.
3. **`/for/<vertical>`** — restaurants, dental practices, law firms, gyms, salons, real
   estate, clinics, tradespeople.
   Differentiator: the actual content that changes for that vertical (hours, menu, price
   list, staff roster) and a pre-built element preset.
4. **`/agencies/<use-case>`** — client content updates, unbillable maintenance,
   white-label client editing, multi-site management.

**Publishing discipline:** the existing `cron/generate-blog-post` becomes the cluster
draft engine, but **it drafts, a human publishes.** Auto-publishing AI content at cluster
scale is the fastest route to a site-wide quality demotion. Gate it.

### Technical SEO

- Ship `llms.txt` and keep comparison tables in clean semantic HTML — AI search
  (AI Overviews, ChatGPT, Perplexity) is a growing share of "X alternative" queries and
  it cites structured, hedged, source-linked comparisons.
- `SoftwareApplication` + `FAQPage` + `BreadcrumbList` JSON-LD on product and cluster pages.
- Sitemap must include the programmatic clusters; keep it generated, never hand-written.
- **Our own Core Web Vitals are a sales argument.** A CMS vendor with a slow site cannot
  credibly promise a fast embed. Publish the embed script's perf budget as a public page
  and treat it as marketing collateral.

### Link acquisition

- **The embed script is a distribution surface.** An optional, tasteful "Edited with
  RecopyFast" badge on Starter (removable on Pro) puts a referral link on every customer
  site. Use `rel="nofollow sponsored"` — the value is referral traffic and brand, and
  faking link equity across a footprint we control is exactly what gets a footprint
  penalized.
- Free public tools as link bait, each reusing code we already have: a
  "content extractor" that shows what would be editable on any URL, and a
  "translate my page" preview.
- Agency partner directory — partners link to us, we link to them. Real reciprocity,
  real pages.

---

## GTM strategy

**Motion: agency-led PLG.** One agency account is 5–50 sites and 5–50 end users we never
pay to acquire. CAC amortizes across their whole book. Selling to the local business
directly is a losing unit economic — they churn, they forget, they never expand.

**Wedge message (to the agency):** *"Stop doing free copy changes for your clients."*
That is a monthly P&L pain an agency owner already feels and already has a number for.
It is not a CMS pitch, and it should never be pitched as one.

**Wedge message (to the end client):** *"Click the link in your email, change the text,
done."* No product name required for them to succeed.

### Channels, ranked by expected efficiency

1. **Agency and freelancer communities** — r/web_design, r/freelance, Indie Hackers,
   Webflow/Framer/WordPress Facebook groups and Discords. Show the 60-second install,
   not the feature list.
2. **Comparison + stack SEO** (above). Compounding, and it is the same artefact as docs.
3. **Marketplace distribution — highest leverage, currently missing.** A WordPress plugin
   and a Shopify/Webflow app remove the install step entirely for the largest stacks. A
   plugin listing is a permanent, ranked acquisition channel. Post-MVP, but it should be
   the first post-launch investment.
4. **Direct outreach to agencies** with visible client portfolios — the portfolio page
   *is* the lead list, and every site on it is a site we can demo on live before the call.
5. **Affiliate / partner program** — 20–30% recurring for agencies. Aligns exactly with
   the agency-led motion.

### Pricing ladder

Current catalogue in code: `starter`, `pro`, `credits` (one-time top-up),
`lifetime_pro`. Subscription covers sites and seats; **credits cover AI only** — that
boundary is already enforced in `feature-gating/permissions.ts` and is correct: a wallet
balance must never be mistaken for a quota.

| Tier | For | Gets |
|---|---|---|
| Starter | Solo owner, one site | 1 site, inline editing, versioning/rollback, invite by email, optional badge |
| Pro | Marketer, small business | Several sites, **per-section impressions**, A/B testing, staging→publish, no badge, API + webhooks |
| **Agency (missing)** | The actual buyer | N sites, client sub-accounts, branded subdomain, bulk seat handoff, consolidated billing |
| Credits | Anyone | AI rewrite + translate, metered |
| Lifetime Pro | Launch offer | Pro entitlement, one payment |

**The Agency plan does not exist in code.** Given that agencies are the chosen buyer and
the chosen angle, this is the single largest GTM gap in the product today.

### Activation and retention

- **Activation = time-to-first-edit < 5 min.** Instrument the funnel end to end and treat
  every drop-off step as a P1. Install verification must be automatic and visibly green;
  a customer who is unsure whether the script is working has already churned.
- **Retention lives with the agency, not the end client.** A local business logs in four
  times a year — measuring their MAU will look like catastrophic churn and it means
  nothing. Bill the agency, prefer annual, and make value legible with a monthly digest:
  *"your clients made 34 edits this month — roughly 6 hours you didn't spend."*
- End-client engagement is a *quality* signal, not a retention metric. Track
  "edits completed unaided" instead.

### Launch sequence

1. Private beta: 5 agencies, ~40 real client sites, hands-on. Fix activation until
   time-to-first-edit holds under 5 minutes with no hand-holding.
2. Two written case studies with real hours-saved numbers.
3. Ship the Agency plan.
4. Public launch: Product Hunt + community channels + the comparison cluster live.
5. WordPress plugin listing.

---

## Decisions log

Resolved at `/ks-stories`:

1. **Free tier or trial?** → **14-day Pro trial, no card.** Story `s01-trial-signup`.
2. **A/B testing: parked or in?** → **Re-enabled.** It was pulled from the launch on
   2026-08-03 and is back in the perimeter. Stories `s08` and `s09`.
3. **Style editing scope?** → **Per-element typography and colour stay; site-wide themes
   stay in the graveyard.** No removal story.
4. **Impression definition** → ≥ 50% of the section in viewport for ≥ 1 continuous second,
   one impression per section per page view, no visitor identifier. Story `s06`.

Still open:

5. **Agency plan shape.** Who is billed — agency only, or agency with client-paid
   upgrades? `s10` assumes agency-only, single invoice. Confirm before `s10` reaches
   `/ks-plan`.
6. **Conversion definition for A/B.** `s09` proposes section impression → click on a
   tracked CTA. Needs agreement before the significance work starts.
7. **WordPress plugin priority** — first post-launch investment, or later? Not in the
   current backlog either way.
8. **Badge.** Ship the "Edited with RecopyFast" badge, or drop it? Affects the SEO
   link-acquisition plan above; affects no story in the current backlog.

---

*Anything below the perimeter table that is already built and now sits in the graveyard
stays deployed and untouched. Frozen means no new work — it does not mean delete.*
