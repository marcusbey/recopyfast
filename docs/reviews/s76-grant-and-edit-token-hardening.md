# Review — s76-grant-and-edit-token-hardening

Reviewer: fresh-context `reviewer` subagent (security, opus), 2026-10-09. Diff: `git diff origin/main...feature/s76-grant-and-edit-token-hardening`
(72f4cff → 9152ac6; fdde3b0 docs, ADR 055).

## Verdict summary

All 12 plan tasks present; nothing beyond the plan; nothing under server/ or supabase/, no dependency change. Every
symbol opened (createServiceRoleClient, EDITOR_ACCESS_UNAVAILABLE, normalizeOrigin, originBelongsToSite, the edit-link
helpers, signed-token encode/decode, CRYPTO_DOMAIN.editLink, normalizeEmail, revokeAllGrantsForEditor,
MAX_GRANT_LINEAGE_MS, site-auth normalizeDomain/parseOrigin). `last_used_at` has no default/trigger; only the spend
and editor-access.ts:578 write it; each create inserts a new row — no pre-touch DoS.

Security answers: (a) the spend is one conditional `UPDATE … WHERE … last_used_at IS NULL … RETURNING token` — on a
throwaway Postgres 17 (bootstrap + 72 migrations) as service*role: a second request blocked ~2 s on the row lock then
got 0 rows; three rounds of 20 parallel requests → exactly 1 token each, 19 empty, no errors. (c) the code travels only
in the fragment, lives 60 s, works once. (d) token exposure not worse than before (sessionStorage per ADR 036; public
CORS `*` without cookies, only for a valid code + the site's Origin). (e) HMAC-SHA256 with its own domain tag + NUL
separator, constant-time compare, binds session + site + expiry. (f) refresh cannot reset the lineage start (carried in
the signed token); legacy tokens fall back to the row once. (g) exact host, case-insensitive, punycode both sides,
trailing dot and www/apex refused; parity test pins it against site-auth. (h) R4 ends every active invite to that
address on that site, in code (no `*`wildcard). (i) 503 body generic; no retry loop. (j) every reader treats`null`
exactly as absent.

Gates: jest 387 suites / 5,030; type-check (both) 0; lint 0 errors; format:check clean; build:embed 45827 / 33059
(down from 45828 / 33062); Playwright `--list` 80. 27 mutations: 24 red; survivors M5 (spend without
`expires_at > now`), M26 (code without numeric expiry), M27 (spend not scoped to site) — redundant guards, untested.

## Findings (all minor)

1 untested redundant guards; expiry check `<= Date.now()` lets NaN through (safe only via an untested type check).
2 a DB outage during the Origin check answers 403 (code forgotten), not 503. 3 the code is spent before the session is
validated — a following 503 burns it. 4 legacy `?rcf_edit_token=` no longer stripped from the address bar. 5 customer
docs (installation-content.ts:205-206,308; install-recipes.ts:79) still name `rcf_edit_token`. 6 edit-board routes
still answer 401 on an outage (low impact). 7 stories.md conflict with main — rebase. 8 pre-existing:
site-auth.normalizeDomain throws for registered domains starting with "http" (httpbin.org) → story s95.

## Fix pass 1 (`e7e3abe`)

Check, then spend: the edit-link redemption validates the session (ADR 047, no use recorded) before the single-use
spend and answers the token only for a session confirmed valid; a 503 at any step leaves the code unspent. The offline
expiry check refuses NaN; `originBelongsToSite` answers null on a failed read → 503, not 403 (edit-link redemption,
handoff/redeem, submit-code); the Edit Board's fifteen staging checks answer 503 on an outage through
`stagingRefusalStatus` (census-pinned); the widget strips a legacy `?rcf_edit_token=` without reading it; customer
install docs name `#rcf_edit=` and ask for it to be excluded from replay/analytics. Ceilings 45827 / 33059 → 45813 /
33052, paid by dropping `window.` from globals.

## Verification of fix pass 1 — fresh-context security reviewer (opus): MAJOR

`public/embed/recopyfast.src.js` (`open` at :1338, :2354 and the other de-`window.`ed names): the widget is a
classic-script IIFE with no local binding for these names, so a bare name resolves through the customer page's global
lexical scope first. A host page's `let open = false` made Re-authenticate and Preview Live throw `TypeError: open is
not a function` into the host window (non-negotiable 4). Fix: put `window.` back.

## Fix pass 2 (`0d65645`)

`window.` restored on all fifteen uses of `open`, `history`, `addEventListener`, `removeEventListener`,
`localStorage`, `sessionStorage` (five were bare on main too). `location` stays bare: it is [LegacyUnforgeable], so a
page's top-level `let/const/class location` is a SyntaxError and `var location` rebinds nothing. New
`host-page-globals.test.ts` declares those bindings as a page script and drives the share link, handoff, both grant
stores, the inline editor's listeners, Re-authenticate and Preview Live. Bytes: 45823 / 33064 after restoring, paid by
`864e5` for two 24 h products → ceilings **45818 / 33059** (below main's 45828 / 33062). `recordUse` default pinned;
`validateDeviceGrant` refuses NaN in the signed `x` and the row `expires_at`, and a lineage start more than 60 s in
the future; handoff/redeem comment corrected.

## Verification of fix pass 2 — fresh-context security reviewer (opus): minor, ship allowed

Scope-aware census (acorn + eslint-scope) of `0d65645`: **0** bare uses of the six names (e7e3abe had 3/3/1/1/2/5).
Built artifact: none in the widget; bundled socket.io uses bare `addEventListener` behind `typeof` checks
(third-party, pre-existing). `location` claim confirmed by spec and measured in Chromium 145.0.7632.6 and WebKit 26.0
(`let/const/class/function location` throw; `var location` aliases). Real-browser probe of the built artifacts with
a host page declaring all six names, six flows: `e7e3abe` throws `history.replaceState is not a function` and fails
to boot the editor in both engines; `0d65645` passes every flow with 0 page errors. `864e5` value-identical;
ceilings = measurement = seeds (ledger adds up). Grants: `x`/`l` are inside the HMAC-signed token whose hash must
match the row; `created_at` is DB-set, `expires_at` server-computed — the 60 s skew only absorbs server/DB clock
drift. Mutations: all 15 `window.` sites red; NaN guards, lineage bound, skew 0 / 10 min, `recordUse` red; skew 90 s
survived. Gates: jest 388 suites (1 pre-existing flake in `server.integration.test.ts` "drops an open staging socket
within one sweep", passes alone 2/3), type-check (both) 0, lint 0 errors, format:check clean, build:embed up to date,
Playwright `--list` 80.

Minors: (1) the regex census had a 230-line blind spot (`/*` inside `// … /api/editor/*` read as a block comment)
and missed ternary/spread uses; (2) the 60 s skew boundary unpinned; (3) wording — `location` count in the ledger, the
NaN comment, a dead `unhandledrejection` listener.

## Fix pass 3 (`a466a9d`) — verified by the orchestrator

(1) New `host-page-globals-census.test.ts`: ESLint `Linter` + `no-restricted-globals` over the widget as a classic
browser script; fixtures pin the old blind spots (a use after `// … /api/editor/*`, ternary, spread, a parameter named
like a global), each of the six names, and a parse error reported as failure; `location` excluded with the reason.
Bare `open('x')` inserted at src.js:190 and :1000, `a ? open : null`, `[...history]` — all red (the regex missed
each). (2) +59 s valid / +61 s expired (clock frozen on a whole second); skew 90 and 30 both red. (3) `location` is
13 bare references on 11 lines (counted with the same rule); NaN comment truthful; dead listener removed. Rebased on
main 122ad2e (s74, s75): contract 81 unchanged, ceilings re-measured 45818 / 33059. Jest (CI mode with coverage) 394
suites / 5,140; coverage 69.68 / 62.59 / 66.45 / 70.29 above s75's floors; type-check (both) 0; lint 0 errors;
format:check clean.

Merge note (applied): s77 landed first, so `staging-outage.test.ts` now uses an RFC v4 UUID instead of `"site-123"`
(`canonicalSiteId` answers 400 to anything else). Rebased on main `0dea1c0` (s70b, s88, s77): contract 86, embed
45818 / 33059; edit-board, staging, auth and embed suites 835/835.

## Devin Review on PR #84 — fixed (`fa820c1`)

🔴 **Remembered grants expire early near ceiling** (valid): `remembered` was inferred from the row's span, but a
replacement is capped at the 30-day lineage ceiling, so a remembered grant refreshed in its final day got a < 24 h row
and the next refresh fell to the 12 h session TTL. CTO decision (plan decision 20): `issueDeviceGrant` signs `r: 1 | 0`
inside the HMAC payload next to `l`; `validateDeviceGrant` reads `remembered` from it (`=== 1`); a token minted before
the flag falls back once to the row span (those rows were never capped); rewriting or stripping `r` breaks the
signature. 🟡 **Editor revocation misses later invites** (valid): the sweep read the site's active invites in one
request, capped at `max_rows`. CTO decision (21): no PostgREST filter reproduces `normalizeEmail`, so the sweep pages
`id, email` in a total order (`id`), advancing by rows returned until an empty page, reads every page before writing,
and deactivates matches in batches of 100 ids, reporting what landed on a partial failure. 15 mutations red.

## Verification of `fa820c1` — fresh-context reviewer (sonnet): minor, ship allowed

`r` is inside `encodeSignedToken`'s HMAC'd payload; `decodeSignedToken` recomputes it timing-safely, so rewriting or
stripping `r` yields `null` → `malformed`; the legacy fallback applies only to `r === undefined`, which a forger cannot
produce from a token that carried `r`; the 30-day ceiling binds both kinds at issue and at use; rotation inherits the
signed choice and ignores the caller's `rememberDevice`. Revocation matches with `normalizeEmail` in code (no `ilike`),
ids come only from the site-scoped read. 14 mutations, 13 red; `src/lib/auth` 219 passed; type-check (both), lint,
format:check, build:embed 45818 / 33059, Playwright `--list` 81. Minors: (1) the update's `.eq("is_active", true)` was
unpinned; (2) the batched update was scoped by id only.

## Final fix — orchestrator

The batched update also carries `.eq("site_id", siteId)`; test "scopes every batched update to the site and to active
invites" (red first without the site fence; dropping the `is_active` fence turns it red too). `src/lib/auth` 220/220.

## Not verified

The two edited e2e specs (CI core e2e job; watch the 60 s code vs first-compile of /api/staging/validate). A real
customer page (slow, consent-gated, SPA/hash routers rewriting the fragment) — after deploy: Edit website → URL ends
in `#rcf_edit=…` then shows the bare URL; reopening the same URL → "Invalid or expired staging link."; navigating to a
second page → still editing. supabase-js → PostgREST path of the spend. Real-browser Origin/fragment across a www
redirect.
Firefox `let location` (not installed for the probe). Socket.io under a host `let addEventListener` (third-party,
behind type checks). Real Supabase/Vercel clock drift.

Max severity: minor
Ship allowed: yes
