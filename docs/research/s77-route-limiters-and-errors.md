# Research — Story s77-route-limiters-and-errors

Verified against `origin/main` at `c0c40bf` on 2026-10-09, in the story worktree. No production
access: no SQL, no connector, no credentials. Every line number below is `c0c40bf`'s. Scope comes
from the `s69-security-lows` stub (API-route items) and three open review minors, as assigned by
the orchestrator; billing (L5 → s82), health (L3 → s84), headers/WS (s79), DB grants (s80) and
anything under `src/app/api/staging/validate` or `src/app/api/edit-sessions/` (s76 is editing
them) are out.

## The limiter toolkit, as it is

- `enforceRateLimit(request, { limit, endpoint, identifier?, identifierType?, onStoreFailure })`
  (`src/lib/api/rate-limit.ts:96-162`). No identifier → the client IP (`getClientIp`, first
  `x-forwarded-for` entry). The store throws when Redis is unreachable in a production-like
  environment (`src/lib/security/rate-limiter.ts:44-48,568-583`); the route's `onStoreFailure`
  then decides: `deny` → 503, `allow` → unmetered.
- Presets used here (`rate-limiter.ts:419-444`): `IP_GENERAL` 200/min, `USER_GENERAL` 100/min,
  `USER_CONTENT_EDIT` 50/min, `API_UPLOAD` 10/min, `USER_DOMAIN_VERIFY` 3/5 min,
  `API_KEY_DEFAULT` 1000/min.
- `requireUuid(body, field)` (`src/lib/api/validation.ts:297-309`) accepts an RFC 4122 v1–v5 id in
  any case and returns it trimmed and lower-cased; anything else is a fixed message that echoes
  nothing. It is already the boundary for `ai/suggest:187`, `ai/translate:117`,
  `upload/image:111`, `analytics/*` and (s68b M3) the editor code routes.
- `timingSafeEqualString(a, b)` (`src/lib/auth/editor-crypto.ts:130-134`): SHA-256 both sides,
  `crypto.timingSafeEqual` over the two 32-byte digests — constant time and length-safe (it never
  throws on a length mismatch, so length does not leak through the exception path).

## Two house precedents for the pre-authorization guard

1. **Visitor path, fail open** — `content/[siteId]` `shedUnauthenticatedLoad`
   (`route.ts:261-296`): `IP_GENERAL`, per IP never per site, before any `sites` lookup; fails
   open because the same helper fronts the content GET, whose denial would un-publish every
   customer at once.
