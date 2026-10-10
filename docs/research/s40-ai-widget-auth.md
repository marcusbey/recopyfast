# Research — Story s40-ai-widget-auth

Date: 2026-09-25. Base: `0b8014f`. Scope prevalidated by operator (hands-on testing: "Failed to
generate suggestions" on every attempt). Stacked on `s39-editor-back-to-sites` for delivery, but
the byte arithmetic below does not depend on s39 landing first (fact 5). No production access was
used; every claim is from the repository at `0b8014f` and from builds in a scratch copy.

## The five structuring facts

1. **Root cause confirmed: cookie auth on a route whose only caller cannot send a cookie.**
   `POST /api/ai/suggest` authenticates with the cookie Supabase client
   (`src/app/api/ai/suggest/route.ts:38-48`, `supabase.auth.getUser()` → 401 `Unauthorized`). Its
   only live caller is the widget on the customer's origin (`public/embed/recopyfast.src.js:5366-5378`),
   which sends `Content-Type` and `Authorization: Bearer <SITE_TOKEN>` — no cookie (cross-origin
   `fetch`, default credentials), **no editor credential, and no `siteId`**. Every request 401s and the
   modal prints "Failed to generate suggestions" (`:5424`). The route also contradicts its own CORS
   helper: `withPublicCors` (`src/lib/http/public-cors.ts:11-24`) is for endpoints that authenticate
   "never with cookies".
2. **Fixing authentication alone still fails closed for everyone — billing reads the owner through
   the caller's cookie.** Every function on the charge path builds its own cookie client:
   `getEffectivePlan` (`src/lib/billing/entitlements.ts:56-57`), `getUserCreditBalance`
   (`src/lib/credits/system.ts:118,127`), `consumeCredits` (`system.ts:411`), `consumeFeatureUsage`
   (`src/lib/feature-gating/permissions.ts:431,465`). The credit and usage tables allow only
   `auth.uid() = user_id` or `service_role` (`supabase/migrations/20260731003000_missing_tables_billing_credits.sql:86-170`,
   `20260617001000_ticket_wallet_compat.sql:69-79`). In a cookieless request the owner resolves to
   `none` → 403 "This account has no active plan". The client-taking cores already exist:
   `resolveEntitlement(supabase, userId)` (`src/lib/billing/effective-plan.ts:344`),
   `readPurchasedCreditBalance(supabase, userId)`, `readTrialGrant(supabase, userId)`; and the payer
   is already defined once, as `resolveSiteOwnerId` (`permissions.ts:165-181`, private today).
3. **The helper to reuse is not an `authorize*` in `site-auth.ts`.** `authorizeSiteRequest`
   (`src/lib/security/site-auth.ts:164-263`) accepts the site token + Origin pin and nothing else —
   precisely the credential that must never suffice. The one existing helper that accepts the device
   grant header, an edit-session token and a staging token is **`validateEditorTokenFromRequest`**
   (`src/lib/auth/editor-access.ts:459-498`), graded by `requireEditorPermission` (`:104-109`). It is
   the composition `PUT /api/staging/content/[siteId]` (`route.ts:221-245`) and
   `POST /api/staging/publish` (`route.ts:100-128`) already use with the service role. A lone
   `Authorization: Bearer <SITE_TOKEN>` is read as a staging token (`editor-access.ts:228-231`) and
   refused by `StagingAccessManager` — the visitor case fails closed by construction. No new auth path.
4. **Even authenticated and billed, half the widget's goal menu is rejected.** The modal offers
   `improve, shorten, expand, engage, professional, casual` (`recopyfast.src.js:5287-5294`) and always
   sends `tone: 'professional'`; the route accepts goals `improve, shorten, expand, optimize` only
   (`route.ts:15`, enforced `:98-103`). `engage`, `professional`, `casual` → 400 → same
   "Failed to generate suggestions". Fix server-side (aliases): zero widget bytes, and it also repairs
   every cached copy of the artifact already on customer pages.
5. **The widget change costs more than the headroom; the widget's other AI action pays for it.**
   Headroom at `0b8014f`: bundle 46,635 / 46,681 (46 B), widget 33,860 / 33,865 (**5 B**)
   (`scripts/build-embed.mjs:110-111`, `node scripts/build-embed.mjs --check`). Measured in a scratch
   copy with the gate's own measurement (Node `zlib.gzipSync` level 9, `build-embed.mjs:264-266`):
   credentials on the AI fetch + showing the server's message = **+24 bundle / +27 widget** — over by 22.
   The widget's second AI affordance, Edit Board → Languages → "Auto-translate with AI"
   (`recopyfast.src.js:6070-6113`), makes `POST /api/edit-board/languages` run **one unmetered OpenAI
   call per content element, charged to nobody** (`src/app/api/edit-board/languages/route.ts:274-315`)
   into `site_languages.translations`, which **nothing reads** (only that route touches the table).
   Removing the control nets the whole story at **−53 bundle / −48 widget**: self-financing, and it
   still fits if s39 ratchets the ceilings to its own exact measurement first.

## Target story

`docs/stories.md` § s40. An owner in edit mode (edit-session token) and an invited editor holding a
device grant with `edit`/`publish`/`admin` can use every AI action the widget exposes; a visitor with
only the public site token cannot spend AI. Spend is charged to the site **owner** (`admin` row in
`site_permissions`), honours the owner's plan (`plans.limits.ai_features` via the existing gate),
fails closed with a clear message on no AI / no credits, is rate-limited per site, public CORS (no
cookies), `OPTIONS` 204.

## Current state of the code

### Every AI call site in the widget, and what it sends

| # | Where | Request | Headers / body today | Server |
|---|---|---|---|---|
| 1 | Inline toolbar "🪄 AI" (`recopyfast.src.js:4310-4314`, click `:4635-4641`) → `showAISuggestions` (`:5243`) → Generate (`:5348-5438`) | `POST {API}/ai/suggest` (`:5366`) | `Content-Type: application/json`, `Authorization: Bearer ${SITE_TOKEN}`; body `{text, context:'website content', goal, tone:'professional'}` — no `siteId`, no grant, no edit token | 401 for everyone (fact 1) |
| 2 | Staging banner "Edit Board" (`:2259-2266`) → Languages tab → Add Language with "Auto-translate with AI", checked by default (`:6070-6100`) | `POST {API}/edit-board/languages` (`:6092`) | `Authorization: Bearer ${this.rcf.stagingToken}` (`:6095`); body `{siteId, languageCode, autoTranslate}` | Staging-token only, `admin` required (`languages/route.ts:211-235`); AI unmetered (`:278-315`) |

Nothing else in the widget reaches an AI service. `aiBtn` is rendered for every edit-mode toolbar,
so grant editors reach call site 1 (`applyEditorIdentity`, `recopyfast.src.js:1094-1110`). Call
site 2 is reachable only from the staging banner: edit-session owners send `Bearer null`
(`stagingToken` is null for them, `:866-868`) and get 401 on the whole Languages tab; grant editors
get the editor banner, which has no Edit Board (`:1265-1267`). In practice only a staging-link
holder with `admin` ever triggered it.

### `/api/ai/translate` is dead — scoped out

No call site in `recopyfast.src.js`. Its only caller is `TranslationDashboard.tsx:87`, and
`TranslationDashboard` (like `AISuggestionButton.tsx:53`, the dashboard caller of `/ai/suggest`) is
imported by nothing but its own tests. The route has no `OPTIONS` export and no CORS headers
(`src/app/api/ai/translate/route.ts`, whole file), so the widget could not call it cross-origin even
if it tried. Left untouched, tests included.

### How credits are debited today, and whose

`route.ts:106-111` → `consumeFeatureUsage(user.id, "ai_suggestion", …)` (`permissions.ts:430-476`):
`canUseAIFeatures` (`:345-382`: no entitlement → deny; balance ≥ cost → allow; else a plan-aware
denial) → `consumeCredits` (`system.ts:405-470`: balance via `getUserCreditBalance`, purchased
credits decremented by compare-and-swap `deductPurchasedCredits` `:336-403`, then a `credit_usage`
row) → `usage_tracking` insert (`permissions.ts:465-473`, error discarded). On provider failure the
route calls `refundCredits` (`system.ts:523-555`, service role, adds a non-expiring grant). Cost:
`CREDIT_COSTS.AI_SUGGESTION = 1` (`system.ts:31`). **Whose:** the signed-in caller (`user.id`), never
the site owner — and the route never learns which site the request is for.

### `OPENAI_API_KEY` absence does not fail loudly

`getOpenAIClient()` passes `process.env.OPENAI_API_KEY` (`src/lib/ai/openai-service.ts:7-14`); the
SDK constructor throws "The OPENAI_API_KEY environment variable is missing or empty…"
(`node_modules/openai/client.js:85-87`) inside the `try` of `generateContentSuggestion`, which logs
`console.error("Content suggestion error:")` and returns `{success:false, error:<SDK message>}`
(`openai-service.ts:151-157`). The route has **already charged**, refunds (`route.ts:138-142`), and
returns the SDK's message verbatim with 500 (`:143-145`). Not in `validateConfig`
(`src/lib/config/production.ts:329-337`, which nothing calls at startup), not in `/api/health`.
Whether the key is set in Vercel production cannot be verified from here.

## Anchor points

- `src/app/api/ai/suggest/route.ts` — rewritten around `validateEditorTokenFromRequest`.
- `src/lib/credits/system.ts`, `src/lib/feature-gating/permissions.ts` — accept an explicit client
  for an explicit payer; export `resolveSiteOwnerId`.
- `src/app/api/edit-board/languages/route.ts:274-315` — the unmetered auto-translate branch.
- `public/embed/recopyfast.src.js:5366-5378` (credentials), `:5424` (message), `:6070-6113` (control).
- `scripts/build-embed.mjs:110-111` — ceilings to ratchet.

## Verified APIs / functions

- `validateEditorTokenFromRequest({ request, siteId, body?, allowUnverified? })` →
  `{ valid, access?: EditorAccess, error?, status? }` (`editor-access.ts:459`). Token precedence
  (`extractEditorToken`, `:186-234`): `X-RCF-Editor-Grant` header → `rcf_token` query /
  `body.rcf_token|stagingToken|token` → `rcf_edit_token` query / `body.editToken|editSessionToken` →
  `Authorization: Bearer` (as a **staging** token). Grants need an `Origin` (`readDeviceContext`,
  `editor-request.ts:20-29`) and are refused without one (`editor-access.ts:307-312`).
- `requireEditorPermission(access, "edit")` (`editor-access.ts:104`); `normalizePermissions`
  widens `admin ⊃ publish ⊃ edit ⊃ view` (`:75-102`).
- `EditorAccess.userId` = `edit_sessions.user_id` for edit sessions (`:451`), absent for grants.
- `resolveEntitlement(supabase: SupabaseClient, userId)` (`effective-plan.ts:344`); re-exported by
  `entitlements.ts:10-14`.
- `resolveSiteOwnerId(supabase, siteId)` (`permissions.ts:165`, not exported): first
  `site_permissions` row with `permission = 'admin'`, `.limit(1)`, throws on read error.
- `createServiceRoleClient()` (`src/lib/supabase/service.ts:12`).
- `enforceRateLimit(request, { limit, endpoint, identifier, identifierType, onStoreFailure, message })`
  (`src/lib/api/rate-limit.ts:91`); presets `IP_GENERAL` 200/min, `API_UPLOAD` 10/min,
  `USER_CONTENT_EDIT` 50/min (`src/lib/security/rate-limiter.ts:424-436`).
- `withPublicCors(response, req?, methods)` and `publicOptions(req?, methods)` — `publicOptions`
  already returns `new NextResponse(null, { status: 204 })` (`public-cors.ts:50-62`); `ALLOW_HEADERS`
  already includes `X-RCF-Editor-Grant` (`:33-34`). The suggest route's `OPTIONS` already uses it
  (`route.ts:164-166`).
- Validation: `readJsonObject`, `requireString`, `requireUuid`, `optionalEnum`
  (`src/lib/api/validation.ts:36,53,164,190`).
- Widget: `editorAuthHeaders()` → `{ 'X-RCF-Editor-Grant': grant }` or `{}` (`recopyfast.src.js:1216-1219`);
  `editorTokenBody()` → `{}` when a grant is held, else `{ stagingToken, editToken }` (`:1232-1238`).
  `showAISuggestions` has `self` bound (`:5244`).
- Plans: Starter `ai_features: false, monthly_credits: 0`; Pro `true, 500`
  (`20260802000000_plans_catalog.sql:287,295`); Agency `true, 1000` (`20260924065000…sql:42`).

## Traps & constraints

- **"Rate limit per site before authorization" conflicts with the codebase's reasoning, and the
  codebase is right.** The site id is public; a per-site bucket in front of the grade lets anyone lock
  the owner out of AI by naming it — stated at `staging/content/[siteId]/route.ts:259-272` and
  `edit-board/languages/route.ts:38-41`. Both AGENTS.md rules hold with: **per-IP limiter before
  authorization** (existing, fail closed, `route.ts:29-35`) + **per-site limiter after the permission
  grade** (fail closed, ADR 002 rule 4). The per-user limiter (`route.ts:54-62`) goes: grants have no
  user.
- **Do not keep a cookie path.** Public CORS plus cookie auth is the combination `public-cors.ts:17-24`
  forbids, and no first-party caller exists (both dashboard components are dead). Do not add
  `authorizeFirstPartyEditorAccess` here.
- Limiter responses are returned without CORS (`route.ts:35,62`): the widget cannot read a 429 and
  shows "Error connecting to AI service". Wrap every response.
- Edit-session token goes in the **body** (`editorTokenBody()`), never the URL: `editorTokenQuery()`
  would put it in history, `Referer` and logs. Grant only in the header. Never add a body field named
  `token` (read as a staging token, `editor-access.ts:213`).
- **Payer = site owner via `resolveSiteOwnerId`**, never `access.userId` (an edit session can be
  created by a non-owner collaborator) and never `sites.user_id` (no such column; that bug shipped once).
- `resolveSiteOwnerId` has no `ORDER BY` (`permissions.ts:170-176`): with two `admin` rows the payer
  is nondeterministic. It is the same definition `canShareSite` bills seats to, and
  `seat-quota.test.ts:93-99`'s chain has no `.order` — do not change its query here (open question 3).
- **"Honour `ai_features`" means the existing gate, not a new denial.** `canUseAIFeatures` lets the
  balance decide and uses the flag only for the message (`permissions.ts:335-343`, a deliberately
  removed inversion). A Starter owner with no purchased credits is denied with "Your Starter plan does
  not include AI credits. Buy credits…"; with purchased credits, allowed. An outright
  `aiFeatures === false` deny would re-break paying Starter customers.
- The gate's messages say "Your … plan": wrong for an invited editor. Rephrase for non-owners.
- Billing suites mock `@/lib/billing/entitlements` with `getEffectivePlan` only
  (`concurrency.test.ts:182-183`, `trial-period.test.ts:85-86`, `permissions.test.ts:48-50`,
  `seat-quota.test.ts:33-34`). The default (cookie) path must keep calling `getEffectivePlan` exactly
  as today; only the explicit-client path may call `resolveEntitlement`.
- `usage_tracking` grants users SELECT only; the cookie insert at `permissions.ts:465` is silently
  denied today. Through the service role it will start writing rows. Expected, worth a line in the PR.
- Refunds add a non-expiring purchased grant (`system.ts:523-555`) even when included credits were
  spent — pre-existing, unchanged.
- Existing tests that pin current behaviour and must change (and be named in the PR):
  `src/__tests__/api/ai/suggest/route.test.ts` — cookie auth (`:11-13,56-63,182-197`), per-user
  limiter (`:212-223`), raw provider message echoed (`:352-363`), goal enum message (`:330-340`).
  `src/__tests__/security/auth-guards.test.ts:69` lists the route under session auth (vacuous
  assertion, but now false).
- Tests that must stay untouched: `src/__tests__/api/ai/translate/route.test.ts`, the msw
  integration suites (`src/__tests__/integration/ai-suggestions.test.tsx`, `setup.ts:248` — they
  mock the route), `AISuggestionButton.test.tsx`, `TranslationDashboard.test.tsx`, every billing
  suite above, `src/__tests__/api/edit-board/service-role-rate-limit.test.ts` (languages POST with
  `autoTranslate: true` asserts only "no AI when refused", `:234-244,364-369` — stays green),
  `src/__tests__/embed/edit-board-tabs.test.ts:243` (still finds `/edit-board/languages`).
- No embed test exercises the AI fetch today; `editor-save-lifecycle.test.ts:284,476,526` only spy
  on `showAISuggestions`. The grant-in-URL blanket test (`editor-grant-requests.test.ts`, last
  `it`s) never opens the AI modal — the AI call needs its own assertions.
- Route-level security tests must drive the real `validateEditorTokenFromRequest` with a real signed
  grant and a stubbed Supabase client — the method of `src/__tests__/api/staging/content-device-grant.test.ts:1-16`
  ("mocking the thing under protection is how a fail-open ships green").
- Byte numbers are for `0b8014f`. Gzip is context-dependent: re-measure after rebasing on s39 and
  expect a few bytes of drift. s39's T8 ratchets `MAX_*` to its exact post-change measurement, so s40
  inherits no headroom and must be net ≤ 0 on its own — it is.
- Adjacent, out of scope: `edit-board/styles/apply/route.ts:174` also calls the model unmetered
  behind a staging token (no widget caller since s04); the Edit Board's Languages and History tabs
  send `Bearer <stagingToken>` (`recopyfast.src.js:5986,6095,6122,6201,6229`), so edit-session owners
  get 401 across those tabs. Both are follow-up stories.

## Open questions

1. **Is `OPENAI_API_KEY` set in Vercel production?** Not checkable without production access. The
   plan makes absence fail closed *before* charging, with a loud `console.error`; the operator
   confirms the variable before the live test.
2. **Removing "Auto-translate with AI"** is a product call taken in the plan on these grounds: its
   output is displayed nowhere, it spends unmetered, only staging-link admins could reach it, and it
   pays for this story's bytes. If vetoed, drop T5/T6's removal half and find +27 widget bytes
   elsewhere before the gate will pass.
3. **Deterministic owner** when a site has more than one `admin` row (prefer the creator row,
   `granted_by IS NULL`). Affects seat billing too; follow-up.
4. Staging-link (`rcf_token`) editors with `edit` will also be able to spend the owner's credits —
   the same helper, the same grade as content writes. Assumed intended.
5. The per-site limiter sits after the grade, not before it (trap 1). Operator may overrule.

## Real complexity

**3.** Every piece has a precedent in the repo: the auth composition (staging content/publish), the
real-grant route tests (`content-device-grant.test.ts`), the client-taking billing core
(`resolveEntitlement`), the per-site fail-closed limiter, the embed request tests. The work is a
route rewrite, threading an explicit client through four billing functions without disturbing the
suites that mock them, deleting one branch, three small widget edits and a ratchet. What keeps it
from a 2: it moves another user's wallet through the service role, so the security tests have to be
real rather than mocked.

## Split proposal

Not required. If the auto-translate removal is vetoed (open question 2), it does not split cleanly:
the suggest fix alone cannot pass the byte gate.
