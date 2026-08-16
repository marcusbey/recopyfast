# Stories Review — RecopyFast

> Fresh-context review of `docs/stories.md` against `docs/prd.md`. Each issue classified: critical / major / minor.
> Because `docs/stories.md` declares itself a **delta backlog**, every perimeter feature it leaves uncovered was checked against the actual codebase rather than accepted on the file's word.

## Perimeter coverage

| PRD feature (core loop) | Covered by | OK? |
|---|---|---|
| 1 Auth + account | Built — `src/app/login/page.tsx`, `src/app/signup/page.tsx`, `src/app/api/auth/*`, `src/middleware.ts`, `src/__tests__/api/auth/*` | ✅ |
| 2 Site registration → token + snippet | Built — `src/app/api/sites/register/route.ts`, `src/lib/sites/embed-script.ts`, `SiteRegistrationModal.tsx`, `src/__tests__/api/sites/register/route.test.ts` | ✅ |
| 3 Script generation + sharing + install verification | `s02-install-verified`; existing `DomainVerification.tsx` is live (rendered at `src/components/dashboard/SiteDetailView.tsx:369`), `ShareSiteDialog` live | ✅ |
| 4 Embed runtime (scan, selectors, MutationObserver) | Built — `public/embed/recopyfast.src.js` (5,397 non-empty lines), `computeStableElementId`, `src/__tests__/embed/*`; budget handled by `s05` | ✅ |
| 5 Inline editing on the live page | Built — widget edit mode + inline toolbar | ✅ |
| 6 Email invite → non-account grant | Built — `src/app/api/editor/{request-code,submit-code,handoff/create,handoff/redeem,refresh-grant,validate-grant}`, `rcf_handoff` present in `recopyfast.src.js`, `SiteEditorsCard.tsx`; extended by `s11` | ✅ |
| 7 Payment flow (Stripe + credits + entitlements) | Built — `src/lib/billing/{entitlements,checkout-reservation,user-lock}.ts`, `src/lib/stripe/*`, `api/webhooks/stripe`, ~15 billing test files | ✅ |
| 8 AI edit — suggest / rewrite in place | Built — `recopyfast.src.js:4901 showAISuggestions` → `:5024 fetch(RECOPYFAST_API + '/ai/suggest')` | ✅ |
| 9 AI translate + language variants | Built — widget Edit Board "Languages" tab (`recopyfast.src.js:5459, 5845-5877`, "Auto-translate with AI") → `POST /api/edit-board/languages` → `aiService.translateText` (`route.ts:240`) | ✅ |
| 10 Images — upload / replace in place | Built — widget image modal `recopyfast.src.js:4357-4621` → `/api/upload/image` | ✅ |
| 11 Real-time multi-user sync (Socket.io) | **No story — and disabled in production** | ❌ **critical** |
| 12 Content versioning + rollback | Built — `api/edit-board/history{,/[versionId]}`, `VersionHistoryPanel` rendered at `SiteDetailView.tsx:374`, widget History tab, `src/__tests__/db/content-version-*.test.ts` | ✅ |
| 13 Staging → publish | Built — `api/staging/{access,content,publish,validate,verify}`, widget publish button, `publish_staging_content_atomic` | ✅ |
| 14 A/B testing | `s08-ab-run-test`, `s09-ab-results` | ✅ |
| 15 Per-section impressions | `s06-section-impressions`, `s07-impression-history` | ✅ |
| 16 Analytics dashboard + export | Built — `src/app/dashboard/analytics/page.tsx`, `api/analytics/export/route.ts` | ✅ |
| 17 Public API v1 + API keys | Built — `api/v1/content`, `api/api-keys`, `ApiKeysPanel` rendered at `src/app/dashboard/settings/page.tsx:16` | ✅ |
| 18 Outgoing webhooks | `s13-webhook-config` | ✅ |
| 19 Bulk import / export | **No story — and no user-facing surface** | ❌ **critical** |

- [ ] Every feature of the PRD "Replicated (core loop)" table is delivered by at least one story — **NO** (11, 19)

