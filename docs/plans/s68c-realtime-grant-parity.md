---
validated: no
---
# Plan — Story s68c-realtime-grant-parity

Branch: `feature/s68c-realtime-grant-parity`, from `main` **after s68a merges** (ADR 047, e2e seeds).
Research: `docs/research/s68c-realtime-grant-parity.md` — read it first; this plan does not repeat it.

## Target story

`docs/stories.md` → s68c. Realtime staging admission and re-validation apply the HTTP device
binding (UA hash + 12 h TTL) and ADR 047's edit-session authority; editor revocation matches e-mail
case-insensitively; `join-dashboard` requires a live editor grant; HTTP staging validation honours
a revoked `site_editors` row.

## Tasks (ordered)

1. [ ] **Device binding parity (RED → GREEN).** `src/__tests__/websocket/auth-parity.test.ts`: new
   rows feeding identical inputs to `checkStagingDeviceBinding` (`src/lib/auth/staging-device.ts`)
   and the server copy — unbound (no hash / no `verified_at`), stale (12 h + 1 s), mismatched UA,
   matching UA within TTL — and to both `hashUserAgent`s (incl. `null` UA). Integration in
   `server.integration.test.ts` (new `describe("staging admission is device-bound")`): a verified
   staging row bound to UA X — handshake with UA Y gets `auth-error` and is not in
   `site:{id}:staging`; with UA X it is admitted; a row whose `verified_at` is 13 h old is refused;
   an admitted silent socket is dropped by one sweep after `verified_at` is moved past the TTL.
   GREEN: `server/auth.js` gains `hashUserAgent` + `checkStagingDeviceBinding` (duplicated, comment
   naming the parity suite) and `resolveStagingGrant` takes `{ userAgent }`; `server/index.js`
   stores `socket.handshake.headers['user-agent']` on `socket.data` at the handshake (`:285-295`)
   and passes it from `revalidateSocket` (`:158-180`).
2. [ ] **Dashboard room requires a live grant.** RED: "a plain viewer's `join-dashboard` is refused
   and it receives no `content-updated`" — viewer joins, an editor emits a persisted update
   containing `UNPUBLISHED SECRET DRAFT`, viewer receives nothing and gets `auth-error` (the s07a
   proof, inverted). GREEN at `server/index.js:513-532`: require `socket.data.isStaging` and a
   passing `revalidateSocket(socket)` before `socket.join`; tombstone citing the s07a review.
   Update `connectDashboard` (`server.integration.test.ts:764-781`) and the rate-limit relay test
   (`:602-640`) to connect with an editor credential — declared in the PR as a test change forced by
   the behaviour change.
3. [ ] **Case-insensitive revocation.** RED in the `revocation reaches a live socket` block
   (`:1045+`): staging row e-mail `John@Example.com`, `site_editors` row `john@example.com` stamped
   `revoked_at` → refused at the handshake **and** an already-open socket is dropped within one
   sweep. GREEN: `server/auth.js:195-206` compares `access.email.trim().toLowerCase()`.
4. [ ] **Edit-session authority parity (ADR 047).** RED: parity rows for the intersection
   (`{admin}` row + live `edit` → `[view, edit]`; no live row → refused; NULL `user_id` → refused;
   `created_at` 25 h ago → refused) against s68a's HTTP validator; integration: an edit-session
   socket whose holder's `site_permissions` row is deleted is dropped within one sweep. GREEN in
   `resolveEditSessionGrant` (`server/auth.js:219-241`): one `site_permissions` read by `site_id` +
   `user_id`, intersection with `normalizePermissions`, 24 h lifetime from `created_at`.
5. [ ] **HTTP honours editor revocation for staging tokens.** RED: new
   `src/lib/auth/__tests__/staging-access.revoked-editor.test.ts` — a verified, device-bound staging
   token whose e-mail (any case) has a `site_editors` row for the site with `revoked_at` set →
   `validateStagingAccess` returns `{ valid: false }` with the existing "Invalid or expired staging
   token" error; no directory row → unchanged (valid); `verifyEmail` and `resendVerificationCode`
   refuse the same token without sending a code. GREEN in `src/lib/auth/staging-access.ts`
   (service-role read of `site_editors (revoked_at)` by `site_id` + `normalizeEmail(email)`).
6. [ ] **Gates, e2e, commit.** `npm run precommit`, `npm run prepush`, `npm run test:e2e:parity`
   on the local stack (realtime parity spec green with s68a's seeds), `npm run build:embed -- --check`
   clean (the server package has no test script; its suites run in the root Jest run); one story
   commit.

## Rollout (operator)

Two independent deploys; each only refuses more, so either order is safe.
1. Merge → Vercel deploys the HTTP half (task 5).
2. From the merged `main`: `cd server && fly deploy` (never from the repo root —
   `docs/operations/fly-deploy.md`). Then `curl -s https://recopyfast-ws.fly.dev/health` → `status: ok`,
   `supabase: connected`.
3. Smoke on a test site: open edit mode with a staging link in browser A (verified) — co-editing
   works; paste the same link into browser B (different UA) — B's socket is refused and its HTTP
   requests ask for verification; remove the editor in the dashboard — A's socket drops within a
   minute.
No migration.

## Run interdicts

- `git diff main...HEAD -- public/embed/ supabase/` is empty.
- `server/` requires nothing from `src/` (`grep -n "require('\.\./" server/*.js` finds only
  intra-package paths); `server/package*.json` unchanged.
- No new socket event, no new room, no write path on the socket (ADR 004 rule 1 — realtime
  broadcasts, never writes).
- No `fly deploy`, no Vercel deploy, no production SQL by the implementer; no `--no-verify`.

## The point everything turns on

Realtime must be exactly as strict as HTTP — no stricter for honest editors, no looser for anyone.
Where this could be wrong:
1. **The UA a browser sends on the WebSocket upgrade vs on fetch.** Both carry the same
   `User-Agent` in every engine we support; confirm in the Playwright parity run (Chromium) that a
   verified editor's socket is admitted, not just in jsdom fixtures.
2. **Duplicated hashing drifting** — the parity rows compare outputs, not code; a null or empty UA
   must hash identically on both sides.
3. **Gating the dashboard room breaking a client nobody knew about** — the grep in research found
   none in `src/` or the embed; Fly logs after deploy should show no `join-dashboard` refusals from
   real traffic.

## Files touched

Modified: `server/auth.js`, `server/index.js`, `src/lib/auth/staging-access.ts`,
`src/__tests__/websocket/auth-parity.test.ts`, `src/__tests__/websocket/server.integration.test.ts`
(+ `harness.ts` if fixtures need a UA / `site_permissions` stub). New:
`src/lib/auth/__tests__/staging-access.revoked-editor.test.ts`.

## Test strategy

Parity table first (it is the contract between the two copies), then the real server booted on
port 0 by the existing harness for admission, sweep and room behaviour, then the Playwright parity
spec as the honest-editor guard.

## Definition of Done

Repo DoD, plus every s68c AC checked with its named test, the Fly deploy and smoke recorded in the
PR after the operator runs them, and `docs/reviews/s07a-realtime-service-hardening.md`'s two
known-open majors referenced as closed in the s68c review.
