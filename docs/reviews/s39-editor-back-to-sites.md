# Review — s39-editor-back-to-sites

Reviewer: independent anti-hallucination pass, fresh context, 2026-09-25.
Diff judged: `git diff origin/main...HEAD` (implementation `03f4d58`; `0cf43f4` is a clean merge of main, which touched no embed file).

## Commands run (CI placeholder env sourced)

| Command | Result |
|---|---|
| `npm run type-check` | exit 0 |
| `npm run lint` | exit 0 — 0 errors, 38 warnings, none in touched files |
| targeted jest, the 9 changed/added suites | 9 suites, 78/78 passed |
| `npm run build:embed -- --check` | `embed artifact is up to date`; bundle 46226 (max 46226), widget 33465 (max 33465) |
| `zlib.gzipSync` level 9 of the artifact, main vs branch | 46635 → 46226. The baseline claim holds |

Not run, as instructed: the full suite, `npm run build`, `format:check`.

## Verified against the code

- **Imports and APIs exist:**
  - `REMEMBERED_GRANT_TTL_MS` (`editor-grants.ts:39`)
  - `normalizeOrigin` (`editor-crypto.ts`): `"null"` returns null, so the request gets 403
  - `encodeSignedToken` / `decodeSignedToken`
  - `RECOPYFAST_API` (`recopyfast.src.js:48`)
  - `listSitesForEditor`, `findActiveSiteEditor`
- **Hub session:**
  - `r` sits inside the HMAC-signed payload. A forged `r` is rejected.
  - A legacy token without `r` reads as not remembered.
  - Expiry is enforced by both the signed `x` and the cookie `maxAge`.
  - The clearing cookie reuses `httpOnly`, `sameSite: "lax"`, `path: "/"` and prod `secure`, with `maxAge: 0`.
  - Sign-out has no CORS header and no `OPTIONS` export.
  - Both hub uses re-read `site_editors`: `revoked_at IS NULL` in the list, `findActiveSiteEditor` in the handoff.
- **CSS move changes no rule:**
  - Checked independently. Every template literal was compared before and after with comments stripped and lines trimmed: 105/105 literals in the source and 9/9 in the artifact are identical, and only 3 differ raw.
  - The only `/*` left in a source literal is the string `/api/editor/*`.
- **Ratchet only went down:** 46681/33865 → 46226/33465, with an itemised note in `scripts/build-embed.mjs:110` and the matching pin in `build-size-gate.test.ts`.
- **The three edited Done lookups are not weaker.** They now select by `aria-label`. A missing Done returns null, and `.click()` then throws, so the test still fails.

## Mutations (each one restored; `git diff --exit-code` clean at the end)

| Neutralized | Red |
|---|---|
| handoff ignores `session.remembered` | 2 |
| sign-out accepts `Origin: null` | 1 |
| sign-out origin check → `false` | 3 |
| hub expiry check deleted | 2 |
| `remembered` forced `true` | 6 |
| submit-code drops the flag | 1 |
| Remember default `true` | 3 |
| initial step `"email"` (form flash) | 1 |
| 500 → empty list | 1 |
| sign-out fetch skipped | 3 |
| body omits `rememberDevice` | 2 |
| All sites → `/dashboard` | 1 |
| try/catch removed | 1 |
| control not appended | 5 |

## Findings

**M1 (major) — a failed DB read still shows an empty list on `/edit`.**
- On a Supabase error, `listSitesForEditor` logs and returns `[]` (`src/lib/auth/editor-directory.ts:107-110`).
- `GET /api/editor/sites` then answers 200 with `sites: []`. The resumed hub renders "No sites yet … isn't set up to edit anything" (`EditorSignIn.tsx:442`).
- The test `sites/route.test.ts:134` passes only because it mocks a rejection, and the real function never rejects on a query error.
- This contradicts the ticked story criterion and ADR 005 ("never an empty list"). It is pre-existing in submit-code, but s39 now puts it on every `/edit` load.

**m1 —** `readHubSessionToken` / `getHubSessionEmail` (`editor-hub-session.ts:107,120`) are now unused in production. The plan said "callers unchanged", but the callers did change.

**m2 —** The resume read is an inline `useEffect` (`EditorSignIn.tsx:83`), not the `{data, loading, error, refetch}` shape from ADR 005.

**m3 —** The criterion "unsaved-changes guard still fires" is ticked (`docs/stories.md:1512`) but no test covers it.

**m4 —** The PR must declare the three edits to existing tests (AGENTS.md, Tests).

## Could not verify

- **`request.nextUrl.origin` against the real browser `Origin` on Vercel.** The tests mock `NextRequest`. On production, press "Use a different address", reload `/edit`, and check you land on the email step. In DevTools, confirm the clearing `Set-Cookie` carries `Max-Age=0; Secure; HttpOnly; SameSite=Lax`.
- **The real cookie lifetimes.** With Remember ticked, the cookie should expire in about 7 days; unticked, in 30 minutes.
- **Real navigation.** jsdom only covers it through a fragment trick. Walk the live journey: site → All sites → list → second site.
- **The editor bar at 360px.** It is a no-wrap flex bar where every button is `flex: none`, and it now holds three buttons.
- **All sites clicked while an element is dirty or mid-save.** Check whether the prompt appears and whether the draft survives.
- **`/edit` in a real browser.** It has only been rendered in jsdom.

Max severity: major
Ship allowed: yes
