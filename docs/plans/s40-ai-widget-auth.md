---
validated: yes
validated_by: operator directive 2026-09-25 — "keep going, don't ask for permission, until tested live in production and ready to launch"
---

# Plan — Story s40-ai-widget-auth

Branch: `feature/s40-ai-widget-auth`, stacked on `feature/s39-editor-back-to-sites` for delivery
(rebase onto it, or onto `main` once s39 merges, before T7).
Research: `docs/research/s40-ai-widget-auth.md`. Read it first; this plan does not repeat it.
No new screen: the modal and the Edit Board keep their current markup. The only visible changes
are that suggestions arrive, a refusal shows the server's sentence, and one checkbox is gone. No
design step.

## Target story

`docs/stories.md` § s40. The owner in edit mode (edit-session token) and an invited editor with a
device grant (`edit`/`publish`/`admin`) get AI suggestions from the widget. A visitor holding only
the public site token cannot spend anything. The site owner pays (`admin` row in
`site_permissions`), through the existing plan/credit gate. No plan or no credits fails closed with
a clear message. Per-site rate limit, public CORS without cookies, `OPTIONS` 204.

## Tasks (ordered)

TDD order: each task writes its failing test first, runs it and records the red, then goes green.
Run the named suites after every task, not just at the end.

1. [x] **T1: billing can charge an explicit payer through an explicit client.**
   Test first: new `src/__tests__/lib/credits/explicit-payer-client.test.ts`. Mock
   `@/lib/supabase/server` so `createClient` **throws if called**, and mock
   `@/lib/billing/entitlements` the same way the existing suites do. Drive the functions with a
   recording fake client (copy the builder shape from `src/__tests__/lib/credits/concurrency.test.ts`),
   and answer entitlement through that client (`billing_subscriptions`/`plan_entitlements`/`credit_purchases` rows).
   Cases:
   (a) `getUserCreditBalance(OWNER, client)` reads `billing_subscriptions`, `credit_purchases`,
   `credit_usage` and the trial grant through `client` and never calls `createClient` or
   `getEffectivePlan`.
   (b) `canUseAIFeatures(OWNER, 1, client)`: Starter plan with 0 purchased → `allowed: false`,
   reason contains "does not include AI credits". Starter plan with 5 purchased → allowed. No
   entitlement → the `NO_ENTITLEMENT` reason.
   (c) `consumeFeatureUsage(OWNER, "ai_suggestion", md, client)` with Pro included credits → a
   `credit_usage` insert with `user_id: OWNER` **through `client`**, and a `usage_tracking` insert
   through `client`.
   (d) Included allowance spent, purchased credits available → compare-and-swap decrement on
   `credit_purchases` through `client`.
   Implementation, in `src/lib/credits/system.ts` and `src/lib/feature-gating/permissions.ts`: add an
   optional trailing `client?: SupabaseClient` (type from `@supabase/supabase-js`, as
   `effective-plan.ts:1` does) to `getUserCreditBalance`, `consumeCredits`, `canUseAIFeatures`,
   `canUseTranslation` and `consumeFeatureUsage`. When it is given, use it for every read and write
   in that call and in the calls it makes, and resolve the entitlement with
   `resolveEntitlement(client, userId)` from `@/lib/billing/effective-plan`. When it is absent,
   behaviour stays exactly as today: `await createClient()` and `getEffectivePlan(userId)`, in the
   same order. The existing suites mock only `getEffectivePlan`, so this is the constraint that
   keeps them green.
   Export `resolveSiteOwnerId` from `permissions.ts` and widen only its parameter type to
   `SupabaseClient`. Its query stays byte-identical (see interdicts).
   Leave a why-comment on the parameter in the house style. It exists because s40's widget route
   has no session. Only a route that has already authorised an editor for the site and resolved
   the owner may pass a service-role client, because this reads and spends another user's wallet.
   Green: new suite, plus the untouched suites `src/__tests__/lib/credits/*.test.ts`,
   `src/__tests__/lib/feature-gating/*.test.ts` and `src/__tests__/api/ab-tests/generate-unentitled.test.ts`.

