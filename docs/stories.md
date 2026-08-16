# User Stories — RecopyFast

> One story = one shippable slice, written to be executed by an agent.
> Id format: `s<number>-<short-slug>` — reused in every pipeline file and in the branch name.
> Scope authority: [`prd.md`](./prd.md). Nothing from the PRD graveyard appears here.

## Reading this file

**This is a delta backlog, not a build plan.** RecopyFast is in production. The core loop —
site registration, embed runtime, inline editing, non-account email grants, versioning,
staging, AI rewrite/translate, image replace, real-time sync, billing, bulk import/export,
API keys — is **built and passing 1954 tests**. Writing stories for it would be
re-implementing working software.

Every story below is one of four things:

1. **A gap** — in the PRD perimeter, not in the code (impressions, Agency plan, trial).
2. **A breach** — built, but violating a stated constraint (embed size).
3. **A reversal** — built, then deliberately disabled, now back in scope (A/B).
4. **A surface** — the acquisition machinery the PRD's SEO/GTM sections require.

Reference implementation for every story: **TinaCMS** (tina.io) and **CloudCannon**
(cloudcannon.com) both run in production. Where they have an equivalent screen, the
agentic notes name it.

### Dependency order

```
s01 ─┬─> s03 ──> (metrics live)
     ├─> s07
     └─> s10 ──> s11 ──> s12
s02 ─┴─> s03
s04  (independent, any time)
s05 ─┬─> s06 ──> s07
     └─> s08 ──> s09
s13  (independent)
s14 ─┬─> s15   (s15 also needs s02)
     └─> s16
```

**s05 blocks s06 and s08.** Both add code to an embed script that is already 57% over
budget. Adding to it first and shrinking later means shipping a regression to customer
sites and then asking them to reload it.

---

## Story s01-trial-signup — 14-day Pro trial without a card

**As a** web agency evaluating RecopyFast **I want** to use the full product for 14 days
without entering a card **so that** I can prove it works on a real client site before
asking anyone to pay.

### Complexity
4 — billing, entitlements and quota enforcement. Touches the path that decides whether
any request is allowed.

### Acceptance criteria
- [ ] A new account, immediately after email confirmation, has Pro-level entitlements without any Stripe customer or payment method existing.
- [ ] `getEffectivePlan` returns an entitled result for a trialling account, and the returned limits equal the `pro` plan's limits.
- [ ] The trial expires exactly 14 days after confirmation; on expiry the same account resolves to unentitled and site/editor creation is refused with `upgradeRequired: true`.
- [ ] Content already created during the trial remains readable and the installed embed script keeps serving current content after expiry — expiry blocks writes and new resources, never public content delivery.
- [ ] Subscribing during the trial converts the account without a gap: entitlements never flicker to unentitled at any point during checkout.
- [ ] An account that has already trialled cannot start a second trial, including after deleting and recreating its sites.
- [ ] The dashboard shows days remaining, and shows an expired state with a single upgrade action once elapsed.
- [ ] AI features during the trial consume credits from a granted trial allowance and stop at zero — a trial never grants uncapped OpenAI spend.

### Dependencies
None.

### Agentic notes
- Core files: `src/lib/billing/entitlements.ts` (`getEffectivePlan` — this is the single
  chokepoint, every gate reads it), `src/lib/feature-gating/permissions.ts`,
  `src/lib/stripe/plans.ts`, `src/lib/credits/system.ts`.
- **Do not add a `trial` plan row.** The catalogue is DB-driven and Stripe-mirrored;
  a plan with no Stripe price will break `resolveStripePriceId` and the public pricing
  feed. Model the trial as a **time-boxed grant of the existing `pro` plan** — the same
  mechanism `lifetime_pro` already uses via `grants_plan_id`. Read how lifetime
  entitlements resolve before writing anything.
- The header comment in `permissions.ts` is explicit that there is no free tier to fall
  through to. Update it; a stale comment there will mislead the next agent working on gates.
- **Trap — clock source.** Expiry must be computed server-side from a stored timestamp,
  never from a client-supplied date. Trial expiry is an authorization boundary.
- **Trap — the flicker.** `checkout-reservation.ts` and `user-lock.ts` already serialize
  checkout. Trial→paid conversion must run inside that same lock, or a concurrent request
  mid-conversion can observe neither trial nor subscription.
- Target reference: CloudCannon offers a 14-day free trial with no card; TinaCMS gates on
  a free tier instead. We match CloudCannon here deliberately — see PRD open decision 1,
  now resolved.

---

## Story s02-install-verified — the site turns green by itself when the script is live