## Scope
- [x] No story reintroduces an item from the PRD graveyard ("Explicitly NOT replicated") — no story *develops* graveyard scope. `s04` correctly excludes `TypographyPanel` / `ColorPicker` / `FontSizeSelector` / `TextAlignmentControls` per the narrowed entry.
- [ ] No story goes beyond the perimeter — `s10` under-delivers the Agency tier the PRD defines (see M5); `s11`'s cross-site activity view sits close to the graveyard's "org activity" without saying so.
- [ ] Graveyard has **no live UI surface** — **NO**. The widget's Edit Board still ships a "Styles" and a "Themes" tab on every customer site (see M4).

## Story quality
- [x] Each story is an end-to-end shippable slice, not a technical layer — no pure layers. `s03` (operator-facing) and `s14` ("builds the engine") are the closest calls; both ship an observable result, so both pass.
- [ ] Every acceptance criterion can become a test — mostly yes; several criteria are not decidable as written (m4, m5).
- [x] Agentic notes present and useful — consistently strong: real files, real commit hashes, real traps. Four of the factual claims are wrong (M2, M3, m1).
- [ ] Complexity scored; no unsplit 5; every 4 states its risk — no story is scored 5, but `s05` is a 5 wearing a 4 (M1); four of the seven 4s state no risk (m2).

## The list as a whole
- [ ] Dependency order executable: no cycle, no forward reference — no cycles, but `s09` has an undeclared dependency on `s06` (M3), and the header graph disagrees with the stories' own Dependencies sections (m3).
- [x] Ids well-formed (`s<number>-<slug>`), unique and stable — `s01`…`s16`, all conforming, all unique.
- [ ] No overlap or duplication between stories — mild overlaps: `s02`/`s15` on install recipes, `s03`/`s11`/`s12` on edit-activity aggregation (m6, m7).

---

## Findings

### Critical

**C1 — coverage — PRD feature 11 (real-time sync, complexity 5, "the demo") is not delivered, and no story delivers it. The delta framing hides this behind a false "in production" claim.**

`docs/stories.md:694` lists "real-time sync" under *"Built, tested, in production."* The code says otherwise:

- `src/lib/sites/embed-script.ts:63-81` — `getPublicWebSocketUrl()` returns `""` unless `NEXT_PUBLIC_WS_URL` is set. Its own header comment: *"an unconfigured websocket now reports itself as unconfigured."*
- `src/lib/sites/embed-script.ts:94-96` — on `""` the `data-ws-url` attribute is **omitted from the snippet**.
- `public/embed/recopyfast.src.js:2703-2705` — `if (!RECOPYFAST_WS) { return; }` inside `establishConnection()`, with the comment *"nothing is listening: server/index.js is a separate Express process that Vercel cannot host, and the configured endpoint refuses connections."*
- `public/embed/recopyfast.src.js:2801-2821` — `sendContentMap()` explicitly reports over HTTP because *"RECOPYFAST_WS is normally unset, so `this.socket` is null on every real install."*
- `docs/quality/qa-register.md:83-86` — *"Real-time is opt-in… `NEXT_PUBLIC_WS_URL` is removed from production. Editing and publishing are entirely HTTP."*
- `server/fly.toml:22` still reads `app = "recopyfast-ws"   # change to your chosen Fly app name` — the deploy target is an uncustomised template, i.e. no evidence the service was ever launched.

Consequences that make this critical rather than major:
1. The PRD parity checklist item *"change persists and appears in a second browser in < 1s (real-time parity)"* (`docs/prd.md:247`) cannot be demonstrated today and no story makes it demonstrable.
2. `s05`'s acceptance criterion `docs/stories.md:223` — *"an edit in one browser appears in a second browser in under 1 second — **unchanged from today**"* — is unverifiable, because "today" is off. `s05` therefore cannot be accepted as written.
3. `s05`'s recommended approach (`docs/stories.md:243-246`) is *"Add a plain-WS endpoint on the `server/` Socket.io service"* — an undeclared dependency on standing up a service that has no running instance.

**Remediation.** Add a story before `s05` that turns real-time on end to end: deploy `server/index.js` (the `Dockerfile` + `fly.toml` exist), set `NEXT_PUBLIC_WS_URL`, and prove the PRD's two-browser < 1s criterion against a real customer-domain fixture. Then rewrite `s05`'s criterion to reference that story's baseline instead of "today", and remove "real-time sync" from `docs/stories.md:694`.

**C2 — coverage — PRD feature 19 (bulk import / export) has API routes but no user-facing surface, and no story gives it one.**

