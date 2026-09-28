# Research — Story s51-edit-needs-a-plan

> Read against local `main` at `f4cef65`, 2026-09-28, working tree (the s51 story is uncommitted in
> `docs/stories.md:1903-1945`). Every file:line is on that tree unless it names a branch. The
> fact-find seed was re-checked line by line; two corrections are marked **[corrected]**. Test
> impact was measured by reading every suite that reaches a gated handler (15 Jest files, 2
> Playwright specs), not by running them.

## The five structuring facts

1. **Nothing on the write side reads the owner's plan, and credentials outlive a lapse.** No
   content write and no credential issuance calls `resolveEntitlement`. The only plan checks in
   the product are site creation (`permissions.ts:138-148`), seats (`:313-323`, reached through
   `canShareSite` at `editor/editors/route.ts:245`), A/B generation (`ab-tests/generate/route.ts:68-83`)
   and the middleware's page redirect. That redirect lets `credits` through
   (`middleware.ts:39-49`) and never runs for `/api` (`:161-171`). Credentials keep working after
   a lapse:
   - edit sessions last up to 24 h (`edit-sessions/create/route.ts:66-76`);
   - device grants last 12 h, or 7 days sliding (`editor-grants.ts:39-50`);
   - API keys never expire unless given a date (`lib/api/rate-limiter.ts:98-101`).
2. **`resolveSiteOwnerId` returns *an* admin, not *the* owner, and sites do get more than one
   admin.**
   - The query is `.limit(1)` with no order (`permissions.ts:206-212`). Its own comment says
     "whichever PostgREST returns first" (`:197-200`).
   - `POST /api/sites/[siteId]/share` accepts the role `manager` (`share/route.ts:78`). It maps
     that role to `permission: "admin"` (`collaboration/permissions.ts:34-38`) and inserts it
     (`share/route.ts:210-221`).

   So on an agency site shared with a client as manager, a gate keyed on today's function would
   refuse the paying agency whenever the client's row comes back first. The fix is a
   deterministic owner: the earliest `admin` row by `created_at`. That is the registration row
   (`sites/register/route.ts:138-147`); a manager's row is always newer.
3. **The widget already shows the server's own text, unless the status is 401 or 403.** Any
   401 or 403 on a write goes to `handleTerminalWriteFailure` (`recopyfast.src.js:1183-1184`).
   That forgets the edit link (`:128-130`), locks editing and shows "Session ended — draft kept"
   (`:1228`). Every other refusal shows the body's text:

   | Where | Line | What it shows |
   |---|---|---|
   | save | `:2900`, then `alert` at `:4576`, `:4940`, `:5141` | `error.message` |
   | publish | `:2355` | `result.error` |
   | version restore | `:6213` | `result.error` |
   | AI | `:5407` | `data.error` |
   | code prompt | `:564` | `body.message` |
   | `/edit` hub | `EditorSignIn.tsx:268` | `data.message` |
   | dashboard | `EditWebsiteButton.tsx:82` | `data.error` |

   So a **402** carrying the message costs **0 embed bytes**, and it leaves the edit link in
   place, which "nothing is revoked" requires. A 403 would show the wrong message and discard
   the link. This matters because the artifact sits exactly at its ceiling: it measures
   **45,883 B** gzipped (Node `zlib`, level 9), the same figure as `MAX_BUNDLE_GZ`
   (`build-embed.mjs:168`), and that ceiling only ratchets down.
4. **The billing screens already offer no credits to a no-plan account. The server still
   sells them.**
   - The no-plan branch (`BillingDashboard.tsx:159-206`) renders no purchase control. The only
     entry points are `CreditBalanceCard` in the plan layout (`:279`) and, on s47a, the offer
     card inside that same layout.
   - `/api/billing/checkout` accepts `intent: "credits"` from anyone (`checkout/route.ts:102-116`,
     then the generic branch `:737-757`).
   - Two sentences become false once s51 ships: "You have N credits to spend on AI suggestions
     and translations" (`BillingDashboard.tsx:172`) and "Your credits cover AI features"
     (`permissions.ts:74`).
   - AI spend happens only inside editing (s49 note, `docs/stories.md:1860-1863`). Gating
     `/api/ai/suggest` and `/api/ai/translate` on the owner's plan makes "credits … become
     spendable when a plan is chosen" true. Nothing else is needed.