**As a** site owner who just pasted the snippet **I want** the dashboard to confirm by
itself that it can see my site **so that** I know the install worked without asking anyone.

### Complexity
3 — business logic across several states, no new integrations.

### Acceptance criteria
- [ ] A registered site starts in an explicit `awaiting-install` state, visibly distinct from `live`.
- [ ] The first authenticated beacon from the embed script on the registered domain flips the site to `live` without any user action.
- [ ] The dashboard reflects the flip within 10 seconds while the page stays open — no manual refresh.
- [ ] A beacon from a domain other than the registered one does not verify the site and is recorded as a mismatch.
- [ ] The `awaiting-install` state shows the exact snippet, a copy control, and per-platform install locations (at minimum WordPress, Next.js, plain HTML).
- [ ] A site that was live and has received no beacon for a configurable window is shown as `stale`, and `stale` never blocks content delivery or editing.
- [ ] The state and its transition timestamps are readable via the sites API, so s03 can consume them.

### Dependencies
None.

### Agentic notes
- Existing pieces: `src/components/dashboard/DomainVerification.tsx`,
  `src/app/api/domains/verify/route.ts`, `src/components/dashboard/SiteDetailView.tsx`,
  `src/app/api/sites/[siteId]/route.ts`.
- The embed already posts to `/api/analytics/track` with a site token — derive first-contact
  from that existing authenticated ingest rather than adding a second beacon endpoint. One
  ingest path, not two.
- Authorization already exists in `src/lib/security/ingest-auth.ts`. Reuse
  `authorizeIngestRequest`; do not write a new auth path for a status ping.
- **Trap — origin trust.** `src/lib/security/site-auth.ts` already resolves and validates
  request origin, including the localhost case documented in its comments. Verification
  must use that resolution, not a raw `Referer` header.
- **Trap — the stale state must be advisory only.** A customer whose site gets low traffic
  will go quiet. Marking them stale is a nudge; blocking their content would take down
  their site.
- This story is a prerequisite for s15: each `/cms-for/<stack>` page must link to a verified
  install location, and this is where that location gets validated.
- Target reference: CloudCannon's site-connection status; TinaCMS has no equivalent because
  its install is a repo change, not a paste — this is a direct win to make visible.

---

## Story s03-activation-funnel — measure time-to-first-edit

**As the** operator of RecopyFast **I want** the signup → first-edit funnel instrumented
end to end **so that** I can tell whether the product's primary claim is true.

### Complexity
3 — read models and event plumbing over existing data.

### Acceptance criteria
- [ ] Four timestamps are persisted per account: account confirmed, first site registered, first verified install beacon, first persisted content update.
- [ ] Time-to-first-edit is queryable as p50 and p90 over an arbitrary date range.
- [ ] Step-to-step drop-off is queryable: how many accounts reached each of the four steps.
- [ ] Each timestamp is written exactly once per account and is never overwritten by a later event.
- [ ] Backfill produces correct values for accounts that existed before this story shipped, or explicitly marks them as unmeasurable — it never emits a wrong number.
- [ ] Edits made by non-account grant holders are attributed to the site's owning account for funnel purposes, and are separately countable as non-account edits.
- [ ] The funnel is visible to the operator without running SQL by hand.

### Dependencies
`s01-trial-signup` (defines account start), `s02-install-verified` (defines the install step).

### Agentic notes
- Existing: `src/lib/analytics/tracker.ts`, `src/app/api/analytics/track/route.ts`,
  `src/app/api/analytics/performance/route.ts`, `src/app/dashboard/analytics/page.tsx`.
- The PRD names time-to-first-edit < 5 min as the **primary success metric**. It is not
  instrumented today. Until this ships, every claim about activation is unfalsifiable.
- Model as a narrow `account_milestones` table with nullable timestamp columns and a
  write-once constraint, not as a scan over the activity log. The activity log is
  high-volume and will be pruned; milestones must survive pruning.
- **Trap — non-account edits.** The angle predicts ≥50% of edits come from grant holders
  with no account. If attribution keys on `user_id`, those edits vanish from the funnel
  and the metric reads as failure. Key on site ownership.
- `tracker.ts` has two known-dead locals (`siteAnalytics`, `date`) flagged by lint; clean
  them while you are in the file.

---

## Story s04-retire-teams-surface — a dashboard with only what I use

**As a** site owner **I want** the dashboard to show only features I can actually use
**so that** I am not asked to understand an org chart to change my opening hours.

### Complexity
2 — routing and navigation, plus a redirect.

