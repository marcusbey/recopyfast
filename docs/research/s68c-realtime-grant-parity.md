# Research — Story s68c-realtime-grant-parity

Verified against `origin/main` at `659778e` on 2026-10-08. No production access was used.

## The five structuring facts

1. **The realtime service is live, and its admission is weaker than HTTP's on three axes.**
   `recopyfast-ws` runs on Fly and new snippets carry `data-ws-url`, so editing sessions connect
   (`docs/architecture.md:51-54,375`). `server/auth.js` `resolveStagingGrant` (`:176-217`) checks
   active / not revoked / not expired / `email_verified` and the `site_editors` revocation, but
   **not** the device binding HTTP enforces (`src/lib/auth/staging-access.ts:236-290` →
   `checkStagingDeviceBinding`, `src/lib/auth/staging-device.ts:137-160`: User-Agent hash + a
   12-hour verification TTL). A forwarded staging URL that HTTP answers "re-verify" is admitted to
   `site:{id}:staging` and receives every editor's unpublished copy (M7).
2. **`join-dashboard` is still a public room.** `server/index.js:513-532` checks only that the
   requested room equals the handshake's site id; any socket admitted with the **public** site token
   joins `dashboard:{id}` and receives `content-updated` with the sanitized staged content
   (`:494-501`). Known since `docs/reviews/s07a-realtime-service-hardening.md:52-59` ("a plain
   viewer received UNPUBLISHED SECRET DRAFT"), still byte-identical. **No production client emits
   `join-dashboard`** — only `src/__tests__/websocket/server.integration.test.ts:619,777`.
3. **Revocation compares e-mail case-sensitively.** `server/auth.js:195-206` looks up `site_editors`
   with `.eq('email', access.email)`; `staging_access.email` is stored verbatim
   (`staging-access.ts:138`), `site_editors.email` is always `trim().toLowerCase()`
   (`src/lib/auth/editor-directory.ts:48-50`). `John@Example.com` stays connected after removal
   (proven in the s07a review, `:40-50`).
4. **New finding, same class: HTTP never consults `site_editors` for staging tokens at all.**
   `validateStagingAccess` (`staging-access.ts:176-310`) has no `site_editors` read, and
   `revokeSiteEditor` (`editor-directory.ts:271-299`) sweeps device grants only. A removed editor's
   verified staging token keeps saving staged copy over HTTP until the 12 h verification TTL, then
   re-verifies with a code sent to the mailbox they still own (`verifyEmail`, `:348-430`, no
   `site_editors` check) until the invite row itself expires. The realtime check is the only place
   "remove this editor" reaches a staging token — and it is the case-sensitive one.
5. **H1's authority rule has a realtime twin.** `resolveEditSessionGrant` (`server/auth.js:219-241`)
   returns the session row's permissions, like `validateEditSessionAccess` did before s68a. Realtime
   is broadcast-only (`server/index.js:456-469` tombstone), so the cost is disclosure of staged
   copy to a demoted or removed member, not a write. `server/` cannot import `src/`
   (`server/auth.js:1-12`); parity is enforced by `src/__tests__/websocket/auth-parity.test.ts`.

## Target story

`docs/stories.md` → `s68c-realtime-grant-parity`. The realtime service admits and keeps a socket
in a staging room only under the same rules as HTTP: device-bound staging verification within its
TTL, case-insensitive editor revocation, and edit-session authority from the live grant (ADR 047);
the dashboard room requires a live editor grant; and HTTP itself honours editor revocation for
staging tokens.

## Current state of the code

- **Handshake** — `server/index.js:209-325`: rate limit → site token (HMAC against the DB `api_key`)
  → mandatory origin pin → if `stagingMode` and a credential, `resolveGrant`; credentials (not the
  verdict) stored on `socket.data` (`:285-295`). Plain viewers join `site:{id}`.
- **Re-validation** — `revalidateSocket` (`:158-180`) re-resolves on every `content-update` and on a
  60 s sweep (`:182-208`); refusal = `auth-error` then disconnect.
- **Dashboard room** — fact 2. `content-map-updated` (`:384-388`) carries a count only.
- **Staging grant** — fact 1; the handshake has `socket.handshake.headers['user-agent']` available;
  `hashUserAgent` is an unkeyed SHA-256 (`src/lib/auth/editor-crypto.ts:109-111,180-182`), so the
  server can reproduce it without a secret.
- **Edit-session grant** — fact 5.
- **HTTP staging** — fact 4.

## Anchor points

- `server/auth.js` — `resolveStagingGrant(supabase, siteId, token, { userAgent })`: UA-hash +
  TTL check; lower-cased e-mail; `resolveEditSessionGrant`: live `site_permissions` read +
  intersection + 24 h lifetime; export the binding check and `hashUserAgent` for the parity suite.
- `server/index.js` — pass and keep the handshake User-Agent on `socket.data`; gate `join-dashboard`
  on a live grant.
- `src/lib/auth/staging-access.ts` `validateStagingAccess` — refuse a token whose e-mail has a
  revoked `site_editors` row for the site; same rule in `verifyEmail`/`resendVerificationCode`.
- Tests: `src/__tests__/websocket/{auth-parity,server.integration}.test.ts` (+ `harness.ts`),
  `src/lib/auth/__tests__/staging-access.device-binding.test.ts`, `e2e/realtime-parity.spec.ts`.

## Verified APIs / functions

- `checkStagingDeviceBinding(recorded, presented, now)` → `{ ok } | { ok: false, reason:
  "unbound" | "device_mismatch" | "stale" }`; `STAGING_VERIFICATION_TTL_MS = 12 h`
  (`staging-device.ts:73,137-160`).
- `hashUserAgent(ua) = sha256("ua\0" + (ua ?? "")).slice(0, 32)` (`editor-crypto.ts:180-182`).
- `normalizeEmail(e) = e.trim().toLowerCase()` (`editor-directory.ts:48-50`).
- `normalizePermissions` exists on both sides and is already in the parity table.
- Columns read: `staging_access.verified_user_agent_hash`, `verified_at` (service role reads them;
  `authenticated` was stripped of them in `20260925120000:140-158` — irrelevant to the service).

## Traps & constraints

- **`server/` is its own package and Docker context** — no `require('../src/…')`
  (`server/auth.js:1-12`, `docs/operations/fly-deploy.md`). Duplicate, then pin with
  `auth-parity.test.ts`.
- **Tests that use `join-dashboard` as a listener** — `server.integration.test.ts:602-640`
  (rate-limit relay) and the `connectDashboard` helper (`:764-781`) used by the broadcast suite;
  they must connect with an editor credential once the room is gated. Declared test change.
- **The UA a WebSocket handshake sends** is the browser's normal `User-Agent`, the same string the
  HTTP verification hashed — so the honest editor is unaffected. A non-browser client can forge it;
  the same honest limitation is written in `staging-device.ts:40-50`.
- **The sweep** must re-check the TTL, not only the handshake, or a socket opened at hour 11 lives
  forever. It already re-resolves; it just needs the stored User-Agent.
- **"Absent is not revoked"** (`server/auth.js:204-206`) stays: a staging invite can exist without a
  directory row. Only a present, stamped row refuses.
- **s68a dependency**: the edit-session parity rule is ADR 047's; s68a also fixes the e2e seeds this
  story's `e2e/realtime-parity.spec.ts` run relies on. Branch from `main` after s68a merges.
- **Deploy**: two targets. `server/` ships with `cd server && fly deploy` (operator,
  `docs/operations/fly-deploy.md`); the HTTP change ships with the Vercel merge. Either order is
  safe — each half only refuses more.
- Embed allocation 0: no change to `public/embed/` (s67 is rewriting startup).

## Open questions

1. Retire the dashboard room instead of gating it? No client exists. Planner chose gating: it closes
   the leak with the smallest diff, keeps the tests' ordering barrier, and keeps a future dashboard
   client possible. Removing it is a one-line follow-up if nobody builds one.
2. Should `revokeSiteEditor` also deactivate the editor's `staging_access` rows (sweep), like it
   sweeps device grants? With fact 4's read-time check it is not load-bearing; recorded as a
   follow-up for dashboard truthfulness.

## Real complexity

New story, 3: one duplicated rule set plus parity rows, two handler changes, one HTTP predicate,
one Fly deploy. The integration suite is large (1,274 lines) but has the fixtures needed.

## Split proposal

None.
