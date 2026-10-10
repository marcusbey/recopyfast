# Research — Story s39-editor-back-to-sites

Date: 2026-09-25. Base: `0b8014f`. Scope prevalidated by operator (hands-on test, decisions
taken in session: hub session 7 days when "Remember" is ticked, "Remember" unticked by default).
`docs/reviews/stories.md` still ends `Stories ready: no` (the 2026-08 backlog review); s33–s37
proceeded under the same operator-prevalidation, and this story does the same.

## The five structuring facts

1. **The return trip was designed and never wired.** The hub cookie is `SameSite=Lax` "so it
   survives the top-level navigation back from a customer site" (`src/lib/auth/editor-hub-session.ts:62-66`),
   and `GET /api/editor/sites` lists sites from that cookie (`src/app/api/editor/sites/route.ts:14`) —
   but nothing calls it. `EditorSignIn` always starts at `step = "email"` (`src/app/edit/EditorSignIn.tsx:37`).
2. **The hub session is 30 minutes, fixed, and ignores "Remember".** `HUB_SESSION_TTL_MS = 30 min`
   (`editor-hub-session.ts:24`) drives both the signed payload expiry and the cookie `maxAge`. The hub
   client does not send `rememberDevice` to `submit-code` (`EditorSignIn.tsx:112`); the route reads it
   (`submit-code/route.ts:60`) but only uses it on the unlock-in-place path (`:157`).
3. **"Remember" reaches the site only through the handoff body.** `handoff/create` takes
   `rememberDevice` from the request body (`handoff/create/route.ts:40`). If the hub resumes a session
   and skips the code step, the checkbox is never shown and the state defaults to the new default
   (unticked) → every resumed hand-off mints a 12-hour grant instead of 7 days. The remembered flag has
   to live in the hub session itself.
4. **The embed has 5 gz bytes of widget headroom.** `build:embed` today: bundle 46,635 / 46,681,
   widget 33,860 / 33,865 (`scripts/build-embed.mjs:110-111`). The gate's own rule: "If your branch is
   over, the branch is over" (`:106-107`). Any banner control must be paid for in this branch.
5. **The payment is available and behaviour-free.** 12 CSS comments ship inside widget template
   strings (e.g. `/* Truncating is a layout decision… */` in the banner CSS, `/* Inline edit toolbar … */`
   ~`recopyfast.src.js:3863`). Stripping them from the shipped strings measured **−446 gz** on the bundle
   (46,635 → 46,189). Keep the explanations as JS comments outside the template literal.

## Target story

`docs/stories.md` § s39. An invited editor done with one site gets back to the list of every site they
may edit without re-entering a code. Criteria: "All sites" control in the in-page editor bar (grant
editors only); `/edit` resumes a live hub session; hub session 7 days when Remember ticked, 30 min
otherwise; Remember unticked by default; "Use a different address" clears the hub cookie server-side;
embed allocation itemised; tests; draft PR.

## Current state of the code

- `src/app/edit/page.tsx` — server page rendering `<EditorSignIn />`, `robots: noindex`.
- `src/app/edit/EditorSignIn.tsx` (client, 390 lines) — state machine `email → code → sites`; `useState(true)`
  for `rememberDevice` (`:40`); `openSite` posts `{ siteId, rememberDevice }` to `handoff/create` then
  `window.location.href = redirectUrl`. "Use a different address" only resets client state (`:283-290`).
- `src/lib/auth/editor-hub-session.ts` — stateless signed token `rcfh1`, payload `{ e, x }`;
  `getHubSessionEmail()` returns email or null; `hubSessionCookieOptions()` takes no argument.