2. [x] **T2: `/api/ai/suggest` authorises editors and charges the site owner.**
   Tests first.
   - (i) New `src/__tests__/api/ai/suggest/editor-credentials.test.ts`, written the way
     `src/__tests__/api/staging/content-device-grant.test.ts` is written: real
     `validateEditorTokenFromRequest`, a real signed grant (`EDITOR_GRANT_SECRET` set before
     imports, `encodeSignedToken` / `hashOrigin` / `hashUserAgent`), `@/lib/supabase/service`
     stubbed with a recording client. That client answers `editor_device_grants`/`site_editors`,
     `edit_sessions`, `staging_access` and the `site_permissions` admin lookup. `resolveSiteOwnerId`
     stays **real**. `consumeFeatureUsage` is a jest.fn via partial mock (`jest.requireActual` for
     the rest of `permissions`). `aiService` and `enforceRateLimit` are mocked (allow).
     `@/lib/supabase/server.createClient` throws if called.
     Cases:
     1. Only `Authorization: Bearer <site token>` plus `Origin` → 401. No `site_permissions` read,
        no `consumeFeatureUsage`, no model call.
     2. A grant (`edit`) from its minting origin → 200. `consumeFeatureUsage` is called with
        `(OWNER_ID, "ai_suggestion", …, <the service client>)`, where OWNER_ID is the `admin` row
        and not the editor.
     3. The same grant from another `Origin` → 401 `origin_mismatch`, nothing spent.
     4. A grant with `view` only → 403, nothing spent.
     5. `editToken` in the body for a session whose `user_id` is COLLABORATOR, while the admin row
        is OWNER → charged to OWNER.
     6. A grant for site A with `siteId` B in the body → 401.
     7. `OPTIONS` → 204. `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers`
        contains `X-RCF-Editor-Grant`, no `Access-Control-Allow-Credentials`.
   - (ii) Rewrite `src/__tests__/api/ai/suggest/route.test.ts`, and say so in the PR: it pins
     cookie auth, the per-user limiter and the raw provider message. Mock `@/lib/auth/editor-access`
     `validateEditorTokenFromRequest` and keep the real `requireEditorPermission` via
     `requireActual`. Mock the service client, `resolveSiteOwnerId`, `consumeFeatureUsage` and
     `refundCredits`. Keep every existing input-validation case. Add:
     - Missing or non-UUID `siteId` → 400 before any auth call.
     - IP limiter refusal → 429 carrying `Access-Control-Allow-Origin: *`, with no body parse and
       no auth call.
     - Per-site limiter called with `identifier: siteId`, `identifierType: "api_key"`,
       `onStoreFailure: "deny"`, and only after a successful grade. Its refusal → 429 with CORS,
       nothing charged.
     - No `admin` row → 403 `"AI suggestions aren't available on this site."`, `console.error`,
       nothing charged.
     - Gate denial when the caller is the owner (`access.userId === ownerId`) → 403 with the
       gate's reason verbatim and `requiresUpgrade: true`.
     - Gate denial for a grant holder → 403 `"AI suggestions aren't available on this site's plan
       right now. Ask the site owner to add AI credits."` and `requiresUpgrade: true`.
     - Every response carries public CORS.
   - Also edit `src/__tests__/security/auth-guards.test.ts:69`: take `/api/ai/suggest` out of the
     session-auth list and name the change in the PR.

   Implementation: rewrite `src/app/api/ai/suggest/route.ts`. Order:
   1. IP limiter (existing config, fail closed).
   2. `readJsonObject`, then `requireUuid(body, "siteId")`.
   3. Field validation (text, context, tone, goal; aliases in T3). Garbage costs no database work.
   4. `validateEditorTokenFromRequest({ request, siteId, body })`, answering
      `validation.status || 401` with `validation.error`.
   5. `requireEditorPermission(access, "edit")` → 403 `"Requires 'edit' permission"`.
   6. Per-site limiter (`API_UPLOAD`, `endpoint: "ai/suggest"`, fail closed).
   7. `OPENAI_API_KEY` check (T4).
   8. `const service = createServiceRoleClient(); const ownerId = await resolveSiteOwnerId(service, siteId)`.
   9. `consumeFeatureUsage(ownerId, "ai_suggestion", { siteId, editor: access.email ?? access.userId ?? access.kind, originalText: <first 100 chars>, context, tone, goal }, service)`.
   10. Call the model and return the result.

   Delete the cookie client, the per-user limiter and `createClient`. Wrap every response,
   limiter responses included, in `withPublicCors`. Keep `OPTIONS` as `publicOptions(request, "POST,OPTIONS")`.
   Write the header comment in house style, with the tombstones:
   - Cookie auth made the route 401 for its only caller.
   - The per-site bucket sits after the grade, not before it, and why: research trap 1.
   - The payer is the site owner, never the caller.