5. **The suites that write, and every Playwright write fixture, run as ownerless sites.**
   - 13 Jest suites and 2 Playwright specs break on the new call (list under Traps).
   - `e2e/share-edit-publish.spec.ts:336-349` and `e2e/realtime-parity.spec.ts:406-431` insert
     a `sites` row with no `site_permissions` admin, so no owner exists to hold a plan.
   - The fix is fixtures that say "this owner holds a plan". The gate is never softened to make
     a test pass.

## Target story

`docs/stories.md:1903-1945`, P0, complexity 4, branch `feature/s51-edit-needs-a-plan`. Owner
decisions are final: editing, publishing and buying AI credits need the **site owner's**
entitlement to be `plan`. Public delivery never depends on it. Invited editors and API keys of a
paying owner are unaffected. Nothing is revoked, and access returns by itself when the owner picks
a plan.

- [ ] Every content write is refused unless the site owner's entitlement is `plan`: staging save,
  publish, version restore, bulk import and update, `/api/v1/content` POST/PUT, and
  `edit-board/styles/apply`. The refusal is a structured `upgradeRequired` error and nothing is
  written. There is one helper, keyed by the owner, and it fails closed.
- [ ] Editors of a paying owner are unaffected. Editors and API keys of a lapsed owner cannot
  write, and regain access when the owner picks a plan, with no credential revoked or reissued.
- [ ] Public delivery is unaffected, proved by tests: the embed, `GET /api/content/[siteId]`,
  discovery, v1 GET, bulk export and the WebSocket broadcast.
- [ ] The issuance points refuse a lapsed owner up front: edit-session create, code submit,
  handoff and grant refresh. The widget and the `/edit` hub show "This site's plan has ended —
  the owner can reactivate it".
- [ ] Credits checkout requires `plan`. The no-plan screens do not offer credits and say AI credits
  come with a plan. Credits already held are kept.
- [ ] `permissions.ts` says editing needs a plan, the middleware comment becomes true, and ADR
  041 records the rule.
- [ ] Local gates pass in a worktree with local Supabase up, in one story commit. Operator runbook:
  a query that counts paid credits-only accounts.

## Current state of the code

### Content writes: every one is ungated today

| Handler | Who may call | What it writes | Where the gate goes |
|---|---|---|---|
| `PUT /api/staging/content/[siteId]` (`route.ts:165`) | owner session (`authorizeFirstPartyEditorAccess`, `:200`) or editor token (`:221`: staging, edit session, device grant) | RPC `save_staging_content_atomic` (`:289`) | after the per-site limiter `:273-281`, before `:283` |
| `POST /api/staging/publish` (`route.ts:59`) | same | RPC `publish_staging_content_with_attributes_atomic` (`:164`), which is **live** | after the limiter `:146-154` |
| `POST /api/edit-board/history/[versionId]` (`:180`) | owner session or verified staging token (`:211-270`) | RPC `restore_content_version` (`:290`), which rewrites staged copy | after the grade, before `:290`. Its limiter `:208` runs before auth, by design |
| `POST /api/edit-board/styles/apply` (`:61`) | staging token only (`:91-119`) | one OpenAI call per element, **uncharged**, plus `content_elements` update and version (`:204-215`) | after `meterSite` `:121` |
| `POST /api/bulk/import` (`:23`) | session plus `edit`/`admin` (`:95-107`) | `bulk_operations` (`:112`); `content_elements` upsert/insert including `published_content` (`:707`, `:718-721`); service RPC (`:787`) | after `:107`, before `:109` |
| `POST /api/bulk/update` (`:7`) | session plus `edit`/`admin` (`:40-52`) | `bulk_operations` (`:57`); `published_content` update (`:311-318`) | after `:52`. **It has no rate limiter at all.** That is a pre-existing gap and out of scope |
| `POST /api/v1/content` (`:204`); `PUT` is `return POST(req)` (`:348-351`) | API key (`validateAPIKey`, `lib/api/rate-limiter.ts:45`, creator re-checked as admin `:117-133`) **[corrected: not `lib/security/`]** | `published_content` update/insert | after the site binding `:242-247` |
| `POST /api/ai/translate` (`:71`) | session plus any `site_permissions` row (`:163-173`) | charges the **caller** (`:190`) and upserts `content_elements.current_content` (`:246-252`) | after the site limiter `:179-187`, before `:190` |
| `POST /api/ai/suggest` (`:159`) | editor token graded `edit` (`:215-230`) | no content write; charges the owner (`:262-290`, ADR 035) | replaces the owner lookup at `:262-263` |