2. **Fail closed when a fail-closed limiter sits behind it** — `v1/content` (s44 research
   §"Decisions": "valid keys are refused by the per-key limiter anyway, so failing open there would
   only let unauthenticated traffic reach `validateAPIKey`'s three round trips while nothing is
   metered"), `api-keys` POST/PUT/DELETE (`route.ts:155-156`), `sites/register`,
   `regenerate-snippet`, and ADR 037 step 1 for dashboard service-role writes.

Every route this story guards has, on each success path, a fail-closed limiter behind
authorization (existing or added here). So in a Redis outage a legitimate caller is refused there
anyway, and failing the IP guard open would buy them nothing while handing an unmetered flood the
authorizer. **Rule for this story: the IP guard fails closed** — precedent 2. Each route says so
in one line.

## L4 — `CRON_SECRET` compared with `!==`

`cron/ab-test-lifecycle/route.ts:14`, `cron/generate-blog-post/route.ts:8`,
`cron/webhook-dispatch/route.ts:28` (`!cronSecret || authHeader !== \`Bearer ${cronSecret}\``) and
`blog/generate/route.ts:21` (`cronSecret && authHeader === …`). A string `===` returns at the first
differing byte. Over the network the signal is small, but it is the one secret here compared that
way, and the fix is the primitive the codebase already uses for every other secret. Only
`webhook-dispatch` has a test (`src/__tests__/api/cron/webhook-dispatch.test.ts:57-90`); it pins
401/200 behaviour that both comparisons satisfy. `generate-blog-post` must keep reading the secret
— it forwards it as a bearer to `blog/generate` (`:26-34`).

Test that bites: a spy on `crypto.timingSafeEqual` (the precedent is
`src/__tests__/security/site-auth.test.ts:139-140`) proves each route's decision went through the
constant-time comparison; `!==` never calls it.

## L7 — work before any limiter

- `ab-tests/bucket/[siteId]`: `authorizeSiteRequest` (`:45`, a `sites` lookup) before the per-site
  limiter (`:82`). `ab-tests/active/[siteId]`: `:40` before `:86`. `ab-tests/track`: the bounded
  body read (`:424`, no database) and `:440` before `:478`. The per-site limiters stay behind
  authorization on purpose (their comments: metering an anonymous caller into a customer's bucket
  would let anyone lock that customer's widget out) — so the fix is a per-IP guard in front, not
  moving them.
- `staging/publish` POST: `authorizeFirstPartyEditorAccess` (a GoTrue `getUser` + a
  `site_permissions` read) and `validateEditorTokenFromRequest` (`:86-138`) before the per-site
  limiter (`:150`). GET (the publish dialog's preview, `recopyfast.src.js:2355`): no limiter at
  all, then a service-role read of every `content_elements` row of the site (`:301-311`).
- `staging/content/[siteId]` GET (`:45-166`): no limiter at all; service-role read of the site's
  staged copy. PUT has its per-site limiter behind the grade (`:277`) and no IP guard.
  **Corrected after review (m1)** — the first version of this line said "nothing in the product
  calls it today (the widget only PUTs)". Wrong: the widget reads it on every load that can reach
  staging (re-verified on `fc5968b`, `public/embed/recopyfast.src.js`):
  - `contentReadEndpoint` (`:878-881`) builds `/staging/content/<id>` whenever
    `canReachStagingContent()` (`:1353-1355`) is true — a staging or edit-session link, or a
    stored editor grant;
  - `hydrateStoredContent` (`:3881-3895`) GETs it, through `loadRows` (`:3766-3784`): once per
    page load, and once per new path of a single-page app (`checkRoute`, `:3716-3728`; cached
    per path, a failed fetch is forgotten so the next visit asks again);
  - `startPolling` (`:5798-5818`) GETs it every 5 s per tab. It starts only from
    `establishConnection`'s catch (`:3101-3104`): the socket cannot even be constructed (no
    bundled socket.io client — the raw source; the built artifact always prepends it). No WS URL
    returns before any socket; a server refusing connections is socket.io's reconnection
    (5 attempts), not the poll.

  Arithmetic for the limits s77 puts on it (plan decision 2):
  - per site, `staging/content-read`, `USER_GENERAL` 100/min, shared by every editor tab of the
    site from every address: 100 editor page views a minute, or 8 polling tabs (8 × 12 = 96/min)
    with a few page views on top; the 9th polling tab (108/min) is the first refusal;
  - per IP, `staging/content:ip`, `IP_GENERAL` 200/min, shared by GET and PUT and by every site
    one address edits: 16 polling tabs (192/min), or e.g. 4 polling tabs (48) + 100 page views +
    50 saves (the per-site PUT ceiling);
  - a refusal costs a polling tab one 5 s tick (the next tick asks again), or shows one page as
    authored with a console warning until the next visit asks again. It never loses a write.
- Visitor impact of `IP_GENERAL` on the A/B routes: the content GET on the same page view is
  already behind `IP_GENERAL` per IP (`content/read`), so the A/B guards add no ceiling a visitor
  would not already meet; a refusal costs the A/B variant, the page keeps its authored copy.

## R1 — per-site buckets keyed on the raw id

Raw `siteId` as the limiter identifier: `staging/publish/route.ts:153`,
`staging/content/[siteId]/route.ts:280`, `edit-board/history/route.ts:51`,
`edit-board/languages/route.ts:48,68`, `edit-board/styles/route.ts:46`,
`edit-board/styles/apply/route.ts:51`, `edit-board/themes/route.ts:49`. The authorizers reach the
site through a `uuid` cast, so `ABCD…` and `abcd…` are one site with two buckets (s68b M4, same
class). Already canonical, verified, no change: `ai/translate:218` (`requireUuid` at `:117`),
`ai/suggest:242`, `upload/image:145`, `analytics/*`; `edit-board/history/[versionId]:85` keys on the
database's `version.site_id`.

Trap (s68b research, M4): public-token routes must not refuse spellings, installed snippets are
permanent. These are editor routes, but the widget still sends the snippet's `SITE_ID`
(`recopyfast.src.js:2392,6352,6476`). `requireUuid` lower-cases any case and refuses only shapes
the dashboard never issues (braces, no hyphens, a non-RFC version/variant digit). Every site id is
`gen_random_uuid()` (`20250817000000:17`), and every literal id in `src/`, `public/embed/`, `e2e/`
and the migrations is RFC v4. So no installed snippet is refused; upper-case ones share the bucket.

Fixture cost: unit suites that drive these routes with `"site-1"`, `"site-123"`, `"site-abc"` or
`11111111-1111-1111-1111-111111111111` (not RFC: variant digit `1`) will 400. Reshaping those ids to
RFC v4 spellings is required and must be listed in the PR (s68b review minor 9, same situation).

## R2 — `bulk/update` operations

`route.ts:31-39` checks only that `operations` is an array. Each operation is a sequential
`content_elements` read plus at most one service-role write (`:203-336`), and the whole array is
stored in `bulk_operations.configuration` (`:104`). The only caller, the dashboard's batch form
(`BulkOperations.tsx:298-326`), builds operations by hand one row at a time; large changes go
through bulk import (one RPC, ADR 008). A cap in the hundreds is invisible to that form.

## R5 / s68b #3 — `domains/verify`

POST (`:133`), GET (`:406`) and DELETE (`:468`) have no limiter; PUT's per-user limiter (`:311`)
runs after `getUser` (`:300`) with no IP guard before it — ADR 037 step 1 missing (s68b review
minor 3). POST and DELETE write `domain_verifications` through the service role after an RLS
permission read; GET reads it through the service role. The dashboard (`DomainVerification.tsx:96,
141,172,196`) fetches on mount and after each action.

## R6 — `sites/[siteId]/share`

POST (`:49`), GET (`:290`), DELETE (`:384`): `getUser`, `checkSitePermission`, then service-role
reads/writes of `site_permissions`; GET decorates each row through the Admin API
(`attachUserIdentities`). No limiter anywhere. No component fetches the route (its own comment,
`:313-318`).

## s42 m3 — API keys per site and key names

`POST /api/api-keys` (`route.ts:153-246`) inserts with no count and no name bound (`name TEXT`,
`20250817000000:84`). The panel shows the server's `error` in its error box
(`ApiKeysPanel.tsx:49,150,183-188`), so a 409/400 needs no UI change. Counting must use the service
client: the SELECT policy shows a user only their own keys (`20260804130000:176-181`), and the cap
is per site (that is what bounds s44's per-site multiple). A count-then-insert is not atomic: two
concurrent creates can both pass at 9. The window is bounded by the fail-closed per-user write
limiter (10/min) and only an admin of the site can race it, against their own site's budget; a
database-enforced cap would need a migration and a trigger — recorded as a follow-up, not done.

## s44 m2 — the decision nobody wrote down

`/api/v1/content` meters per key (`v1/content/route.ts:82-97`), ADR 002 §4 says per site. s44's
research justified it (`docs/research/s44-v1-rate-limiter.md:149-152`) and its review asked for an
ADR (`docs/reviews/s44-v1-rate-limiter.md:36-37`). With the key cap above, per-key metering has a
per-site bound: 10 keys × the key ceiling (default 100/min, not request-controllable — no
authenticated writes on `api_keys`, ADR 034) = 1,000/min, the ceiling every widget per-site
limiter already uses (`API_KEY_DEFAULT`). ADR 056 records it. ADR 055 is taken by s76
(`feature/s76-grant-and-edit-token-hardening`); renumber at merge if another branch claims 056.

## Left for s77b (files other stories own now)

- `POST /api/staging/validate` — no limiter before authorization (L7).
- `POST /api/edit-sessions/{validate,extend}` — no limiter before authorization (L7);
  `active`/`revoke` — no limiter at all.
- `POST /api/edit-sessions/create` — per-user limiter after `getUser`, no IP guard (s68a review
  m9). The other half of m9 (AGENTS.md "Data access" does not list every service-role principal)
  is a rules edit, out of an implementer's reach.
- `edit-board/*` — per-site limiters behind authorization with no IP guard in front (not in L7's
  list; R1 only is fixed here).
