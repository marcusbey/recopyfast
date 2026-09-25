# Review — s31-magic-link-landing

Reviewed commit: `6629ae65cef6b2afc6cd2968882261acf7aed670` (draft PR #26)  
Baseline: `main` at `a9e3f21`  
Date: 24 September 2026

## Scope and verdict

This was a fresh-context review of `git diff main...feature/s31-magic-link-landing`: 2 route files, 2 test files
and story/research/plan docs. The fix does what the incident needs, and nothing found here blocks it.
`/auth/confirm` no longer forwards a confirmed session into a code-less `/auth/callback`. The
callback now takes a server-verified existing session instead of falling through to
`/auth/error`. No open redirect was introduced. The trial behaviour is unchanged, and no test was
weakened. Three minor findings remain.

## Verified behaviour (file:line)

- **Confirm unwrap is bounded and runs after the origin check.** The same-origin check sits at
  `src/app/auth/confirm/route.ts:74`. The `/auth/` unwrap follows at `:83-85` and exits through
  `sanitizeNext(target.searchParams.get("next"))`. It unwraps exactly one level, with no recursion
  or loop. Non-auth paths still go through `:87`. Direct `next` still takes precedence (`:66-67`).
  `sanitizeNext` (`src/app/auth/sanitize-next.ts:12-19`) and `resolvePublicOrigin`
  (`src/app/auth/public-origin.ts:70-111`) are unchanged.
- **Open redirect: no escape found.** Every redirect is built as `${origin}${next}`
  (`confirm/route.ts:134`, `callback/route.ts:54,75`). `origin` comes from the unchanged
  `resolvePublicOrigin`, so the host is fixed on the first hop. The unwrap only admits values that
  a direct `next` already admitted. The probe below ran the real routes in an isolated copy with
  only the Supabase client mocked:
  - Nested `https://evil`, `//evil`, `/\evil`, `https:evil` and double-encoded `%252F%252F` all
    land on `/dashboard`.
  - Cross-origin `redirect_to` values are refused before any unwrap. This covers `evil`,
    `www.recopyfa.st@evil.com`, `evil.com\@www…`, `//evil`, `/\evil` and apex vs www.
  - `https:evil.com` and `https:/evil.com/...` parse as same-origin paths.
  - `/auth/callback?next=/auth/callback?next=https://evil.com` unwraps to
    `/auth/callback?next=https://evil.com`, which the callback then sanitizes to `/dashboard`.
  - Chains terminate. Each callback hop's target is a strict substring of its own query, and
    `/auth/confirm` without `token_hash` ends at `/auth/error` (`confirm/route.ts:102-104`).
  - `/\t/evil.com` and `/%2F%2Fevil.com` pass the unchanged sanitizer. They stay on
    `www.recopyfa.st`, and Next normalizes `//` paths with a relative 308
    (`next/dist/server/base-server.js:579-581`, `shared/lib/utils.js:130-136`). This is
    pre-existing and not introduced here.
- **The callback uses `getUser()`, not `getSession()`.** See `callback/route.ts:69-76`. The installed
  `@supabase/auth-js` 2.71.1 makes `getUser()` perform `GET /user` against the Auth server
  (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:1060-1110`). The route accepts only
  `user && !error`. A throw is caught (`:77-82`) and lands on `/auth/error` (`:85`). Installed
  versions match the research: supabase-js 2.55.0, ssr 0.6.1.
- **Explicit `error` takes precedence.** `searchParams.has("error")` (`callback/route.ts:10`)
  returns before `createClient`, the exchange and `getUser` (`:23-25`). That includes an empty
  `error=` and `error` alongside a `code`.
- **Real error cases still land on `/auth/error`:**
  - failed exchange, with an explicit return now (`callback/route.ts:59-60`)
  - no code and no session (`:85`)
  - `getUser` returns an error (`:74`)
  - `getUser` throws (`:77-85`)
  - failed `verifyOtp` (`confirm/route.ts:112-115`, unchanged)
  - missing token or type (`:102-104`, unchanged)
- **`ensureTrialStarted` is unchanged:**
  - The confirm route's trial block (`confirm/route.ts:117-132`) is outside the diff.
  - The callback code path (`callback/route.ts:43-52`) is textually identical apart from sharing
    the client created at `:27`.
  - The no-code fallback does not call it.
  - `confirm.test.ts` is unchanged and green.
- **Tests were not weakened:**
  - No test was deleted. The only removed line is the `confirm()` helper body, refactored into
    `confirmFromOrigin`.
  - The diff adds no `skip`/`only`/`failing`/`todo` markers.
  - `callback.test.ts:119-128` now makes its no-session premise explicit and keeps its
    `/auth/error` assertion. The PR "Decisions" section discloses this, as AGENTS.md requires.
  - `callback.test.ts:115` adds an assertion (`getUser` not called after a failed exchange).
- **Plan versus diff:** all 5 plan tasks are present, with no drift in either direction.
  - The explicit `return` after a failed exchange, the hoisted `createClient`, and the
    `public-origin` mock in `callback.test.ts:33-35` all directly support tasks 1-3.
  - The `docs/stories.md` entry on the feature branch follows the precedent of #17-#21.
- **ADRs:** there is no contradiction. The ADR 018 §4 canonical-origin rationale is preserved
  because `public-origin.ts` is untouched.

## Findings

1. **minor — error precedence keys only on `error`.** `callback/route.ts:10` checks
   `searchParams.has("error")`. Supabase's own client treats `error || error_description ||
   error_code` as an error redirect (`GoTrueClient.js:1275`) and defaults a missing `error` to
   `unspecified_error`.
   - Probe: a signed-in browser that opens `/auth/callback?error_code=otp_expired&error_description=x`
     now lands on `/dashboard`; before this change it landed on `/auth/error`.
   - There is no privilege gain, because the session is verified and the destination sanitized.
     A failed link opened in an already-signed-in browser silently continues the existing session
     instead of showing the error.
   - Next cycle: also test `error_code` / `error_description`, with a test.
2. **minor — the "apex" confirm test is vacuous on its premise.**
   `confirm-destination.test.ts:111-117` ("accepts the canonical www callback when the request
   arrived through the apex") builds the request on the apex. But `resolvePublicOrigin` is mocked
   to return www unconditionally (`:27-29`), and the route reads the request origin only through
   that function (`confirm/route.ts:94-97`). The test would pass unchanged for a request from any
   host. Apex/www behaviour really rests on the production `NEXT_PUBLIC_APP_URL` plus the separately
   tested `public-origin.ts`. Rename the test, or run it with the real resolver and
   `NEXT_PUBLIC_APP_URL=https://www.recopyfa.st`.
3. **minor — the route header comment is stale.** `confirm/route.ts:17-23` still says the template
   must pass `&next=` and that "the default templates keep using `/auth/callback`". That contradicts
   the incident this story fixes, recorded by the new comment at `:76-82`: the live template sends
   `redirect_to` pointing at `/auth/callback`. The text is pre-existing, but it is the
   misunderstanding behind the bug, and the house rule treats comments as the tombstone.

Notes, not findings:

- Direct `next=/auth/callback` is not unwrapped. It costs one extra hop and still lands correctly
  through the callback fallback. The plan preserved direct-next precedence deliberately.
- If the template does not percent-encode `{{ .RedirectTo }}`, a nested `next` carrying an encoded
  `&` loses its trailing query. Probe: `/dashboard/sites?tab=a&b=c` became `/dashboard/sites?tab=a`.
  No current producer emits a query-bearing `next`: `middleware.ts:136` sets a pathname, and
  `AuthContext.tsx:35-41` drops absolute values.

## Independent verification

All commands ran with `env -i` plus exactly the `ci` job placeholders from
`.github/workflows/ci.yml`. The worktree holds only `.env.example`. No production credential was
used.

- Auth suites (`src/__tests__/app/auth`, `src/__tests__/api/auth`): **6 suites, 107 tests passed**.
- The focused auth suites plus billing trial and entitlements: **6 suites, 101 passed**.
- Full `npm test -- --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`: **211 suites passed,
  1 skipped; 2,756 tests passed, 36 skipped, 0 failed**. That is exactly `main` (2,733, per the
  s24 review) plus the 23 new cases, with the skip count unchanged. I ran it twice with the same
  result.
- ESLint and Prettier on the 4 changed source/test files: clean.
- `gh pr checks 26`: every check passed on head `6629ae6`:
  - Lint, Test & Build (run 35962923769)
  - TypeScript Type-Check incl. tests
  - E2E (Playwright)
  - Realtime server production audit
  - Vercel preview
  - CodeRabbit, which skipped because the PR is a draft

  I did not run `build`, `type-check:build`, `audit:prod` or the embed check locally; I rely on
  that CI run for them.

## Mutation proof

All mutations ran in an isolated `git archive` copy of HEAD, never in the author worktree. Each
was restored with `git checkout` and proven clean with `git diff --exit-code`. The author worktree
was verified clean afterwards. Red counts are for the 107-test auth scope.

| Neutralized | Red |
| --- | --- |
| Removed the `/auth/` unwrap in confirm | 8 |
| Unwrap bypasses `sanitizeNext` | 3 (all nested-unsafe cases) |
| Unwrap moved before the same-origin check | 2 (apex refusal, cross-origin auth-internal) |
| Removed the explicit `error` early return | 3 |
| `user && !error` becomes `user` | 1 |
| `user && !error` becomes `true` | 2 |
| Failed exchange falls through to the session lookup | 1 |
| No-code branch uses raw `next` | 3 |
| Trial started in the no-code branch | 2 |
| Lookup `catch` rethrows | 1 |
| Both routes reverted to `main` (regression proof) | 15 |

Every guard the story turns on has at least one test that bites. The main-revert run shows the
reported incident is pinned: "unwraps the callback destination sent by the magic-link template"
goes red.

## Evidence boundary — not verified

- **The live flow in a real browser.** Not run: every test mocks Supabase, and Playwright has no
  auth-link coverage. After deploy, request a link from `/login?redirectedFrom=/dashboard/sites`.
  Open it on the same device and on a second device, with DevTools "Preserve log" on. Confirm the
  chain is apex 308 → www `/auth/confirm` 307 → `/dashboard/sites`, with no `/auth/callback` or
  `/auth/error` hop.
- **The Supabase email template text and how it renders `{{ .RedirectTo }}` with a `next`.** This
  is not in the repo. Check the template in the dashboard and the `href` of one delivered email.
- **The production `NEXT_PUBLIC_APP_URL`.** The docs disagree: `deployment-env.md:14` says www,
  `deployment-checklist.md:15` says apex. The incident chain implies www. If it were apex, the fix
  would still avoid `/auth/error` but would drop `next`. Check the Vercel env.
- **The exact GoTrue error-redirect parameter shapes.** Only the auth-js client code was read.
- **Whether `getUser()` really hits the Auth server.** In this review it was only mocked; the claim
  rests on reading the library.
- **Session-cookie propagation on the redirect.** This is pre-existing and was not re-tested.

Max severity: minor
Ship allowed: yes