`DELETE /api/v1/content` (`:352`) is dead code. It needs `permissions.content_delete` (`:373`),
and `validateAPIKey` never sets that field (`rate-limiter.ts:147-151`), so every call is refused
with 403. It needs no gate. If someone revives it, it must be gated.

### Issuance points: all ungated today

| Handler | What it mints | Notes |
|---|---|---|
| `POST /api/edit-sessions/create` (`:11`) | `edit_sessions` token, 0.5–24 h | Authorization lives inside `createEditSession`, which also inserts (`edit-sessions.ts:66-110`). The route has to read permission before the gate (Traps) |
| `POST /api/edit-sessions/extend` (`:15`) | extends a session to the 24 h cap | no caller in `src/` or the widget |
| `POST /api/staging/access` (`:17`) | staging invite token | caller: `ShareSiteDialog.tsx:109`. The admin check sits inside `createStagingAccess` (`staging-access.ts:84-93`) |
| `POST /api/editor/submit-code`, site mode | device grant (`:161`) | the code is consumed at `:79` and the editor found at `:154`, both before the mint |
| `POST /api/editor/handoff/create` (`:28`) | 60 s handoff code (`:76`) | hub cookie plus editor row (`:57`). The hub shows `data.message` |
| `POST /api/editor/handoff/redeem` | device grant, via `redeemHandoff` | the widget only logs a refusal to the console (`recopyfast.src.js:502`) |
| `POST /api/editor/refresh-grant` | a rotated grant with a slid expiry | the widget ignores any refusal except `refresh` (`:428`), so a refused refresh never signs anyone out |

### Left ungated deliberately

| Surface | Why it stays open |
|---|---|
| `GET /api/content/[siteId]` (`:324`) | public delivery |
| discovery `POST` (`:467`) | Inserts only newly found rows, with `ignoreDuplicates` (`:620-628`), and never overwrites `published_content` (`:614-616`). It is the install signal |
| `PUT` on the same route (`:654`) | already always 403 |
| `GET /api/v1/content` (`:97`) | public read |
| `bulk/export` (`:21`, `:250`) | only a `bulk_operations` log row (`:139`) |
| WebSocket | Refuses live writes (`server/index.js:423-429`) and only broadcasts (tombstones `:362`, `:457`). The widget emits after a successful PUT (`recopyfast.src.js:2915`), so a refused PUT never reaches a broadcast |
| `edit-sessions/validate`, `staging/validate`, `editor/validate-grant`; staging GET; publish preview GET; history GET | Reads. Refusing them would push the widget to clear stored credentials (`:470-480`), which breaks "nothing is revoked" |
| `edit-board/history` `POST` | a snapshot; the restore is what gets gated |
| `edit-board/languages` | `site_languages` has no delivery reader (only this route queries it) |
| `themes`, `styles` | graveyard tables |
| `upload/image` | the asset stays inert until a gated save |
| `api-keys` `POST` | a key writes only through the gated v1 route |
| `editor/request-code` | it runs before identity is proven, so gating it would be an oracle |

### Entitlement, payer and cost

- `resolveEntitlement(supabase, userId)` is at `effective-plan.ts:508-533` and returns
  `plan | credits | none` (`:149-156`). It **throws** on any read error: `:367-371`, `:408-412`,
  and `spendable.ts:43-45`.
- `resolveSiteOwnerId` is at `permissions.ts:202-219`. It throws on error and returns null when
  the site has no admin row.
- `getEffectivePlan(userId)` is the cookie-client binding (`entitlements.ts:56-58`).
- **Nothing memoises per request.** There is no `cache()`. Only the catalogue is cached, for
  5 minutes per process (`plans.ts:41`, `:510-527`).
- Cost of one gate call:
  - 1 query for the owner (`site_permissions`);
  - 1 for `plan_entitlements`;
  - usually 1 for `billing_subscriptions` (skipped only for a non-purchase Agency grant, `:395-397`);
  - 1 for `credit_purchases`, only when there is no plan.

  That is 3 round trips for a paying owner and 4 for a lapsed one, once per write request. Writes
  run at human speed, capped at 50/min per site for saves and 10/min for publish
  (`staging/content :270-281`, `publish :143-154`). v1 is capped per key at 100/min by default.
  That is acceptable, and a per-request cache would buy nothing, because each handler calls the
  gate once.
