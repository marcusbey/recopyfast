# s31 — Magic-link landing research

2026-09-24. Base `a9e3f21`; scope verified against current code, complexity **1**.

## Verified premise

- `src/contexts/AuthContext.tsx` builds `emailRedirectTo` as `/auth/callback` with
  optional `next`. The operator observed the email template forwarding this absolute
  URL as `redirect_to` to `/auth/confirm` after apex-to-www canonicalization.
- `src/app/auth/confirm/route.ts:resolveDestination` checks canonical same-origin then
  returns the callback path itself. OTP verification succeeds before this redirect.
- `src/app/auth/callback/route.ts:GET` requires a code even if a session exists, so that
  redirect ends at `/auth/error`. It currently has no explicit error-query precedence.
- `src/app/auth/sanitize-next.ts` is the shared relative-path guard and default source.
  `public-origin.ts` owns canonical origins; apex and www are not silently interchangeable.
- `ensureTrialStarted` runs after OTP verification or successful code exchange, catches
  failures and preserves login. A no-code fallback must not add another trial invocation.

## Tests and traps

Existing route coverage: `src/__tests__/app/auth/{confirm,callback}.test.ts`,
`src/__tests__/api/auth/{confirm-destination,public-origin}.test.ts`.
There are no failing markers in these auth suites. Add ordinary failing regression tests.
The callback's existing no-code test defaults to an authenticated mock; make its missing-
session premise explicit and retain its error assertion, documenting this fixture correction.
Keep every existing guard. Test nested `next` through the same sanitizer, including absolute,
protocol-relative and slash-backslash attempts. Reject cross-origin before unwrapping.

## Context and boundaries

Read AGENTS.md, CLAUDE.md, architecture and the audit closeout O5 email-template row.
O5 is historical; the user's newer live evidence establishes the current template behavior.
No template, Supabase configuration, database, dependency or origin-policy changes.
No design phase needed: this changes server redirects, not UI.
Supabase's [getUser reference](https://supabase.com/docs/reference/javascript/auth-getuser)
confirms the existing API returns the authenticated user; this hotfix reuses installed
`@supabase/supabase-js` 2.55.0 and `@supabase/ssr` 0.6.1. The current changelog was
checked; no relevant API change is needed for this fix.

## Open questions

None for the approved fix. Production/browser validation belongs to the later ship lane;
this lane uses only mocked route tests and the exact CI placeholder environment.