### Acceptance criteria
- [ ] "Teams" is absent from the dashboard navigation.
- [ ] `/dashboard/teams` returns a redirect to the site sharing surface, not a 404 and not a broken page.
- [ ] No remaining dashboard route renders `TeamSelector`, `InvitationManager`, `NotificationCenter` or `SecurityDashboard`.
- [ ] `/api/teams/*`, `/api/notifications`, `/api/security/events`, `/api/security/stats`, `/api/audit/*` continue to respond exactly as before — frozen means unexposed, not deleted.
- [ ] Existing tests for those API routes still pass unchanged.
- [ ] Email invitation to edit a site (the grant flow) is unaffected and remains reachable.

### Dependencies
None.

### Agentic notes
- Files: `src/components/dashboard/DashboardNavigation.tsx` (lines ~59–60 carry the Teams
  entry), `src/app/dashboard/teams/page.tsx`.
- The four components listed above are already imported nowhere outside their own files
  and tests — verified. This story removes the last live entry point, the nav link and
  the route.
- **Do not delete API routes or their tests.** The PRD graveyard says frozen, not deleted.
  A deletion here is unrecoverable scope loss if an agency later asks for real teams.
- Precedent to follow: `src/app/dashboard/_ab-tests/` — the underscore prefix makes a route
  private in the App Router without deleting anything. Same reversible technique applies,
  but this story additionally needs a redirect so existing bookmarks land somewhere sane.
- Note the PRD graveyard entry for the theme/style editor now reads **site-wide themes only**
  (`edit-board/themes`, `edit-board/styles/apply`). The editor toolbar's per-element
  typography and colour controls are content-adjacent and stay. Do not remove
  `TypographyPanel`, `ColorPicker`, `FontSizeSelector` or `TextAlignmentControls`.

---

## Story s05-embed-budget — get the embed script back under 30KB gzipped

**As a** site owner **I want** RecopyFast to not slow my site down **so that** installing
it never costs me search ranking or visitors.

### Complexity
4 — third-party runtime, CSP interaction, real regression risk on the feature that is the
product's demo.

**Risk, stated plainly:** this story rewrites the transport of the live editing feature.
Done wrong it breaks real-time sync on customer sites, or breaks it only on
CSP-restricted customer sites, which is worse because it will pass local testing.

### Acceptance criteria
- [ ] `public/embed/recopyfast.js` is ≤ 30KB gzipped, measured in CI, with the check failing the build above the threshold.
- [ ] A page with the script installed and no editing session open opens **zero** WebSocket connections and downloads no real-time transport code.
- [ ] Entering edit mode establishes real-time sync, and an edit in one browser appears in a second browser in under 1 second — unchanged from today.
- [ ] Real-time sync works on a host page served with `Content-Security-Policy: script-src 'self'`.
- [ ] Real-time sync works on a host page served with `connect-src 'self'`, or degrades to a documented read-only state with an explicit console warning — it never fails silently.
- [ ] The script contributes 0 to the host page's Cumulative Layout Shift.
- [ ] No uncaught exception reaches the host page's window under any of the above conditions.
- [ ] `node scripts/build-embed.mjs --check` still detects a stale artifact.

### Dependencies
None. **Blocks s06 and s08.**

### Agentic notes
- Current measured state: `recopyfast.js` is 174KB raw / **47KB gzipped** against the
  30KB budget stated in `docs/architecture/overview.md` and in the PRD constraints. The
  overage is `socket.io-client`, compiled in by `scripts/build-embed.mjs`.
- **Read the build script's header comment before proposing anything.** It records why
  socket.io was inlined: the widget used to pull it from `cdn.socket.io`, which any site
  serving `script-src 'self'` blocks outright, killing real-time editing. That failure
  mode must not be reintroduced.
- **The obvious fix is wrong.** Lazy-loading `/embed/socket.io-client.min.js` from our
  origin fails on exactly the same `script-src 'self'` customers, because our origin is
  not their `'self'`. It reintroduces the original bug in a form that passes local testing.
- Recommended approach: **speak plain WebSocket from the embed.** Native `WebSocket` costs
  zero bytes. Add a plain-WS endpoint on the `server/` Socket.io service for embed clients
  and keep socket.io for the first-party dashboard, where CSP is ours and not a constraint.
  The embed→server protocol is small: `content-map`, `content-update`, `join`.
- Files: `scripts/build-embed.mjs`, `public/embed/recopyfast.src.js` (source of truth —
  never hand-edit `recopyfast.js`), `server/index.js`, `src/lib/editingRules.core.ts`
  (spliced into the bundle at the inject markers; leave that mechanism intact).
- **Trap — reconnection.** socket.io provides automatic reconnection with backoff. Native
  WebSocket does not. Reconnection with jittered backoff must be written explicitly, or a
  server deploy silently ends every open editing session.