- Precedent for the payer read: the service-role client, keyed by the owner (ADR 035,
  `ai/suggest/route.ts:262-290`). The caller may have no account, and RLS would hide the owner's
  entitlement from a collaborator.

### Billing surfaces

- Checkout route: `intent: "credits"` is parsed at `:102-116`. It then skips the subscription and
  lifetime branches and reaches `createCheckoutSession` at `:750`. No plan is read.
- No-plan panel (`BillingDashboard.tsx:159-206`):

  | State | Condition | Body today | True after s51? |
  |---|---|---|---|
  | credits | `holdsCredits` (`:130-131`) | "credits to spend on AI suggestions and translations" (`:172`) | no |
  | lapsed trial | | "…editing, new sites and collaborators need Pro." | yes, but it does not say AI credits come with a plan |
  | never trialled | | "…before your sites, editors and AI credits become available" | yes |

- s47a (`a886df9`) moves the lapsed copy into `ENDED_TRIAL_COPY` / `ENDED_FOUNDING_OFFER_COPY`
  constants in the same file.

## Anchor points

- **New module** `src/lib/billing/owner-can-edit.ts`, one function per concern:
  - `checkOwnerCanEdit(siteId)` returns `{ ok: true, ownerId } | { ok: false, reason: "plan_ended" | "no_owner" | "unavailable" }`;
  - `PLAN_ENDED_MESSAGE`;
  - a refusal builder: 402 for `plan_ended`/`no_owner`, 503 for `unavailable`, with the body
    `{ error, message, reason, upgradeRequired }`. Both `error` and `message` carry the text,
    because the widget and dashboard read `error` while the editor-auth routes and the hub read
    `message`.
- `resolveSiteOwnerId` (`permissions.ts:206-212`): add
  `.order("created_at", { ascending: true }).order("id")` before `.limit(1)`.
- Gate placement: the "Where the gate goes" column above. For `edit-sessions/create` and
  `staging/access`, gate only when `authorizeFirstPartyEditorAccess(siteId, "view")` returns an
  access. Otherwise fall through to today's code, so outsiders keep today's refusal.
- `ai/suggest`: take `ownerId` from the helper instead of calling `resolveSiteOwnerId` itself
  (`:262-263`). Keep the `no_owner` → `NO_PAYER_MESSAGE` 403 (`:264-271`).
- Checkout: after `parseIntent` (`:166-170`), when `intent.type === "credits"`, require
  `getEffectivePlan(user.id).kind === "plan"`. Otherwise return 403 with `upgradeRequired`. This
  is the buyer's own dashboard route, so the widget's status constraint does not apply.
- Copy and comments to update:
  - `BillingDashboard.tsx:171-176`;
  - `permissions.ts:15-37` and `:63-76`;
  - `effective-plan.ts:137-141`;
  - `middleware.ts:25-38` and `:161-166`;
  - `docs/architecture.md:363`.
- Docs: new ADR `docs/decisions/041-editing-needs-the-site-owners-plan.md`, and a runbook query
  in `docs/operations/`.

## Verified APIs / functions

| Symbol | Location | Behaviour on this story's case |
|---|---|---|
| `resolveEntitlement(client, userId)` | `effective-plan.ts:508` | expired trial and no credits → `none`; credits only → `credits`; throws on read failure |
| `resolveSiteOwnerId(client, siteId)` | `permissions.ts:202` | nondeterministic with 2+ admin rows; null with none; throws on error |
| `getEffectivePlan(userId)` | `entitlements.ts:56` | cookie client; the billing suites mock this name |
| `authorizeFirstPartyEditorAccess(siteId, level)` | `editor-access.ts:138` | null when there is no session, no row, or too low a grade. Never throws on "no" |
| `validateEditorTokenFromRequest` | `editor-access.ts:459` | device grant, staging or edit session. No plan read |
| `validateAPIKey(req)` | `lib/api/rate-limiter.ts:45` | re-checks that the creator is still an admin (`:117-133`). No plan read |
| `createEditSession` | `edit-sessions.ts:59` | reads permission and inserts in one call, and returns null on any failure |
| `issueDeviceGrant`, `refreshDeviceGrant`, `redeemHandoff`, `createHandoff` | `editor-grants.ts:153`, `:396`; `editor-handoff.ts:66`, `:37` | none read a plan |
| `nextActionFor(reason)` | `editor-grants.ts:131` | an unknown reason maps to `verify`. The widget ignores that on refresh |
| `handleTerminalWriteFailure` | `recopyfast.src.js:1183` | acts on 401/403 only |