`docs/stories.md:694` lists "bulk import/export" as built and in production. The routes exist and are tested (`src/app/api/bulk/{import,export,update}/route.ts`, `src/__tests__/api/bulk/*`). The only caller of any of them is `src/components/dashboard/BulkOperations.tsx:105,156,208,245,268` — and that component is imported by **nothing**: grep for `BulkOperations` across `src/app/` returns no matches, and across `src/components/` only its own file. There is no Import/Export control anywhere in `src/app/dashboard/`, and the embed widget's Edit Board has no bulk tab.

This directly fails a PRD parity criterion that is scoped to a stranger acting unaided: *"Export all content and re-import it losslessly"* (`docs/prd.md:256`, under *"each must be demonstrable by a stranger, unaided"*). It is also the item the PRD says *"kills the lock-in objection in the sales call"* (`docs/prd.md:126`).

**Remediation.** Add a story (~complexity 2, matching the PRD's own score) that wires content export/import into the dashboard: pick the site, download CSV/JSON, upload, see a per-row result, and a round-trip test asserting losslessness. `BulkOperations.tsx` already exists and can be the starting point.

### Major

**M1 — `s05-embed-budget` — scored 4, but it is a 5, and the arithmetic behind its plan does not close the gap.**

Two separate problems in one story.

*It is a 5.* By the PRD's own scale (`docs/prd.md:128-129`: *"5 real-time, migrations, external systems"*), `s05` is real-time **and** external systems: a new wire protocol, a new endpoint on a separately deployed service, hand-written jittered reconnection replacing socket.io's, and a CSP compatibility matrix on third-party domains. The PRD scored feature 11 a 5 for exactly this list of reasons. The skill's rule is that a surviving 5 must already be split.

*The plan probably does not reach 30KB.* `docs/stories.md:234-236` attributes the whole overage to socket.io: *"174KB raw / 47KB gzipped… The overage is `socket.io-client`."* I could not run gzip, so this is an estimate, clearly flagged as such: socket.io-client 4.8.1 as an IIFE is roughly 43KB raw / ~13-14KB gzipped, which leaves the widget itself at roughly **30-33KB gzipped on its own** — at or over budget with socket.io entirely removed. That is consistent with a 5,397-line source file. If so, "speak plain WebSocket, native `WebSocket` costs zero bytes" does not by itself satisfy the story's first acceptance criterion, and nothing in the story covers shrinking the widget.

**Remediation.** Split into (a) *measure and enforce*: add the gzip check to CI, publish the current number, and shrink the widget itself to a stated target — this is independently shippable and unblocks nothing else; and (b) *replace the transport*: the plain-WS protocol, reconnection, and the CSP matrix, sequenced after C1. Then have (a) state the measured widget-only size so the split is grounded in a number rather than an assumption.

**M2 — `s02-install-verified` — the agentic note names an ingest path the embed script never calls.**

`docs/stories.md:116-118`: *"The embed already posts to `/api/analytics/track` with a site token — derive first-contact from that existing authenticated ingest rather than adding a second beacon endpoint."*

The embed does not post there. Grepping `recopyfast.src.js` for `analytics/track` and `page_view` returns nothing. Every widget call goes through `RECOPYFAST_API + '/...'` and the complete list is: `/staging/{validate,verify,publish}`, `/upload/image`, `/staging/content/…`, `/content/…`, `/ab-tests/{active,bucket,track}`, `/ai/suggest`, `/edit-board/{styles,styles/apply,languages,history,history/…,themes}`.

The signal the story wants already exists under a different name: `postContentMap()` → `POST /api/content/:siteId` (`recopyfast.src.js:2821, 2924`), which `SiteDetailView.tsx:92` already reads as `hasReportedContent`. Left uncorrected, an agent will either instrument a call site that does not exist or add the second beacon endpoint the note was written to prevent.

**Remediation.** Replace the note with `POST /api/content/:siteId` as the first-contact signal, and point at `hasReportedContent` in `SiteDetailView.tsx` as the existing partial implementation. The `authorizeIngestRequest` / `site-auth.ts` guidance in the same story is correct and should stay.

**M3 — `s09-ab-results` — undeclared dependency on `s06`; the graph as drawn is not executable.**

`docs/stories.md:420-422`: *"the honest default is **section impression → subsequent click on a tracked CTA**, which reuses s06's observer."* But `s09`'s Dependencies section (`:414`) lists only `s08`, and the header graph (`:28-39`) puts `s09` on the `s05 → s08 → s09` branch, structurally parallel to and independent of `s06`. Following the graph, `s09` can be scheduled with no impression observer in existence — and its first acceptance criterion (*"Each variant's impressions and conversions are shown"*) then has no impressions to show.

**Remediation.** Add `s06-section-impressions` to `s09`'s Dependencies and draw the edge in the graph, or replace the conversion definition with one that does not require `s06` (and resolve PRD open decision 6 first — the PRD itself says this needs agreement before the significance work starts).

**M4 — `s04-retire-teams-surface` / "Not stories, deliberately" — the site-wide style and theme editor still has a live customer-facing surface, and the file claims it does not.**

`docs/stories.md:698-699`: *"Everything in the PRD graveyard… site-wide theme editor. `s04` removes their last live entry points."* That is false for the theme editor, and `s04` does not touch it.

The embed widget's Edit Board ships five tabs (`public/embed/recopyfast.src.js:5454-5460`): `elements`, `styles`, `languages`, `history`, **`themes`**. Those tabs call the two endpoints the PRD graveyard names verbatim — `:5726 fetch(RECOPYFAST_API + '/edit-board/styles/apply')` and `:6028, :6129, :6159 fetch(RECOPYFAST_API + '/edit-board/themes')` (`docs/prd.md:145-146`). This runs on every customer site, not in an internal dashboard, which is the surface the graveyard's *"no surface in the UI"* rule was written for and the one that produces the *"you broke my site"* support load the PRD cites.

The four dashboard components `s04` targets, by contrast, check out: `TeamSelector`, `InvitationManager`, `NotificationCenter` and `SecurityDashboard` are referenced only inside their own files and `src/__tests__/integration/collaboration.test.tsx`. The Teams nav entry is where the story says it is — `DashboardNavigation.tsx:59-60`. Those claims are accurate.

**Remediation.** Either extend `s04` with an acceptance criterion removing the Styles and Themes tabs from the Edit Board (keeping the routes, per "frozen not deleted"), or record the widget tabs explicitly in "Not stories, deliberately" as a knowingly-retained graveyard surface. Do not leave the file asserting they are gone.

**M5 — `s10-agency-plan` — delivers only part of the Agency tier the PRD sells, with no note about the remainder.**

The PRD's pricing ladder (`docs/prd.md:388`) defines Agency as *"N sites, client sub-accounts, branded subdomain, bulk seat handoff, consolidated billing."* `s10`'s criteria cover the site limit, overage pricing, proration, downgrade refusal and one invoice. `s11` covers bulk seat handoff. **Nothing covers the branded subdomain** — which the graveyard explicitly rules *in* (`docs/prd.md:159-160`: *"a branded subdomain in the Agency plan is in scope"*) — and nothing covers client sub-accounts. Neither appears in "Not stories, deliberately".

Client sub-accounts are arguably correctly omitted, since they would resurrect the graveyard's org-roles model. Branded subdomain has no such excuse.

**Remediation.** Add an acceptance criterion or a follow-up story for the branded subdomain, and add a line to "Not stories, deliberately" recording that client sub-accounts are dropped because they would reintroduce org teams. Both belong in PRD open decision 5, which already says the Agency plan shape must be confirmed before `s10` reaches `/ks-plan`.

### Minor

**m1 — `s06-section-impressions` — "`IntersectionObserver` appears nowhere in the codebase — verified" (`docs/stories.md:290`) is false as written.** It appears at `src/components/landing/InteractiveHero.tsx:518`, `src/components/three/sky/SkyBackground.tsx:235`, `public/demo-site/scripts.js:66,207`, and is globally mocked at `jest.setup.js:177-178`. The substantive point — no impression tracking exists, and `analytics/track` accepts only `page_view` / `content_edit` / `login` / `logout` / `api_call` (`src/app/api/analytics/track/route.ts:29-35`) — is correct. Narrow the claim to "nowhere in the embed script", and mention the existing global jest mock, which will shape how the story's tests are written.

**m2 — four of the seven complexity-4 stories state no risk.** `s05`, `s06` and `s08` carry an explicit **Risk** paragraph. `s01`, `s09`, `s10` and `s11` do not — they carry traps instead, which is close but not the same thing. `s11` in particular ("a leaked or over-scoped grant is a defacement of a customer's live site") has its risk written in the notes but not surfaced where a planner reads it.

**m3 — the header dependency graph disagrees with two stories' own Dependencies sections.** `docs/stories.md:28-39` draws `s01 → s07`; `s07`'s Dependencies (`:330`) lists only `s06`. Conversely `s06`'s Dependencies (`:286-287`) list `s01`, and the graph has no `s01 → s06` edge. The `s01` edge is attached one node too far down. Execution order is unaffected (`s01` precedes both either way), but the graph is the artefact a planner reads first.

**m4 — three acceptance criteria are not decidable as written.**
- `s05`, `docs/stories.md:225`: *"Real-time sync works on a host page served with `connect-src 'self'`, **or** degrades to a documented read-only state…"* — both branches pass, so the criterion asserts nothing. The first branch is also impossible by definition of the header; require the degrade.
- `s03`, `:147`: *"Backfill produces correct values… **or** explicitly marks them as unmeasurable — it never emits a wrong number."* Same disjunction problem, plus "never emits a wrong number" has no observable failure case.
- `s03`, `:149`: *"The funnel is visible to the operator without running SQL by hand."* — no named surface, so no test target. Name the route or the artefact.

**m5 — four criteria defer the number that would make them testable.** `s08:363` ("within a stated tolerance"), `s09:407` ("a stated significance threshold and a stated minimum sample"), `s08:365` ("without a visible flash" — the story's own trap says the approach is still undecided), `s12:531` ("renders correctly in plain text as well as HTML"). Each is fine as an intent, but none can become a test until the value or the method is chosen. Either fix the numbers now or mark them as decisions owed at `/ks-plan`.

**m6 — `s02` and `s15` both own the install-recipe content.** `s02:105` requires per-platform install locations for at least WordPress, Next.js and plain HTML; `s15:634-637` requires eight stacks and says the page must link to *"the same content used by the dashboard's install instructions — one source, two surfaces."* The single-source intent is right, but neither story says which one owns the data structure. Assign it to `s02` explicitly and scope `s15` to the additional stacks plus the verification evidence.

**m7 — three stories aggregate edit activity independently.** `s03:148` (edits attributed to the owning account, non-account edits separately countable), `s11:490` ("A single view lists recent edits across all of the agency's sites"), `s12:527` (edits per client site per month). Not duplication yet, but three separate read models over the same rows. Worth naming one as the source.

**m8 — no byte budget is allocated across `s05`, `s06` and `s08`.** All three assert `recopyfast.js ≤ 30KB gzipped` (`:221`, `:282`, `:367`). If `s05` lands at 29.9KB, the two features that depend on it have no headroom and will each fail their own last criterion. Give `s05` a target with margin and state the per-feature allowance.

**m9 — several PRD SEO/GTM items have neither a story nor an entry in "Not stories, deliberately."** The "Edited with RecopyFast" badge (`prd.md:334-340`, open decision 8 — the file says it *"affects no story"*, which is true but leaves it unowned), the public embed perf-budget page (`prd.md:330-332`), the two free public tools (`prd.md:341-343`), and the agency partner directory / affiliate program (`prd.md:344-345`, `:374`). Add them to the "deliberately not" list so the next agent does not rediscover them as gaps.

**m10 — `s11`'s cross-site view sits close to a graveyard item without saying so.** The graveyard kills *"Teams with org roles (`/api/teams/*`, members, **org activity**)"*. `s11:490` adds an activity view across an account's sites. It is defensible — grants, not roles — but the story should state that it uses the grant model and touches no `/api/teams/*` route, so a later reader does not read it as teams returning through the side door.

---

## Claim verification

Recorded because these claims drive the plan.

**Verified accurate:**

- **A/B parked at `dashboard/_ab-tests`** ✅ — `src/app/dashboard/_ab-tests/page.tsx` exists, and `DashboardNavigation.tsx:49-51` carries the matching comment explaining the route is deliberately absent and reversible.
- **No `agency` plan in the Stripe catalogue** ✅ — `src/lib/stripe/plans.ts:66-90`, `PRICE_ID_ENV_VARS` holds exactly `starter`, `pro`, `credits`, `lifetime_pro`.
- **Time-to-first-edit is not instrumented** ✅ — no milestone or activation table across the 43 files in `supabase/migrations/`, and no equivalent code in `src/`.
- **Teams still linked in the dashboard nav** ✅ — `DashboardNavigation.tsx:59-60`, exactly the lines `s04` cites.
- **`s05`'s reading of `scripts/build-embed.mjs`** ✅ — the header comment records the CDN / `script-src 'self'` failure mode (lines 5-8), socket.io is concatenated ahead of the widget (line 225), `--check` detects a stale artifact (lines 191-210), and there is no size check in the build today. The same-origin lazy-load trap the story warns about is real: `recopyfast.src.js:64` derives `socket.io-client.min.js` from the script URL.
- **`s01`'s file map** ✅ — `src/lib/billing/{entitlements,checkout-reservation,user-lock}.ts` all exist; `permissions.ts:21` reads *"There is no free tier to fall through to"*; `lifetime_pro` resolves via `grantsPlanId` (`plans.ts:462`).
- **`s10`'s file map** ✅ — `countOwnedSites` at `permissions.ts:79`, with the documented *"`sites` has no owner column"* comment at `:150`; `npm run check:stripe` exists in both test and live form (`package.json:33-34`).
- **`s13`'s dependencies** ✅ — `ipaddr.js@^2.2.0` at `package.json:72`; `api/webhooks/route.ts`, `api/webhooks/test/route.ts` and `src/lib/webhooks/` all present.
- **`s04`'s orphan claim** ✅ — the four named components are referenced only in their own files and one test file. See M4 for what the story misses elsewhere.
- **The 30KB budget is documented where the story says** ✅ — `docs/architecture/overview.md:326`.
- **`s08`/`s11` commit references** ✅ — `3099c07` (closed unauthenticated A/B writes), `728b646` (hid site install credentials, restricted site delete) and `aca2eb2` (last-admin revoke) all match the repository history.

**Corrected:**

- **`IntersectionObserver` "appears nowhere in the codebase — verified"** ❌ — false as written. See m1. The material conclusion (no impression tracking, nothing in the embed) holds, which is why this is minor rather than major, but the global jest mock at `jest.setup.js:177-178` is directly relevant to how `s06`'s tests must be written.

**Could not verify:**

- **`recopyfast.js` is 174KB raw / 47KB gzipped.** I have no shell in this review, so neither number was measured. Both are plausible and nothing contradicts them. The size estimate in M1 is therefore an estimate, not a measurement — `gzip -c public/embed/recopyfast.js | wc -c` settles both the story's premise and M1.
- **"1954 tests passing"** (`docs/stories.md:11`) — not verifiable without running the suite. See the staleness note below.

**False alarm, cleared:**

- **AI translate (PRD feature 9) initially looked like a third critical.** `/api/ai/translate`'s only caller is `src/components/dashboard/TranslationDashboard.tsx:87`, and that component is orphaned — imported by nothing but its own test, exactly like `BulkOperations.tsx` in C2. It is **not** a coverage gap: the feature ships through a different path. The widget's Edit Board has a Languages tab (`recopyfast.src.js:5459`) whose "Auto-translate with AI" checkbox (`:5845-5877`) posts to `/api/edit-board/languages`, which calls `aiService.translateText` server-side (`src/app/api/edit-board/languages/route.ts:240`). Feature 9 is delivered, in place, on the live page. Recorded so the next reviewer does not re-raise it.

## Note on `docs/quality/qa-register.md`

The register is stale and should not be read as current state. It reports **1352 tests** against the stories file's 1954, and still lists as open two items that the code contradicts: *"P0-1 Magic-code system has no client… The widget has zero references to `rcf_handoff`"* (`:357-362`) — `rcf_handoff` is now present in `public/embed/recopyfast.src.js` with coverage in `src/__tests__/embed/handoff-roundtrip.test.ts` and `src/__tests__/embed/editor-auth.test.ts` — and *"A-27 `data-ws-url` is always emitted"*, which `embed-script.ts:94-96` now contradicts by omitting the attribute.

None of the register's open items were treated as current without checking them against the code first. The one register claim this review does rely on — that `NEXT_PUBLIC_WS_URL` was removed from Vercel production (`:83-86`) — is corroborated independently by the code path in C1, which is written on the explicit assumption that the variable is normally unset.

---

## Verdict
Max severity: critical
Stories ready: no