- **Trap — the artifact is a public URL.** `/embed/recopyfast.js` is baked into every
  snippet already issued. It must keep working for scripts installed before this change.
- Target reference: TinaCMS ships no third-party runtime at all (it is build-time), so this
  is a constraint they do not have. Being slower than a competitor that adds zero bytes is
  not survivable — this is a competitive requirement, not housekeeping.

---

## Story s06-section-impressions — see which sections of my page people actually look at

**As a** marketer on Pro **I want** to see how many people actually saw each section of my
page **so that** I edit the copy that is being read instead of guessing.

### Complexity
4 — high-volume ingest plus third-party runtime work.

**Risk:** impression events are orders of magnitude more numerous than edit events. An
unbatched, unsampled implementation will generate ingest volume that costs more than the
plan it is gating.

### Acceptance criteria
- [ ] The embed script records an impression for a tracked section when ≥ 50% of it has been in the viewport for ≥ 1 continuous second.
- [ ] A section scrolled past faster than 1 second records no impression.
- [ ] A section that leaves and re-enters the viewport within the same page view records exactly one impression.
- [ ] Impressions are batched and flushed on `visibilitychange` and on unload; a visitor who closes the tab immediately after scrolling still has their impressions recorded.
- [ ] Impression ingest requires a valid site token, exactly as content ingest does — no unauthenticated write path.
- [ ] Impression counts per section are visible in the dashboard against the section's current text, so the user can see the copy and its number together.
- [ ] The feature is gated: entitled Pro and trialling accounts see counts; unentitled accounts see an upgrade prompt and the embed sends no impression events for them.
- [ ] Adding impression tracking keeps `recopyfast.js` ≤ 30KB gzipped.
- [ ] Impression tracking respects Do Not Track and records no per-visitor identifier.

### Dependencies
`s05-embed-budget` (must not add code to an over-budget script), `s01-trial-signup` (defines
who is entitled).

### Agentic notes
- **Nothing here exists yet.** `IntersectionObserver` appears nowhere in the codebase —
  verified. `analytics/track` accepts only `page_view`, `content_edit`, `login`, `logout`,
  `api_call`.
- This is angle 4 of 5 in the PRD and the stated reason Pro exists. Neither TinaCMS nor
  CloudCannon has any equivalent — **there is no reference implementation to copy.**
- Do not extend `/api/analytics/track` with an `impression` action type. That endpoint
  writes one row per event into the activity log. Impressions need their own batched
  endpoint writing pre-aggregated counts, or the activity log becomes the bottleneck for
  everything else including s03's milestones.
- Reuse `src/lib/security/ingest-auth.ts#authorizeIngestRequest` and
  `src/lib/api/rate-limit.ts`. Rate limits must be sized for impression volume, not edit
  volume — an existing limit applied unchanged will drop real data.
- A "section" is an already-mapped content element. Do not invent a second element
  identity scheme; reuse `content_elements.element_id` and the existing selector generation.
- **Trap — SPA route changes.** `MutationObserver` already handles DOM churn for editing.
  Impressions must reset per logical page view, and a client-side route change is a new
  page view with no full page load to hook.
- **Trap — privacy.** No cookie, no fingerprint, no visitor id. Aggregate counts only.
  This keeps the feature out of GDPR consent scope, which is itself a selling point for
  the European local-business segment.

---

## Story s07-impression-history — impressions over time, and what changed

**As a** marketer **I want** to see a section's impressions over time alongside when its
copy changed **so that** I can tell whether my edit did anything.

### Complexity
3 — aggregation and read models over data s06 already collects.

### Acceptance criteria
- [ ] Per-section impressions are queryable by day over at least a 90-day window.
- [ ] The timeline marks the points at which that section's content was edited, sourced from the existing version history.
- [ ] Raw impression events older than the retention window are pruned by a scheduled job, and pruning never removes daily aggregates.
- [ ] Aggregation is idempotent: running it twice over the same period produces identical totals.
- [ ] A section with zero impressions is shown explicitly as zero, distinct from "not tracked".
- [ ] Retention window length is a documented configuration value, not a literal in code.

### Dependencies
`s06-section-impressions`.

### Agentic notes
- Version history already exists: `src/app/api/edit-board/history/route.ts`,
  `src/components/dashboard/VersionHistoryPanel.tsx`. Join against it rather than
  recording a second edit timeline.
- Aggregate on write into daily buckets; do not aggregate on read. Read-time aggregation
  over raw impressions will not survive the first customer with real traffic.
- **Trap — timezone.** "Per day" must be defined in one timezone and stated in the schema.
  A bucket boundary that shifts with the viewer's locale makes totals irreproducible.