3. [x] **T3: accept every goal the modal offers.**
   Test first, in `route.test.ts`: each of `improve, shorten, expand, engage, professional, casual`
   → 200. `engage` → `generateContentSuggestion` receives `goal: "optimize"`. `professional` and
   `casual` → `goal: "improve"` with that `tone`. The four canonical goals pass through unchanged.
   An unknown goal → 400 listing the accepted values. This replaces the old message assertion; say
   so in the PR.
   Implementation: a `GOAL_ALIASES` constant applied before `optionalEnum`. Its comment cites
   `recopyfast.src.js:5287-5294` and explains why the server absorbs the vocabulary: every cached
   copy of the permanent-URL artifact sends it, and it costs 0 widget bytes.

4. [x] **T4: fail closed on configuration, never echo the provider.**
   Tests first, in `route.test.ts`:
   - `OPENAI_API_KEY` unset or blank → 503 `"AI suggestions are not available right now."`,
     with `console.error` naming `OPENAI_API_KEY`. No owner lookup, no charge, no model call.
     Restore the env in `afterEach`.
   - Provider `{ success: false, error: "OpenAI API rate limit exceeded" }` → `refundCredits(OWNER_ID, 1, "ai_suggestion_failed")`,
     then 502 `"AI suggestions are unavailable right now. You were not charged."` The provider
     text is absent from the body and present in `console.error`.
   - The model call throws after the charge → refund, then 500 `"Internal server error"`.
   Implementation: a presence check before step 8 (`!process.env.OPENAI_API_KEY?.trim()`), plus a
   `charged` flag so the `catch` refunds only what was taken. The comment cites research §
   "OPENAI_API_KEY absence does not fail loudly". The SDK throws at construction, and the old route
   charged, refunded and echoed the SDK sentence.