## Traps & constraints

- **The gate must never run before authorization.** A refusal that says "plan ended" to an
  anonymous caller tells anyone who knows a site id (it is in the public snippet) whether that
  customer lapsed.
  - `edit-sessions/create` and `staging/access` hide their authorization inside a library call
    that also inserts. Read permission first.
  - `submit-code` gates after the code is spent.
  - `request-code` is never gated.
- **Place the gate after each route's per-site limiter.** Earlier, and it spends unmetered reads.
  It also breaks the 429/503 cases and the `mock.calls[0][0]` assertions in
  `staging/service-role-rate-limit.test.ts:150-158`, and the 429 cases in
  `edit-board/service-role-rate-limit.test.ts`.
- **Never answer the plan refusal with 401 or 403 on a route the widget calls** (Fact 3).
  `staging/validate` already treats 401/403 as terminal (`recopyfast.src.js:1029`).
- **Fail closed does not mean "say the plan ended".**
  - If resolution throws, the widget should get a retryable 503, which it alerts on and keeps
    the link. Middleware fails *open* on the same error (`middleware.ts:34-48`), and that stays:
    it only routes pages.
  - A missing admin row is a data bug. Refuse it and log it with `console.error`, as
    `ai/suggest` already does (`:264-271`).
- **Multi-admin sites** (Fact 2). Changing `resolveSiteOwnerId` also changes who pays for seats
  (`canShareSite`) and for widget AI (`ai/suggest`). That is the intended correction, and it
  needs a line in ADR 041.
  - Stubs without `.order` break: `lib/feature-gating/seat-quota.test.ts:94-110` (chain
    `select/limit/eq/neq/maybeSingle`) and `ai/suggest/editor-credentials.test.ts:110-129`.
  - The fix is to add `order` to the stub.
- **Suites that break when the helper is called.** Default fix for each: mock
  `@/lib/billing/owner-can-edit` to answer `{ ok: true, ownerId }`, commented "the fixture's
  owner holds a plan (s51)". Refusal tests keep passing because the gate sits after auth and the
  limiters.

  | Area | Suites |
  |---|---|
  | staging | `content-put-permissions` (keeps its 500 at `:96-103`), `content-href`, `content-concurrent-elements`, `content-concurrent-write`, `content-device-grant`, `grant-revocation-midsession`, `publish-webhook-hook`, `service-role-rate-limit` |
  | bulk | `import`, `import-outcomes`, `roundtrip` |
  | v1 | `content-route` (the schema-strict double has no `.or`/`.returns`, `schema-strict-supabase.ts:23-26`, `:142-210`) |
  | AI | `ai/suggest/route` (its `mockResolvedValueOnce(null)` at `:513-527` moves to the helper mock), `ai/suggest/editor-credentials`, `ai/translate/route` |
  | editor auth | `edit-sessions/create-token-leak` (4 `it` break; the 3 `test.failing` hide it), `editor/handoff/create/route` |
  | checkout | `billing/checkout-concurrency.test.ts` (`:1140-1151` expects 200 for a credit checkout). Add `getEffectivePlan` → `{kind:"plan"}` to its entitlements mock (`:212-214`) |
  | DB | `db/content-attributes-lifecycle.test.ts`. CI skips it (no `RCF_TEST_DB_URL`), but it breaks locally |
  | Playwright | both mutating specs. Seed an owner with `auth.admin.createUser`, then a `site_permissions` admin row and a `plan_entitlements` `{plan_id:"pro"}` row. Delete the user in `afterAll`; both tables cascade (`20260802000000_plans_catalog.sql:222`, `20250817000000_complete_database_setup.sql:54`). They only run with `RUN_RECOPYFAST_CORE_E2E` / `RUN_RECOPYFAST_PARITY` (`e2e/support/local-supabase.ts:9-20`) |

  No suite exercises `POST /api/bulk/update`, `edit-sessions/extend`, `handoff/redeem`,
  `refresh-grant` or `staging/access`. s51's tests are their first.