- PRD success metric this serves: ≥ 40% of Pro accounts make at least one
  impression-informed edit. That is only measurable once the edit and the impression
  appear on the same timeline.

---

## Story s08-ab-run-test — run an A/B test on a section

**As a** marketer on Pro **I want** to test two versions of a headline against real traffic
**so that** I ship the one that performs instead of the one I prefer.

### Complexity
4 — traffic bucketing inside a third-party runtime, with correctness that is hard to
observe after the fact.

**Risk:** a bucketing bug is silent. Visitors get served variants, numbers accumulate, and
the results are wrong with no error anywhere. The bucketing function needs tests before it
needs a UI.

### Acceptance criteria
- [ ] `/dashboard/ab-tests` is a live route and reachable from the dashboard navigation for entitled accounts.
- [ ] An owner can create a test on an existing content element with two or more text variants and a traffic split.
- [ ] A returning visitor is served the same variant on every visit for the test's duration — bucketing is deterministic from a stable input, never random per request.
- [ ] Bucket assignment matches the configured split within a stated tolerance over 10,000 simulated assignments, asserted in a unit test.
- [ ] A visitor to a site with no active test receives the default content, and the embed makes no additional network request.
- [ ] Variant content is served without a visible flash of the original content.
- [ ] Only one test can be active per content element at a time; a second attempt is refused with a clear reason.
- [ ] Adding bucketing keeps `recopyfast.js` ≤ 30KB gzipped.

### Dependencies
`s05-embed-budget`.

### Agentic notes
- **This was built, then deliberately switched off.** Commit `2026-08-03`,
  *"feat: take A/B testing out of the launch, reversibly"*, renamed the route to
  `src/app/dashboard/_ab-tests/`. Read that commit before starting — the reasons it was
  parked may still apply to parts of it.
- Already built and dormant: `/api/ab-tests` (create/list), `/ab-tests/active/[siteId]`,
  `/ab-tests/bucket/[siteId]`, `/ab-tests/track`, `/ab-tests/generate`,
  `/ab-tests/[testId]/results`, `/api/cron/ab-test-lifecycle`, and
  `src/components/dashboard/ab-create/ABTestElementPicker.tsx`. **Audit what works before
  writing anything new** — most of this story may be re-enabling and finishing rather than
  building.
- A prior security pass closed unauthenticated A/B writes (commit `3099c07`). Do not
  regress that: re-check `bucket` and `track` require a site token.
- **Trap — flash of original content.** The host page renders its own HTML first. Variant
  swapping after paint is visible and will be reported as a bug by the customer's client.
  Decide and document the approach: swap before first paint, or accept and hide.
- **Trap — the split test is on someone else's site.** A slow or failed bucket call must
  fall back to default content immediately. Never block the host page's render on our
  network call.
- Target reference: neither TinaCMS nor CloudCannon offers A/B testing. Closest comparables
  are Optimizely and Mutiny, both of which are script-tag products — their *bucketing and
  anti-flicker* behaviour is the thing worth studying, not their feature set.

---

## Story s09-ab-results — call the winner

**As a** marketer **I want** to see which variant won and have the test end by itself
**so that** I get a decision, not a spreadsheet.

### Complexity
4 — statistics that must not lie, plus scheduled lifecycle.

### Acceptance criteria
- [ ] Each variant's impressions and conversions are shown with the observed rate.
- [ ] A result is only labelled a winner once it reaches a stated significance threshold and a stated minimum sample; below either, it is explicitly labelled inconclusive.
- [ ] The significance calculation is unit-tested against known inputs with known outputs.
- [ ] The lifecycle cron ends tests at their configured end date and records the outcome.
- [ ] Ending a test promotes the winning variant to be the element's live content, and that promotion appears in version history as a normal, revertible edit.
- [ ] A test ended while inconclusive keeps the original content and says so.
- [ ] The cron is idempotent: a duplicate run promotes nothing twice.

### Dependencies
`s08-ab-run-test`.

### Agentic notes
- Existing: `src/app/api/ab-tests/[testId]/results/route.ts`,
  `src/app/api/cron/ab-test-lifecycle/route.ts`.
- Conversions need a definition before this can be built. Given the product, the honest
  default is **section impression → subsequent click on a tracked CTA**, which reuses s06's
  observer. Agree this definition before implementing; a vague conversion makes every
  number meaningless.
- **Trap — peeking.** Showing a running significance figure invites stopping the test the
  moment it looks good, which inflates false positives. Either withhold significance until
  the minimum sample is met, or use a sequential test designed for continuous monitoring.
  Do not show a naive p-value on a live test.
