# Review — Story s14a-grant-authorized-editing

> Fresh-context review by the `reviewer` subagent.
> Diff reviewed: `git diff main...feature/s14a-grant-authorized-editing`.
> Reviewed as security work: a leaked or over-scoped grant is a defacement of a customer's live
> site, performed with our credentials.

## Tests
- [x] Run by the reviewer. `jest --ci`: **147 passed / 1 skipped of 148 suites; 2012 passed / 36
      skipped of 2048 tests, exit 0.** `tsc --noEmit` 0 errors · `eslint src/` 0 errors (44
      pre-existing warnings, none in touched files) · prettier clean · `npm run build` exit 0 ·
      `node scripts/build-embed.mjs --check` up to date.
- [x] Pre-existing flake confirmed **on `main`**, not this branch:
      `src/__tests__/api/health/route.test.ts` fails once under a loaded full-suite run, passes
      in isolation.
- [x] **Bite proven by neutralization**, each applied alone then reverted: chokepoint
      `deviceContext` dropped → **8 red** · origin pin removed → 2 · `editor.revoked_at` removed
      → 2 · grant accepted from URL + body → 2 · `ALLOW_HEADERS` reverted → 1 · grant back in the
      widget URL → 4 · `editMode` not derived from grant → 4. Restored, `git diff --exit-code`
      clean.
      **The load-bearing result:** dropping `deviceContext` at the chokepoint left the *helper*
      suite green and turned the *route* suite red — the plan's claim that a route test is what
      proves nobody forgot to call it is empirically true here.

## The ten security questions
1. **Header only.** `extractEditorToken` reads `X-RCF-Editor-Grant` first, ahead of `rcf_token` /
   `rcf_edit_token` / `Bearer`. Query string and body ignored. The critical case did not occur.
2. **The origin pin fails closed** — refusal happens *before any DB read* in
   `validateDeviceGrantAccess` (`src/lib/auth/editor-access.ts:301`), with context derived once
   at the chokepoint. `normalizeOrigin` was run against absent / `""` / `"null"` / garbage /
   `file:` / `data:` / `javascript:` — every one returns null and every one refuses. An
   unregistered but well-formed origin fails the hash pin.
3. **Revocation (M5)** — the test exists, and its second case (parent row revoked, grant sweep
   suppressed) is the one that bites: removing `editor.revoked_at` turned it red.
4. **The WebSocket half is absent** — no `server/` file in the diff. It belongs to `s07a`.
5. **Grant codes** — 32-byte CSPRNG, hash-only storage, 60s TTL, wrong ≡ unknown, site re-pinned,
   two racers → exactly one grant insert.
6. **Enumeration** — the `hide` branch is preserved; `resolveStored` calls `clearStored()` before
   returning `hidden`, so the new lapsed-link modal is unreachable from the revoked path with a
   stored grant, and a revoked editor *without* one sees identical spent-link copy.
   `request-code` now asserts a byte-identical body **and headers**.
7. **`728b646`** is newly guarded by a test; **`aca2eb2`** remains covered by the pre-existing
   `share-owner-lockout.test.ts`, green.
8. **Grants, not roles.** No `/api/teams/*`, no role, zero route files changed.
9. **Artifact** — `--check` clean; the removed sentence is gone from source *and* artifact.
10. **Design** — the banner matches spec; widget colours are token-derived `hsl()` literals with
    naming comments; no app component touched.

## Findings (all minor)
1. `public/embed/recopyfast.src.js:876-881` — the comment at the `initEditorAuth()` call site
   still states the old rule as fact (*"deliberately does not touch `editMode` … a grant on its
   own cannot grant one"*). `applyEditorIdentity:1084-1090` now does exactly that. The tombstone
   rewrite covered `:1010-1023` and missed this one.
2. `recopyfast.src.js:1120-1140` + `:882` — a held grant silently supersedes a valid staging /
   edit-session token on the same page load. If the grant is narrower, `initStagingMode` has
   already set `editMode = true` and nothing turns it off → an affordance on the page and every
   save 403. Narrow, not a security hole (the server refuses correctly), and a *dead* grant
   cannot poison the path (`clearStored()` runs first). Two fixed top-0 banners in that case too.
3. `docs/designs/s14a-…md:107-111` specifies three modal copy variants; two shipped. An
   expired-grant editor gets the first-time copy, not "Sign in again to keep editing".
   Plan-vs-design drift, not plan non-compliance.
4. `jest.config.js` untouched. Measured: `main` 40.65% lines → branch 41.53%; branches 33.55 →
   34.34. The plan and AGENTS.md both say raise the ratchet by what the story earns; ~+0.9pp not
   banked.
5. ADR 002 **rule 4** (fail-closed per-site limiter on service-role routes) unmet on the two
   routes this story opens to a third credential. Pre-existing; the grant branch is cheap for a
   forged token (HMAC offline, refused before any DB read), and the dominant unmetered cost
   remains the pre-existing `auth.getUser()`.
6. The stated byte delta is not reproducible: claimed "+758 (46,986 → 47,744)". Measured gzip -6
   **+744** (46,998 → 47,742); gzip -9 +726; node default +747. Direction and honesty right,
   exact figures wrong — quote the measured ones in the PR.

Benign drift worth knowing: the plan forecast *extending* `content-put-permissions.test.ts` and
`embed/editor-auth.test.ts`; instead four new files were added and no existing test was
modified — safer under AGENTS.md, and more coverage.

## Not verified
No browser — all widget tests are jsdom over the real source via `new Function`, **so the CORS
preflight fix is proven only server-side, which is precisely the failure mode the code comments
say passes every server-side test while failing silently on customer domains.** No real
cross-origin request, no real customer domain (so mint-time `originBelongsToSite` never ran end
to end), no second device or browser, no real email round trip, no database (every Supabase call
is a hand-written stand-in, so RLS is untested by construction). The origin pin remains
browser-enforced, not cryptographic — a forged `Origin` from outside a browser still passes it;
pre-existing and documented, but not closed here.

**Human gestures:** open a real customer page with a live grant on desktop and phone; confirm the
save's preflight and header in the Network tab from a genuinely different origin; and complete
the plan's own open DoD item — an invited editor who never had an account, emailed a code,
changes a paragraph, and it persists. The implementer marked that NOT DONE honestly and called
it a ship blocker; the reviewer agrees it gates the **ship**, not the review.

## Verdict
Max severity: minor
Ship allowed: yes