5. [x] **T5: `POST /api/edit-board/languages` stops calling the model.**
   Test first: new `src/__tests__/api/edit-board/languages-no-auto-translate.test.ts`.
   `StagingAccessManager.validateStagingAccess` is mocked valid with `admin`, the service client
   records operations, `aiService.translateText` is a jest.fn and the limiter is allowed. POST
   `{ siteId, languageCode: "fr", autoTranslate: true }` → 200. `translateText` is never called.
   The `site_languages` insert has `translations: {}`, `translation_coverage: 0` and
   `last_translated_at: null`, and no `content_elements` read happens.
   Implementation: delete the `autoTranslate` branch (`route.ts:274-315`) and the `aiService`
   import. Keep reading `autoTranslate` from the body only so an old cached widget's request stays
   valid, and ignore it. Drop `autoTranslated`/`translatedCount` from the response; the widget
   never reads it. The tombstone says the branch spent one unmetered OpenAI call per element,
   charged to nobody, into a column nothing reads. It says why it is gone rather than billed, and
   that re-adding it needs owner billing (T1/T2's path) and a reader for
   `site_languages.translations`.
   Green: the new suite plus the untouched
   `src/__tests__/api/edit-board/service-role-rate-limit.test.ts`,
   `src/__tests__/api/edit-board/cors-credentials.test.ts` and `staging-token-device.test.ts`.

6. [x] **T6: the widget sends editor credentials, shows the server's message, and drops
   auto-translate.**
   Test first: new `src/__tests__/embed/ai-suggest-credentials.test.ts`. It is driven through
   `public/embed/recopyfast.src.js` with the harness of `src/__tests__/embed/editor-grant-requests.test.ts`
   (script tag, `new Function(WIDGET_SOURCE)()`, recorded `fetch`). Open the modal with
   `window.ReCopyFast.showAISuggestions({ value: "Hello world" }, "rcf-headline")` and click the
   "Generate Suggestions" button. Cases:
   - Grant holder: exactly one `POST` to `${API}/ai/suggest`, with no query string. Headers
     `X-RCF-Editor-Grant: GRANT`, no `Authorization`. Body equals `{ siteId, text: "Hello world",
     context: "website content", goal: "improve", tone: "professional" }`. The grant appears
     nowhere in the URL or the body.
   - Edit-session owner: page `/pricing?rcf_edit_token=edit-tok`, `staging/validate` answering
     valid with `edit`. `body.editToken === "edit-tok"`. The URL, headers and
     `window.location.href` carry no token, and there is no grant header and no `Authorization`.
   - The server answers 403 `{ error: "AI suggestions aren't available on this site's plan right now. Ask the site owner to add AI credits." }`
     → that exact text is in the modal (`textContent`). A 500 without `error` → the existing
     generic sentence.
   - Source assertions: `autoTranslate` and `Auto-translate` are absent from the widget source,
     and the Languages POST body is `{ siteId, languageCode }`.

   Implementation: the three measured edits, and nothing else.
   (a) `recopyfast.src.js:5366-5378` becomes the snippet below.
   (b) `:5424` becomes `errorP.textContent = data.error || 'Failed to generate suggestions. Please try again.';`
   (c) Remove `:6070-6078` (label + checkbox), `autoTranslate: autoTranslateCheck.checked` at
   `:6100` (and the comma before it), and `addSection.appendChild(autoTranslateLabel);` at `:6113`.

   The snippet for (a):
   ```js
   const response = await fetch(RECOPYFAST_API + '/ai/suggest', {
     method: 'POST',
     headers: Object.assign({ 'Content-Type': 'application/json' }, self.editorAuthHeaders()),
     body: JSON.stringify(Object.assign({
       siteId: SITE_ID,
       text: currentText,
       context: 'website content',
       goal: goal,
       tone: 'professional'
     }, self.editorTokenBody())),
   });
   ```
   Add a JS comment above the fetch (it is minified away, so it costs 0 bytes). It says the site
   token is public and never authorised AI, and that the credential rides in the grant header or
   the body, never the URL. The fetch already sits inside `try/catch`, so non-negotiable #4 holds.
   Run `npm run build:embed` and record the gz numbers.
   Green: the new suite plus the untouched `src/__tests__/embed/*.test.ts`.

7. [x] **T7: ratchet the gate.** Rebase first (s39 or `main`), then rebuild. In
   `scripts/build-embed.mjs`, set `MAX_BUNDLE_GZ` / `MAX_WIDGET_GZ` to the new measurement. Add a
   dated note itemising the two changes:
   - "AI fetch carries editor credentials + server message: +N". At `0b8014f` this measured
     +24 bundle / +27 widget.
   - "Edit Board auto-translate control removed: −M". At `0b8014f`: −77 / −69.
   - Net at `0b8014f`: −53 / −48.

   Gzip deltas drift with context, so record what this branch measures, not these numbers. If the
   net is somehow positive after the rebase, stop and report: raising a ceiling is a defect.
   `npm run build:embed -- --check` must be green, `src/__tests__/embed/build-size-gate.test.ts`
   green, and the artifact committed.

8. [x] **T8: record the decision.** Add `docs/decisions/035-widget-ai-charged-to-site-owner.md`,
   or the next free number: s38 holds 033/034, so re-check at execution. It records the decision
   "widget AI spend is authorised by editor credentials (`validateEditorTokenFromRequest`) and
   charged to the site owner through the service role". Options considered and rejected:
   - Site token via `authorizeSiteRequest`: a public credential.
   - Cookie session: impossible cross-origin, and forbidden with `*`.
   - Charge the caller: grants have no account.
   - A `SECURITY DEFINER` spend function: it would re-implement balance rules in SQL beside the TS
     ones, and they would drift.

   Consequences: one more service-role route for ADR 002's count, and it writes billing rows for
   another user. Also update the AI row of `docs/architecture.md` ("Integration points"):
   `/api/ai/suggest` is the widget's, editor-authorised and owner-charged; `/api/ai/translate` has
   no widget caller.

9. [x] **T9: gates and commit.** Run `npm run precommit` (lint + type-check + jest),
   `npm run format:check`, `npm run type-check:build`, `npm run build` and
   `npm run build:embed -- --check`, all green. Record the outputs in the Execution log. Tick the
   `docs/stories.md` § s40 boxes this branch satisfies, leaving the live-production one for ship.
   Make one commit, `fix: AI suggestions work in edit mode, charged to the site owner`, on
   `feature/s40-ai-widget-auth`, carrying research, plan, code and tests.

## Run interdicts

- Diff must be empty: `src/lib/security/site-auth.ts`, `src/lib/auth/editor-access.ts`,
  `src/lib/auth/editor-grants.ts`, `src/lib/auth/editor-request.ts`, `src/lib/http/public-cors.ts`
  (reuse, don't modify).
- Diff must be empty: `src/app/api/ai/translate/route.ts`, `src/__tests__/api/ai/translate/route.test.ts`,
  `src/components/editor/AISuggestionButton.tsx`, `src/components/dashboard/TranslationDashboard.tsx`
  and their tests, and the msw integration suites under `src/__tests__/integration/`.
- Diff must be empty: every existing suite under `src/__tests__/lib/credits/` and
  `src/__tests__/lib/feature-gating/`, plus `src/__tests__/api/ab-tests/generate-unentitled.test.ts`,
  `src/__tests__/api/edit-board/*.test.ts` and `src/__tests__/embed/editor-grant-requests.test.ts`.
- `resolveSiteOwnerId`'s query is unchanged: no `.order`, no filter change. Only `export` and the
  parameter type change.
- `canUseAIFeatures`'s decision logic is unchanged. No outright `aiFeatures === false` denial.
- No new auth helper, no `authorizeFirstPartyEditorAccess` or cookie client in the AI route, and
  no `authorizeSiteRequest` on it.
- No grant in any URL or body. No edit or staging token in any URL built by the AI call. No body
  field named `token`.
- No migration, no new dependency, no new Playwright spec. The count stays 44.
- `MAX_BUNDLE_GZ` / `MAX_WIDGET_GZ` only go down. `public/embed/recopyfast.js` changes only through
  `npm run build:embed`.
- Out of scope even though adjacent: Edit Board Languages/History `Bearer <stagingToken>` auth
  (`recopyfast.src.js:5986,6095,6122,6201,6229`), `edit-board/styles/apply`'s unmetered model call,
  owner determinism with two `admin` rows, and startup env validation.
- No production access, no env changes, no deploy, no push beyond the story branch.

## The point everything turns on

**Reusing `validateEditorTokenFromRequest` as the AI route's only authentication, and paying with
the site owner's wallet through an explicit service-role client.** I weighed three places where
this could go wrong:

1. **A lone site token might sneak through.** `extractEditorToken` reads `Authorization: Bearer`
   as a *staging* token when nothing else is present (`editor-access.ts:228-231`). The site token
   must then fail `StagingAccessManager.validateStagingAccess`, and fail before any
   `site_permissions` read or charge. T2(i) case 1 is the proof. Compare it against
   `editor-access.ts:186-234` and `staging-access.ts`, not against a mock.
2. **The cookie path might have moved.** The optional client must leave every existing caller
   byte-for-byte on `createClient()` + `getEffectivePlan()`. The evidence is the untouched billing
   suites staying green, and a read of each function's no-client branch. A reviewer should diff
   `system.ts` and `permissions.ts` looking for any reordering on that branch.
3. **The payer might be wrong.** It must be `resolveSiteOwnerId(service, siteId)`, never
   `access.userId`. T2(i) case 5 separates the two ids on purpose. The known imprecision (no
   `ORDER BY` with two admins) is inherited from `canShareSite` and is deliberately not fixed here.

A secondary hesitation is **the per-site limiter placed after the grade**. It contradicts the
brief's wording and follows the codebase's stated reasoning (research trap 1). Check it against
`staging/content/[siteId]/route.ts:259-272`.

## Files touched

- `src/app/api/ai/suggest/route.ts`: rewrite.
- `src/lib/credits/system.ts`, `src/lib/feature-gating/permissions.ts`: explicit client, and the
  `resolveSiteOwnerId` export.
- `src/app/api/edit-board/languages/route.ts`: branch removed.
- `public/embed/recopyfast.src.js` and `public/embed/recopyfast.js` (built),
  `scripts/build-embed.mjs` (ceilings).
- Tests, new: `src/__tests__/lib/credits/explicit-payer-client.test.ts`,
  `src/__tests__/api/ai/suggest/editor-credentials.test.ts`,
  `src/__tests__/api/edit-board/languages-no-auto-translate.test.ts`,
  `src/__tests__/embed/ai-suggest-credentials.test.ts`.
- Tests, changed and named in the PR: `src/__tests__/api/ai/suggest/route.test.ts`,
  `src/__tests__/security/auth-guards.test.ts`.
- Docs: `docs/decisions/035-…md`, `docs/architecture.md`, `docs/stories.md`, this plan, the research.

## Test strategy

- **Security at the route level is tested through the real editor-access code** with real signed
  grants and a recording Supabase stub (T2(i)). Mocking the validator is how a fail-open ships
  green.
- **Behaviour at the route level** (validation, aliases, limiter order, messages, refunds, config)
  uses a mocked validator for speed and clarity (T2(ii), T3, T4).
- **Billing** is tested at the unit level against a recording client, proving the explicit client
  is the only one touched (T1). The existing suites prove the default path did not move.
- **Widget** tests are driven through the real source (T6), asserting on the recorded requests and
  on what the modal renders.
- **Byte gate**: `build-size-gate.test.ts` + `build:embed -- --check` (T7).
- **No Playwright** (44-test contract). A live production check after deploy covers the owner edit
  session → 🪄 AI → suggestions, an invited editor with a grant → suggestions, `curl` with only the
  site token → 401, and a Starter owner without credits → the owner sentence. It belongs to ship,
  not to this branch.

## Definition of Done

- Every task ticked. New and changed suites green, and every interdicted file's diff empty.
- `npm run precommit`, `npm run format:check`, `npm run type-check:build`, `npm run build` and
  `npm run build:embed -- --check` green, outputs in the Execution log.
- Gz ceilings lowered to this branch's measurement with both deltas itemised. The artifact is
  rebuilt, not hand-edited.
- ADR written and the architecture row updated. The PR names each changed pre-existing test and
  why.
- One story commit on `feature/s40-ai-widget-auth`. Independent `/ks-review` passes before ship.
  After deploy, the operator confirms `OPENAI_API_KEY` in Vercel production and the live check
  above passes.

## Execution log

2026-09-25, implementer. Base: `origin/main` at `0e1d5bc` (s39 merged as #37 while this ran; the
branch was moved onto it before T7, see "Base" below). Jest runs with the CI placeholder env.

**T1 — explicit payer.** New `explicit-payer-client.test.ts`, 6 cases. Red: 6/6 failed —
"the cookie client must not be opened for an explicit payer" (3) and "getEffectivePlan reads the
caller's cookie, not the payer" (3). Green: 6/6; with the untouched `lib/credits/*`,
`lib/feature-gating/*` and `ab-tests/generate-unentitled` suites, 10 suites / 112 tests.
Jest's `toHaveBeenCalledWith` compares argument counts (checked in a scratch test), so the cookie
path forwards the client with `...payerClientArg(client)` (`[]` when absent) and keeps its exact
old argument lists — `permissions.test.ts` pins `consumeCredits(user, cost, feature, undefined)`.

**T2 — route authorises editors, owner pays.** New `editor-credentials.test.ts` (7 cases, real
`validateEditorTokenFromRequest`, real signed grant, real `resolveSiteOwnerId`), rewritten
`route.test.ts`. Red: 37 failed / 1 passed. The pass is the `OPTIONS` pin (case 7), behaviour that
already existed and must survive. Two other cases first passed vacuously, because the old route
crashed to 500 on the throwing cookie client. They were strengthened to assert the grade ran and
the model was reached, then re-run red. Green: 38/38. `auth-guards.test.ts` list edited (vacuous
assertion; no red possible).

**T3 — goal aliases.** Red: 5 failed (six modal goals, three mappings, new 400 message).
Green: 42/42. The model mock is now `mockReset` in `beforeEach`: `clearAllMocks` keeps queued
`mockResolvedValueOnce` values, which leaked into later tests while the red was showing.

**T4 — config and provider failures.** Red: 4 failed (503 unset / blank, 502 no-echo + refund,
refund on throw). Green: 45/45. The "gate throws before the charge → no refund" guard passed on
the old route, which had no catch-refund at all. It was checked by mutation instead: setting
`chargedOwnerId` right after the owner lookup fails it (1 failed), and the route was restored.

**T5 — languages POST stops translating.** New `languages-no-auto-translate.test.ts`. Red:
`translateText` called 2 times (expected 0). Green; `api/edit-board` 4 suites / 62 tests, the
three untouched ones included.

**T6 — widget.** New `ai-suggest-credentials.test.ts`, 6 cases. Red: 5 failed. The pass is the
generic-fallback case, the existing sentence that edit (b) must keep. Green: 6/6; all
`src/__tests__/embed` suites green.

**T7 — byte gate** (Node `zlib.gzipSync` level 9, the gate's own measurement; each change also
measured alone in a scratch copy):

| | bundle | widget |
|---|---|---|
| main at `0e1d5bc` = ceilings before s40 | 46226 | 33465 |
| AI fetch carries editor credentials + server message, alone | +26 (46252, over) | +28 (33493, over) |
| Edit Board auto-translate control removed, alone | −71 (46155) | −67 (33398) |
| **this branch** | **46176 (−50)** | **33420 (−45)** |

For reference, on the old base `fb28a8b` (≡ `0b8014f` for the embed) the same edits measured
+25/+26, −77/−69, net −53/−47 (46635/33860 → 46582/33813). Ceilings ratcheted
46226/33465 → 46176/33420 in `scripts/build-embed.mjs`, with an itemised dated note. The same
pair is pinned as `SEEDED_MAX_*` in `build-size-gate.test.ts`, following s39. Red: "never lets a
ceiling be raised above the size it was seeded at" — expected ≤ 46176, received 46226. Green:
`build:embed -- --check` "embed artifact is up to date", 15 embed suites / 180 tests.

**T8.** `docs/decisions/035-widget-ai-charged-to-site-owner.md` (035 was still free on main);
AI row of `docs/architecture.md` updated.

**T9 — gates** (on the final tree):
- `npm run precommit`: lint 0 errors (38 pre-existing warnings, none in touched files),
  type-check clean, jest **260 suites passed, 2 skipped (DB-backed, no isolated DB); 3398 tests
  passed, 39 skipped**.
- `npm run format:check`: "All matched files use Prettier code style!"
- `npm run type-check:build`: clean.
- `npm run build`: exit 0. It printed `gzipped bundle 46176 B (max 46176) | widget 33420 B (max 33420)`
  and "✓ Compiled successfully". The catalogue `fetch failed` lines come from the placeholder
  Supabase URL during static generation, and are caught.
- `npm run build:embed -- --check`: "embed artifact is up to date".
- Interdicted files: empty diff. `resolveSiteOwnerId`'s query is unchanged (only `export` and the
  parameter type). No migration, dependency or Playwright change (count stays 44).

**Base.** The worktree started at `fb28a8b`. `origin/main` then advanced to `0e1d5bc` (s39
merged). As this plan's T7 requires ("rebase … onto `main` once s39 merges, before T7"), the
uncommitted work was re-applied onto `0e1d5bc` without the shared stash: backup, patch,
`merge --ff-only`, `apply --3way`. The only conflict was `docs/stories.md`, where both entries
were kept, s39 then s40. The artifact was regenerated with `build:embed`, not merged.