- **Do not add a Playwright test.** `playwright-ci-contract.test.ts` pins the count at 44
  (`ci.yml:209`), and s47a and s48 both edit that file.
- **The embed is at its ceiling** (Fact 3). The design needs 0 bytes. Any widget edit would have
  to pay for itself by deleting dead code, as s41 did (`build-embed.mjs:150-166`). Only an embed
  *test* pins the 402 path.
- **UX limit.** During a lapse, every blur-save in the text editor alerts, because the 402 is not
  terminal. That is the honest cost of 0 bytes. The cheaper fix, making 402 terminal, costs bytes
  and would forget the edit link.
- **Overlap with s47a** (`feature/s47a-founding-20-grant`, `a886df9`, all ten tasks ticked; ADR 039):
  - `effective-plan.ts` gains an offer path, and its select now needs the `offer_id` migration
    (`:386-392` on the branch). s51 reads only `kind`, which s47a keeps intact: an active offer
    is `plan`, a lapsed one is `none`.
  - `BillingDashboard.tsx:22-36`, `:167-192` conflicts textually with s51's copy edit.
  - The offer card's "Buy more AI credits" renders only in the plan layout. s51 leaves it alone.
- **Overlap with s48** (`feature/s48-credit-integrity`, `93608d8`; ADR 040):
  - Shared files: `ai/suggest/route.ts` (hunks `:137-167`, `:292-345`), `ai/translate/route.ts`
    (`:186-330`), `permissions.ts` `consumeFeatureUsage` (`:485-537`), both AI route suites,
    `effective-plan.ts:527`.
  - s51 inserts one call near each AI route's limiter and edits `permissions.ts` comments and
    `:206-212`. That gives adjacent hunks and a mechanical conflict.
  - s48's DB suite uses the shared local Supabase, so s51's gates start after s48's implementer
    has finished.
- **Pre-existing bugs out of scope.** `bulk/update` has no limiter. `ai/translate` bills the caller
  rather than the owner, and writes rows with an empty `selector` (`:234`).
- **Framing drift.** `docs/prd.md:390` says "Credits | Anyone". The rule becomes "plan holders".
  Framing docs commit on `main`.

## Open questions

1. **Gate `ai/suggest` and `ai/translate`?** They are not in AC 1's list. Recommendation: yes.
   `translate` writes `content_elements`, and gating both is the only thing that makes AC 5's
   "spendable when a plan is chosen" true. For the owner decision.
2. **One message for owner and editor?** The owner reads "the owner can reactivate it" on
   dashboard Edit website. Recommendation: one constant. An owner-specific variant is optional
   and no AC needs it.
3. **Credits-only accounts still pass the middleware and reach a dashboard where every write is
   refused.** Recommendation: leave the routing alone. The story asks only for the comment, and
   reads such as export stay useful.
4. **Deterministic owner by earliest `created_at`?** Recommendation: yes, in s51, with ADR 041
   noting that seats and widget AI now bill the same payer. The alternative, "any admin holds a
   plan", lets a lapsed owner edit through a paying manager.
5. **Amend PRD `:390`** on `main`, beside committing the story text.
6. **Story text to repair** (the lead's call): the fact-find path `src/lib/security/rate-limiter.ts:117-133`
   is really `src/lib/api/rate-limiter.ts:117-133`, and `/api/v1/content` DELETE is dead rather
   than ungated.

## Real complexity

**4, as scored.** Each route change is mechanical: one call after authorization. The weight is in
three places:
- the breadth: 9 write handlers, 7 issuance handlers, checkout, copy, 15 suites and 2 e2e
  fixtures;
- one real design constraint: the widget's status contract, which takes 0 bytes if respected;
- one latent payer bug, which is a one-line fix.

It fits 10 tasks.

## Split proposal

Not required. If the plan grows past 10 tasks, cut it here:
- **s51a (write gate):** the helper, the owner determinism fix, every write route, the
  table-driven test, fixtures, docs and ADR. This closes the leak on its own, because it covers
  every credential already issued.
- **s51b (issuance and credits):** the issuance refusals, the hub/widget message pins, the credits
  checkout and billing copy. This is UX plus the purchase rule.
