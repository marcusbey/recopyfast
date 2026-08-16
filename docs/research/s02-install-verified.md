# Research — Story s02-install-verified

> **Stories readiness warning.** `docs/reviews/stories.md` ends `Max severity: major` /
> `Stories ready: no`. None of the six Part-B majors (M1–M6) or the minors name `s02` — the
> only `s02`-related finding in that review is **M2 (closed)**, which confirmed `s02`'s
> corrected first-contact signal is accurate. The operator has confirmed proceeding with
> `s02` despite the overall "no" verdict. Recorded here per instruction, not re-litigated.

## The five structuring facts (five one-liners with file:line)

1. First-contact signal is confirmed exactly as the story states: `postContentMap()` is
   defined at `public/embed/recopyfast.src.js:2853`, called at `:2821`, and POSTs to
   `RECOPYFAST_API + '/content/' + encodeURIComponent(SITE_ID)` at `:2924`; a repo grep for
   `analytics/track` and `page_view` inside the embed returns nothing — the earlier
   `/api/analytics/track` claim is confirmed false.
2. **The `sites` table has no status column at all.** `supabase/migrations/20250817000000_complete_database_setup.sql:16-23` defines only
   `id, domain, name, api_key, created_at, updated_at`. Every "status" a caller sees today is
   computed fresh on every `GET /api/sites` call (`src/app/api/sites/route.ts:117`:
   `elementsCount > 0 ? "active" : "verifying"`) — nothing is persisted, nothing transitions,
   there is no timestamp to read back. This is the real gap AC 1 and AC 8 close, and it's
   larger than "add a state machine next to `hasReportedContent`" — it's a first migration.
3. **A status vocabulary already exists and has four live consumers the story's agentic
   notes never mention.** `SiteStatus = "active" | "inactive" | "verifying"`,
   `resolveSiteStatus()` and the `siteStatuses` registry live in
   `src/components/ui/status-badge.tsx:50-111`, and are wired into `SiteCard.tsx:16-17,59`,
   `SiteDetailView.tsx:15-17,96`, `src/app/dashboard/page.tsx:19-20,316`, and
   `src/app/dashboard/sites/page.tsx:56,61-66` (which filters the site list by this exact
   type). Introducing `awaiting-install` / `live` / `stale` touches all four, not just
   `SiteDetailView.tsx`.
4. `hasReportedContent` claim verified byte-for-byte:
   `SiteDetailView.tsx:91` is
   `const hasReportedContent = (site.stats?.content_elements_count ?? 0) > 0;` — a derived
   boolean over a count, exactly as the story describes, not a state machine and not a
   timestamp.
5. **A domain mismatch is already fully rejected today, before it reaches content
   processing, and nothing records it.** `authorizeSiteRequest` in `site-auth.ts:162-164`
   throws `"Origin not allowed"` whenever `requestOriginHost !== allowedDomain`; the POST
   handler's catch block (`content/[siteId]/route.ts:345-360`) turns that into a 403 and only
   `console.error`s it. AC 4 ("recorded as a mismatch") requires new persistence — there is no
   existing table or counter this can write to today.

## Target story

**s02-install-verified** — "the site turns green by itself when the script is live."
Complexity in `stories.md`: **3**.

Acceptance criteria (verbatim from `docs/stories.md:162-170`):
- [ ] A registered site starts in an explicit `awaiting-install` state, visibly distinct from `live`.
- [ ] The first authenticated content report from the embed on the registered domain flips the site to `live` with no user action.
- [ ] The dashboard reflects the flip within 10 seconds while the page stays open — no manual refresh.
- [ ] A report from a domain other than the registered one does not verify the site and is recorded as a mismatch.
- [ ] The `awaiting-install` state shows the snippet, a copy control, and the install location for WordPress, Next.js and plain HTML.
- [ ] Install recipes are stored as typed data in one module, and both this state and `s18`'s public pages render from it — this story owns that module.
- [ ] A site that was live and has reported nothing for a configurable window shows as `stale`, and `stale` never blocks content delivery or editing.
- [ ] State and transition timestamps are readable via the sites API, so `s03` can consume them.