- `src/app/api/editor/submit-code/route.ts` — hub mode (`siteId` absent) lists sites, sets cookie.
- `src/app/api/editor/sites/route.ts` — GET, 401 `not_signed_in` without session, else `{ ok, email, sites }`.
  No rate limiter (it reads only the caller's own allowlist rows via `listSitesForEditor`).
- `src/app/api/editor/handoff/create/route.ts` — hub-cookie auth, re-checks `findActiveSiteEditor`,
  `createHandoff({ siteEditorId, rememberDevice })`, returns `redirectUrl` to `https://<domain>?rcf_handoff=`.
- Embed `showEditorBanner()` (`recopyfast.src.js:1271`) — shown only when `this.editorAuth` is set,
  i.e. only for device-grant editors (`applyEditorIdentity`, `:1093`). Owners and edit-session holders
  never get this bar, so "grant editors only" is structural, not a new check. Children today: mark,
  claim, divider, email, status, Publish (publish/admin only), Done (hides the bar, restores padding).
- Terminal state already opens `new URL('/edit', RECOPYFAST_API)` for grant holders (`:1191`).

## Anchor points

- Banner: insert the control before Publish/Done in `showEditorBanner()`; reuse class
  `rcf-editor-banner-dismiss` (button styling already hardened against host CSS). A `<button>` with
  `onclick → location.href = RECOPYFAST_API + '/edit'` inherits that styling; an `<a>` would need
  `text-decoration` hardening (more bytes).
- Hub mount: `useEffect` in `EditorSignIn` → `GET /api/editor/sites`; new initial step `"checking"`.
- Hub session: payload gains `r` (remembered); a reader returning `{ email, remembered }`;
  `hubSessionCookieOptions(remembered)`; TTL 7 d reuses `REMEMBERED_GRANT_TTL_MS`
  (`src/lib/auth/editor-grants.ts:39`) so the two "remember" promises cannot drift.
- Sign-out: new `POST /api/editor/sign-out` (same-origin, no CORS) that expires `rcf_editor_hub`.

## Verified APIs / functions

- `createHubSessionToken(email: string): string` — `editor-hub-session.ts:33`.
- `readHubSessionToken(token): string | null`, `getHubSessionEmail(): Promise<string | null>` — `:40`, `:56`.
- `HUB_SESSION_COOKIE = "rcf_editor_hub"` — `:20`; used only by `submit-code/route.ts:105`.
- `listSitesForEditor(email)` → `{ siteId, siteName, siteDomain, permissions }[]` — `editor-directory.ts`.
- `createHandoff({ siteEditorId, rememberDevice })` — `editor-handoff.ts`.
- `REMEMBERED_GRANT_TTL_MS = 7d`, `SESSION_GRANT_TTL_MS = 12h` — `editor-grants.ts:39,47`.
- Embed unsaved-edit guard: `beforeunload` registered per open element editor while dirty
  (`recopyfast.src.js:4545`). Committed edits are saved to staging on blur, so leaving via "All sites"
  after editing loses nothing; an open dirty editor triggers the browser prompt.

## Traps & constraints

- **Zero tests cover the hub.** No test file references `EditorSignIn`, `editor-hub-session`,
  `/api/editor/sites`, `submit-code` hub mode or `handoff/create` (grep of `src/**/__tests__`).
  `e2e/share-edit-publish.spec.ts:165-207` drives `submit-code` and `handoff/create` by API, never the UI.
- **Playwright count is contractually 44** (`src/__tests__/e2e/playwright-ci-contract.test.ts:33-45`).
  Adding a spec breaks the contract; cover with Jest + jsdom and prove the journey live instead.
  The story's Playwright criterion is amended accordingly.
- **Old tokens:** existing `rcfh1` cookies (≤30 min) have no `r`; treat missing as not remembered.
- **Byte gate:** after the CSS-comment strip, ratchet `MAX_BUNDLE_GZ`/`MAX_WIDGET_GZ` down to the new
  measurement and itemise both deltas in the commit (convention from the 2026-08-17 ratchet).
- **Embed non-negotiable #4:** the new onclick must not throw into the host page.
- **Concurrent PR #35 (s38)** appends to `docs/stories.md` too — trivial append conflict, no code overlap
  (it touches api-keys/webhooks/migration only).
- Hub `submit-code` responses carry `withPublicCors` (`*`, no credentials); the hub calls it same-origin, so
  the cookie is set normally. Do not add credentials CORS.
- Logout CSRF: a cross-site POST to sign-out could clear the cookie (nuisance only, no data). Reject when
  `Origin` is present and not the app origin.

## Open questions

- Should "All sites" also appear in the in-page code modal path (grant minted in place, never via hub)?
  It lands on `/edit`, which will ask for a code — acceptable; no hub session exists for them.
- Live verification needs a real code from the founder's mailbox (Gmail connector available).

## Real complexity

Scored 3 in `docs/stories.md`. Verdict **3**: four small server changes (session payload, submit-code,
handoff, sign-out route), one client state machine change, one banner control, one mechanical byte-freeing
pass. No migration, no new dependency. The byte gate is the only real risk and it is already paid for.

## Split proposal

Not required.