- **Trap — promotion is a content write.** It must go through the same path as a human edit
  so that version history, staging state and webhooks all behave normally. A direct database
  update here will silently bypass all three.

---

## Story s10-agency-plan — one subscription for all my client sites

**As a** web agency **I want** a plan priced for many sites under one bill **so that** adding
a client site is a decision I make in seconds, not a purchase I have to justify.

### Complexity
4 — payments, quotas and catalogue changes on the live billing path.

### Acceptance criteria
- [ ] An `agency` plan exists in the plan catalogue with its own site limit, editor limit and monthly credit allowance.
- [ ] The plan appears in the public pricing feed with live Stripe amounts, alongside the existing plans.
- [ ] An agency account can create sites up to its limit; the limit is enforced by the existing site-count gate.
- [ ] Exceeding the site limit offers additional sites at the plan's per-site price rather than a hard refusal, if `additional_site_price` is configured.
- [ ] Upgrading from Pro to Agency preserves all existing sites, content and grants, and prorates through Stripe.
- [ ] Downgrading below the current site count is refused with a message naming how many sites must be removed first — it never silently orphans a site.
- [ ] One invoice covers all sites on the account.
- [ ] `npm run check:stripe` passes against the new plan in both test and live mode.

### Dependencies
`s01-trial-signup` (shares the entitlement resolution path).

### Agentic notes
- **The plan does not exist.** The catalogue is `starter`, `pro`, `credits`,
  `lifetime_pro` — confirmed in `src/lib/stripe/plans.ts`. The PRD names agencies as the
  primary buyer, which makes this the largest single gap in the product.
- The catalogue is DB-driven: `plans` table is source of truth, Stripe price ids come from
  env via `PRICE_ID_ENV_VARS`. Adding a plan means a migration **and** new env vars in
  every environment. `scripts/sync-stripe-catalogue.mjs` exists for this — use it.
- There is deliberately **no hardcoded fallback catalogue**; the header comment in
  `src/app/api/pricing/route.ts` explains that a previous fallback silently served drifted
  prices. Do not add one.
- Site ownership is an `admin` row in `site_permissions`, not a column on `sites` — see
  `countOwnedSites` in `permissions.ts`, whose comment records that a previous `sites.user_id`
  filter silently returned 0 and let every quota check pass. Any new counting must use the
  permissions table.
- **Trap — downgrade.** Stripe will happily accept a downgrade that leaves the account over
  quota. The refusal must happen before the Stripe call, not after.
- Target reference: CloudCannon prices per site, which is precisely the pain this plan
  removes. The comparison page from s14 should say so with real arithmetic.

---

## Story s11-agency-client-handoff — hand a client the keys to their own copy

**As a** web agency **I want** to invite each client to edit only their own site in one
action **so that** I can stop being the person who changes their phone number.

### Complexity
4 — permissions and expiry across many sites, with a real defacement risk if scoped wrong.

### Acceptance criteria
- [ ] An agency can invite an editor to a specific site by email from that site's view, in one action.
- [ ] The invited editor can edit only that site — an attempt to reach any other site on the agency's account is refused.
- [ ] Invitations can be sent to several sites at once, each producing an independently scoped grant.
- [ ] Revoking a grant takes effect on the next request, and an open editing session cannot continue saving after revocation.
- [ ] Grants expire on their configured schedule, and expiry is enforced server-side.
- [ ] The agency can see, per site, who currently holds a grant and when each expires.
- [ ] A single view lists recent edits across all of the agency's sites, showing site, editor and element.
- [ ] An expired or revoked grant link shows a clear message and a way to request a new one — never a stack trace or a blank page.

### Dependencies
`s10-agency-plan`.

### Agentic notes
- The single-site version already works: `src/app/edit/EditorSignIn.tsx`,
  `/api/editor/request-code`, `/submit-code`, `/handoff/create`, `/handoff/redeem`,
  `/refresh-grant`, `/validate-grant`, `/api/edit-sessions/*`,
  `src/components/dashboard/ShareSiteDialog.tsx`, `SiteEditorsCard.tsx`. This story makes
  it plural and adds the cross-site view.
- **This is the product's stated angle 2 and its largest security surface.** A leaked or
  over-scoped grant is a defacement of a customer's live site. Treat scope, expiry and
  revocation as the acceptance criteria that matter most.
- Prior hardening to preserve: commit `728b646` hid site install credentials and restricted
  site deletion; `aca2eb2` fixed last-admin revoke. Re-read both before touching permissions.
- **Trap — enumeration.** The invite flow must not reveal whether an email already has an
  account, and a grant code must not be guessable or reusable across sites.