Dependencies: none declared. Owns the install-recipe data `s18` will consume. Gates `s03`
(`s03-activation-funnel` names "first verified install" as one of its four milestones and
lists `s02` as a dependency).

## Current state of the code

**Site status (today).** Purely computed, not stored:
- `GET /api/sites` (`src/app/api/sites/route.ts:56-127`) computes, per site, per request:
  `elementsCount` via a `content_elements` count query, then
  `status: elementsCount && elementsCount > 0 ? "active" : "verifying"` (`:117`). No
  `sites.status` column exists to read this from persistently — it is recomputed on every
  list fetch.
- `src/components/ui/status-badge.tsx` is the single registry for every status pill in the
  dashboard (its own header comment explains it replaced six independently-drifting maps).
  `SiteStatus` is `"active" | "inactive" | "verifying"`. `resolveSiteStatus(status)` falls
  back to `"inactive"` for an unknown or missing value.
- `SiteDetailView.tsx` independently derives `hasReportedContent` from
  `site.stats?.content_elements_count` (line 91) and uses it to drive two *separate* ad hoc
  badges ("Script Installation": Verified/Not detected yet; "API Connection":
  Connected/Awaiting first request) — this is a second, redundant status computation living
  beside the first (`statusDefinition` from `resolveSiteStatus`), inside the same component.
  Both ultimately answer the same underlying question ("has this site's script ever posted
  content?") through two different code paths.

**First-contact ingestion.** `POST /api/content/[siteId]/route.ts` (`:321-455`):
1. Per-IP load shedding (`shedUnauthenticatedLoad`, fails open).
2. `authorizeSiteRequest({ siteId, token, origin, referer })` from `site-auth.ts` — validates
   the HMAC site token, then requires `requestOriginHost === normalizeDomain(site.domain)`
   (the "origin trust" the story's trap refers to). Throws `"Origin not allowed"` (→ 403) or
   `"Invalid site token"` / `"Missing site token"` / `"Site not found"` (→ 401) — a domain
   mismatch never reaches step 3 onward.
3. A second, per-site, fail-closed rate limiter.
4. `buildDiscoveryRows()` validates and shapes the content map; malformed elements are
   skipped and reported, not fatal.
5. `content_elements.upsert(rows, { onConflict: "...", ignoreDuplicates: true })` — **existing
   elements are never touched again.** `postContentMap()` on the widget side
   (`recopyfast.src.js:2870-2896`) already tracks `serverKnownElementIds` client-side and stops
   sending anything once every element on the page has been reported once — "discovery is a
   one-time event per element." **Consequence for AC 7 (stale): after initial discovery, this
   POST endpoint receives no further traffic from a healthy, unchanged site — there is no
   ongoing "still alive" signal here to derive staleness from.** The widget's `GET
   /api/content/:siteId` (called on every page load to hydrate stored content,
   `recopyfast.src.js:3284`, `:5116`) is the one request every visit reliably makes; the GET
   handler in the same route file (`:229-319`) is the more natural place to record a
   liveness/last-seen timestamp, not the POST handler the story's notes point to.

**`SiteDetailView.tsx`** (rendered from `src/app/dashboard/sites/[siteId]/page.tsx` — not
directly checked in this pass, but `SiteDetailView` is imported and takes a `site` prop built
from the same `GET /api/sites`-shaped data):
- Line 91: `hasReportedContent`.
- Line 96: `resolveSiteStatus(site.status)`.
- Line 369: `<DomainVerification siteId={site.id} siteDomain={site.domain} />` — confirmed
  live and rendered, inside the "Domain ownership" card, not gating anything.
- Lines 316-358: "Integration Status" card, driven off `hasReportedContent`, duplicating the
  status pill's meaning in different words.

**`DomainVerification.tsx`** — live, rendered, and functioning as documented. Its own header
comment (lines 265-278) explicitly disclaims relevance to install verification: *"Your embed
script does not wait on this — it is already authorised by its site token and the origin it
runs on"* and *"nothing in the embed, CORS or content path reads `domain_verifications`."*
This confirms `s02`'s state machine must **not** route through `domain_verifications` /
`/api/domains/verify` — that subsystem answers a different question (proof of domain
ownership for e.g. future custom-domain use) and has no relationship to whether the script is
installed.

**`src/app/api/domains/verify/route.ts`** — fully functional CRUD over
`domain_verifications` (POST creates a challenge, PUT checks it, GET lists, DELETE removes),
authorized via `site_permissions`. Confirmed unrelated to widget/content-report
authorization; irrelevant to this story's write path, relevant only in that `s02` must not
accidentally couple to it.

**Install recipes.** No existing module. `buildEmbedScript()`
(`src/lib/sites/embed-script.ts:83-99`) produces one generic `<script>` tag; there is no
stack-specific ("paste this in `functions.php`" / "paste this in `_document.tsx`" / etc.)
instructional content anywhere in the repo (`grep -rl "install.recipe\|installRecipe"` across
`src/` returns nothing). This confirms the story's claim that this is new work, wholly owned
by `s02`.

## Anchor points

- `supabase/migrations/` — new migration: a `sites.status` (or equivalent) column plus
  transition timestamp columns (e.g. `installed_at`/`live_at`, `last_reported_at`), since none
  exist today. Must ship an RLS-safe, forward-only migration per repo rules.
- `src/components/ui/status-badge.tsx:50-111` — `SiteStatus` union and `siteStatuses` registry
  need new entries (`awaiting-install`, `live`, `stale`) — additively, since `active` /
  `inactive` / `verifying` are asserted against in existing tests (see Traps).
- `src/app/api/sites/route.ts:111-125` — where `status` is currently computed per request;
  needs to read the new persisted column instead of (or alongside) the `elementsCount`
  computation.
- `src/app/api/content/[siteId]/route.ts` — `POST` (`:321-455`) is the natural place to flip
  `awaiting-install → live` on first successful discovery write; `GET` (`:229-319`) is the
  natural place to bump a `last_reported_at`/liveness timestamp for staleness, since it is
  called on every page view, unlike POST which goes silent after full discovery.
- `src/components/dashboard/SiteDetailView.tsx:91-96,316-358` — collapse the duplicate
  `hasReportedContent`-driven "Integration Status" card and `resolveSiteStatus`-driven header
  badge into one status source once the real state machine exists.
- `src/components/dashboard/SiteCard.tsx:59`, `src/app/dashboard/page.tsx:316`,
  `src/app/dashboard/sites/page.tsx:56,61-66` — three more `SiteStatus` consumers that need
  the new states reflected (the sites list filter in particular needs new filter options).
- New file (location not yet chosen — a candidate: `src/lib/sites/install-recipes.ts`) — the
  typed install-recipe module the story owns, covering at minimum WordPress, Next.js and
  plain HTML per AC 5, structured so `s18` can render the same data for its 8-stack public
  pages without a second copy.
- "Dashboard reflects the flip within 10 seconds while the page stays open" (AC 3) needs a
  poll or push mechanism on the site detail page — no such polling exists yet in
  `SiteDetailView.tsx`/its data hook today (not independently verified in this pass which
  hook feeds `site` into `SiteDetailView`; flagged as an open question below).

## Verified APIs / functions

- `authorizeSiteRequest({ siteId, token, origin, referer })` — `src/lib/security/site-auth.ts:109-172`.
  Validates HMAC site token (`verifySiteTokenSignature`) and enforces the domain pin
  (`requestOriginHost === normalizeDomain(site.domain)`), throwing `"Origin not allowed"` on
  mismatch. **This is the function already called inline inside `POST
  /api/content/[siteId]/route.ts`** (`:339-344`) — the endpoint the story names as the
  first-contact trigger.
- `authorizeIngestRequest(request, siteId)` — `src/lib/security/ingest-auth.ts:50-106`.
  Confirmed to exist and to be reusable, exactly as the story says — but it is a *wrapper*
  around `authorizeSiteRequest` (for the site-token branch) plus a session-based fallback for
  first-party callers. **It is not currently called by `POST /api/content/[siteId]`** — grep
  confirms its only current callers are `/api/analytics/track` and
  `/api/analytics/performance`. If the state transition is implemented inline inside the
  existing `POST /api/content/[siteId]` handler (the natural reading of the story), the
  authorization work is already done by the existing `authorizeSiteRequest` call and
  `authorizeIngestRequest` does not need to be invoked a second time there. It becomes
  directly relevant only if the plan adds a *separate* endpoint (e.g. a manual
  "recheck now" action, or a dedicated mismatch-recording write) that needs to accept both a
  site token and a first-party session in one call — precisely what it's built for.
- `resolveSiteStatus(status: string | undefined): StatusDefinition` and
  `siteStatuses: Record<SiteStatus, StatusDefinition>` —
  `src/components/ui/status-badge.tsx:82-111`. Falls back to `"inactive"` for any status value
  it does not recognize, so adding new states is additive/safe at the type level as long as
  new entries are added to the registry.
- `buildEmbedScript({ siteId, siteToken, appUrl?, wsUrl? })` —
  `src/lib/sites/embed-script.ts:83-99`. The single script-tag builder; the install-recipe
  module must compose around this, not duplicate its escaping/attribute logic.
- `normalizeDomain(domain: string)` — `site-auth.ts:17-31`. Used for the domain pin; the
  natural function to compare a reporting domain against the registered one when building the
  "mismatch" record for AC 4.

## Traps & constraints

- **Existing test assertions are pinned to today's three-state vocabulary and its exact
  copy.** `src/components/dashboard/__tests__/SiteDetailView.test.tsx:188-200` asserts
  `status: "verifying"` and `status: "inactive"` render `"Inactive"` /
  `"Site is not currently active."` verbatim. Per `AGENTS.md`, tests must not be edited to
  accommodate a behavior change without saying so in the PR — plan for this explicitly (either
  keep `active`/`inactive`/`verifying` alive as aliases, or update the tests and document it).
- **The origin-mismatch refusal is already heavily tested and must not regress.**
  `src/__tests__/lib/security/site-auth-origin.test.ts` has ~15 tests locking in
  `"Origin not allowed"` throwing behavior for `POST`/`GET`/`OPTIONS` on
  `/api/content/[siteId]`, including the loopback-lookalike-domain hardening. AC 4 needs a
  mismatch to be *recorded*, but the request must keep failing exactly as it does today — do
  not weaken the 403 to let the request through further so it can be "recorded" post hoc.
- **No ongoing "site still receiving traffic" signal exists from the POST path once discovery
  is complete** (see fact 5 / Current state above) — the widget's own dedup logic
  (`serverKnownElementIds`) guarantees POST goes silent on an unchanged page. Staleness (AC 7)
  needs a new signal, most plausibly hooked into the `GET` handler (which fires every page
  load) rather than the `POST` handler.
- **`stale` must be advisory only** (story's own trap) — it must never block content delivery
  or editing; today's `GET /api/content/:siteId` has no such gate to accidentally add one to,
  but any new code path added for staleness must be checked not to short-circuit content
  serving.
- **`SiteStatus` is not part of the base `Site` type** (`src/types/index.ts:11-22`) — every
  consuming component redeclares its own `SiteWithStats`/`SiteWithDetails extends Site {
  status?: SiteStatus; ... }` locally (`SiteCard.tsx:34-41`, `SiteDetailView.tsx:39-49`,
  `dashboard/page.tsx`, `dashboard/sites/page.tsx:43-53`). A new state machine touches four
  independently-declared extension interfaces, not one shared type — a risk of them drifting
  out of sync with each other, which is exactly the failure mode `status-badge.tsx`'s own
  header comment describes happening once already.
- **`domain_verifications` / `DomainVerification.tsx` is a decoy for this story.** Its own
  code comments explicitly say the embed does not wait on it and nothing in the content path
  reads it. Do not gate `awaiting-install → live` on it.
- Widget-side changes, if any turn out to be needed (none identified as required by this
  research — the POST call already exists and already carries what's needed), would have to
  go through `recopyfast.src.js` → `npm run build:embed`, never the generated artifact, per
  the repo's non-negotiables.

## Open questions

- **Which component/hook actually feeds `site` into `SiteDetailView`, and does it poll?** This
  pass read `SiteDetailView.tsx` itself and confirmed it is a pure prop-driven presentational
  component with no data fetching of its own. AC 3 ("reflects the flip within 10 seconds while
  the page stays open") requires *some* polling or push mechanism upstream of it — its parent
  page/hook was not located or read in this pass. Needs to be found before `/ks-plan` can size
  the polling work.
- **Exact shape of the "mismatch" record for AC 4** is unspecified by the story beyond
  "recorded." Is this a counter, a table row per event, or a field on `sites`
  (`last_mismatch_domain`, `last_mismatch_at`)? No existing table is a natural fit (confirmed:
  `domain_verifications` is unrelated per its own code comments). This is a real design
  decision, not just an implementation detail, and belongs in `/ks-plan` or `/ks-design`.
- **Whether `s02`'s new `sites` columns should replace or run alongside the
  `elementsCount`-derived `active`/`verifying` computation in `GET /api/sites`.** The story's
  AC 8 wants state and transition timestamps "readable via the sites API" — unclear whether
  the three legacy `SiteStatus` values (`active`/`inactive`/`verifying`) get retired in favor
  of `awaiting-install`/`live`/`stale`, or whether both vocabularies coexist (e.g. one for the
  list view's coarse badge, one for the detail view's precise state). This directly determines
  the blast radius on the four existing `SiteStatus` consumers and should be settled before
  planning, not discovered mid-implementation.
- **Where the install-recipe module should live.** No convention exists yet (`src/lib/sites/`
  is a plausible home, alongside `embed-script.ts`, but this is a proposal, not a verified
  fact). Whatever is chosen, `s18`'s agentic notes already assume a single data source with no
  second copy — the location just needs to be committed to and documented so `s18` doesn't
  have to guess.
- The literal string `"register F-10"` appears in code comments
  (`recopyfast.src.js:2814`, `status-badge.tsx:80`) as a citation, but `docs/quality/qa-register.md`
  (668 lines, checked) contains no entry literally labeled `F-10`. Not load-bearing for this
  story — noted only so a future reader doesn't spend time hunting for a register entry that
  isn't there under that name.

## Real complexity

**3 — matches `stories.md`.** Confirmed rather than assumed: this is genuinely a business-logic
story (a persisted state machine plus a data module) with no new integrations, no new external
service, and no new UI framework. What raises it above a 2: a first migration for `sites` that
several other read paths (`GET /api/sites`, four `SiteStatus` consumers) must be updated in
step with, plus real design work on the staleness signal (which — per this research — is not
"read an existing timestamp," it requires deciding where a new liveness signal is recorded).
What keeps it off a 4: no external system, no billing, no security-critical grant/permission
surface, and the install-recipe module is pure static typed data with no verification
mechanism of its own (that verification work is explicitly `s18`'s, not `s02`'s). No split
proposed.

## Split proposal

Not applicable — this story scores 3, not 5.