- **Trap — revocation and the open socket.** Revoking a grant must also terminate any live
  editing connection held by that grant. An HTTP-only check leaves an open WebSocket
  writing content after revocation.
- Target reference: TinaCMS and CloudCannon both require the client to have an account.
  Not requiring one is the differentiator — protect it by making the grant genuinely narrow.

---

## Story s12-agency-digest — show the agency what it saved

**As a** web agency **I want** a monthly summary of what my clients changed themselves
**so that** the subscription justifies itself without me thinking about it.

### Complexity
3 — scheduled job, aggregation and email.

### Acceptance criteria
- [ ] A monthly email to each agency account reports edits per client site for the period.
- [ ] The email states a total edit count and an estimated time saved, using a stated, documented per-edit assumption.
- [ ] An account with zero edits in the period receives no email.
- [ ] The digest is idempotent: a re-run for the same period sends nothing twice.
- [ ] The email renders correctly in plain text as well as HTML.
- [ ] Recipients can unsubscribe from the digest without affecting transactional email.
- [ ] Send failures are logged with the account and period, and are retryable without duplicating successful sends.

### Dependencies
`s11-agency-client-handoff`.

### Agentic notes
- Existing: `src/lib/email/`, Resend is already a dependency, `src/app/api/cron/` holds the
  scheduled-job pattern, `vercel.json` carries the cron configuration.
- The PRD's retention argument: a local business logs in around four times a year, so
  measuring end-client MAU will read as catastrophic churn and mean nothing. Retention lives
  with the agency, and this email is the mechanism that makes value legible to the payer.
- **Be honest about the time-saved number.** State the assumption in the email itself
  ("we count 10 minutes per edit"). An invented figure presented as measurement is the kind
  of thing that loses an agency's trust permanently.
- **Trap — idempotency under retry.** Cron platforms retry. Record what was sent per
  account per period before sending, not after.

---

## Story s13-webhook-config — tell my system when content changes

**As a** developer running a static site **I want** RecopyFast to call my endpoint when
content changes **so that** my site rebuilds without me watching for it.

### Complexity
3 — outbound integration with delivery guarantees.

### Acceptance criteria
- [ ] An owner can configure a webhook URL per site and see its recent delivery history.
- [ ] A content change delivers a signed POST to that URL, and the signature is verifiable with a secret shown once at creation.
- [ ] A failed delivery retries with exponential backoff up to a stated limit, then is marked failed and visible as such.
- [ ] Rapid successive edits are coalesced so a burst of edits does not trigger a burst of rebuilds.
- [ ] The configured URL is validated against SSRF: private, loopback and link-local addresses are refused at configuration time and again at delivery time.
- [ ] A slow or hanging endpoint times out and does not delay the edit that triggered it.
- [ ] Test delivery can be triggered manually from the dashboard.

### Dependencies
None.

### Agentic notes
- Existing: `/api/webhooks/route.ts`, `/api/webhooks/test/route.ts`, `src/lib/webhooks/`.
  Stripe's inbound webhook at `/api/webhooks/stripe` is a different concern — do not
  entangle them.
- `ipaddr.js` is already a dependency and is the right tool for the SSRF check.
- **Trap — DNS rebinding.** Validating the hostname at configuration time is not enough;
  resolve and re-check the address at delivery time.
- **Trap — coalescing window.** Too short and every keystroke-debounced save triggers a
  rebuild; too long and the customer thinks it is broken. Make it configurable with a sane
  default and state the default in the UI.
- Target reference: CloudCannon's build hooks and TinaCMS's git-commit-triggered rebuilds.
  This is parity work — it exists to remove an objection from static-site customers, who
  are exactly the target's core audience.

---

## Story s14-cluster-engine — comparison pages that rank

**As a** person searching "TinaCMS alternative" **I want** an honest comparison **so that**
I can tell in one screen whether this fits my site.

### Complexity
3 — content-driven routes with structured data and generated sitemap entries.

### Acceptance criteria
- [ ] `/alternatives/<competitor>` renders from structured content for at least tinacms, cloudcannon, contentful, storyblok and decap-cms.
- [ ] Each page states what the competitor does better, not only what we do better.
- [ ] Each page carries `SoftwareApplication`, `FAQPage` and `BreadcrumbList` JSON-LD that validates.
- [ ] Every generated page appears in `sitemap.ts` automatically — the sitemap is never hand-maintained.
- [ ] An unknown competitor slug returns 404, not an empty page.
- [ ] `llms.txt` is served and lists the comparison pages.
- [ ] Each page passes Core Web Vitals thresholds in a Lighthouse run in CI.
- [ ] Page content lives in typed, validated data, so adding a competitor requires no new route code.

### Dependencies
None.

### Agentic notes
- Existing SEO surface: `src/app/sitemap.ts`, `robots.ts`, `blog/[slug]`,
  `opengraph-image.tsx`, `manifest.ts`. No cluster routes exist.
- This story builds the **engine**; s15 and s16 are additional clusters riding on it. Build
  it so a new cluster is a data file plus a template, not a new subsystem.
- **The honesty requirement is not a value statement, it is the mechanism.** AI search
  surfaces cite comparisons that acknowledge trade-offs and skip pure marketing. The
  PRD's SEO section depends on being cited, not only ranked.
- **Trap — thin content at scale.** Pages that differ only by a swapped noun get demoted
  under the Helpful Content system, and the demotion is site-wide, not per-page. Every page
  needs genuinely distinct substance.
- `cron/generate-blog-post` exists and can draft this content, but the PRD is explicit:
  **it drafts, a human publishes.** Do not wire auto-publish.

---

## Story s15-stack-recipes — a verified install page for my stack

**As a** developer with a site on some specific stack **I want** the exact snippet and the
exact place to paste it **so that** I am installed in a minute instead of guessing.

### Complexity
3 — content plus real verification work per stack.

### Acceptance criteria
- [ ] `/cms-for/<stack>` renders for at least wordpress, shopify, webflow, squarespace, framer, next-js, astro and plain-html.
- [ ] Each page names the exact file or admin location where the snippet goes for that stack.
- [ ] Each stack's snippet has been installed on a real instance of that stack and verified live, with the evidence recorded in the repository.
- [ ] Each page links to the same content used by the dashboard's install instructions — one source, two surfaces.
- [ ] Each page is reachable from the comparison cluster and appears in the sitemap.
- [ ] A stack where install is not actually possible is documented as unsupported rather than omitted silently.

### Dependencies
`s14-cluster-engine`, `s02-install-verified` (supplies the in-product install content).

### Agentic notes
- The PRD's success criteria require ≥ 8 stacks with a verified install recipe. This is the
  story that produces that evidence.
- **This is documentation and marketing at once.** Write the recipe once and render it in
  both the dashboard's `awaiting-install` state and the public page. Two copies will drift,
  and a wrong install instruction is an activation failure.
- Verification is manual and cannot be faked — a screenshot or recorded check per stack,
  committed. "It should work" is not the acceptance criterion.
- Known constraint to surface honestly per stack: sites that render content client-side
  after our scan need the MutationObserver path, and some platform editors strip injected
  scripts. Where a stack is genuinely hostile, say so on the page.

---

## Story s16-audience-pages — pages for the people who actually buy

**As a** dentist or an agency owner **I want** a page that describes my situation **so that**
I recognise the product as being for me.

### Complexity
2 — content pages on the existing engine.

### Acceptance criteria
- [ ] `/for/<vertical>` renders for at least restaurants, dental-practices, law-firms and gyms.
- [ ] `/agencies/<use-case>` renders for at least client-content-updates and multi-site-management.
- [ ] Each vertical page names the content that actually changes for that business — hours, prices, menu, staff — rather than generic feature copy.
- [ ] Each page carries valid structured data and appears in the sitemap.
- [ ] Each page has one primary call to action leading to trial signup.
- [ ] No page duplicates another page's body content.

### Dependencies
`s14-cluster-engine`.

### Agentic notes
- Runs on s14's engine. If this story requires new route code, s14 was built wrong — treat
  that as a signal to fix s14 rather than to special-case here.
- The agency pages carry the PRD's wedge message — *"stop doing free copy changes for your
  clients"* — and should use the real arithmetic from s10's comparison against per-site
  pricing.
- Lowest complexity in this backlog and the closest to the money. It is last only because
  it depends on the engine, not because it matters least.

---

## Not stories, deliberately

Recorded so a future agent does not mistake these for missing work:

- **The core loop.** Site registration, embed runtime, inline editing, non-account email
  grants, versioning and rollback, staging and publish, AI rewrite and translate, image
  replace, real-time sync, Stripe subscriptions and credits, bulk import/export, API keys.
  Built, tested, in production. Changes to these arrive as bugs or as new stories, not as
  a rebuild.
- **Everything in the PRD graveyard.** Org teams and roles, audit console, security events
  dashboard, notification centre, site-wide theme editor. `s04` removes their last live
  entry points; no story develops them.
- **Per-element typography and colour controls.** In scope and shipped. The graveyard entry
  covers site-wide themes only.
- **Free-forever tier.** Resolved against: the trial in `s01` is the answer.
- **WordPress plugin.** Named in the PRD's GTM as the first post-launch investment. Not in
  this backlog — it belongs to the launch that follows it.
