# Authentication Integration Tests

Integration coverage for the app's authentication journey. RecopyFast is
**passwordless** — a magic link (Supabase `signInWithOtp`) is the only way in.
There is no password login, no signup password, and no password reset.

## Where the coverage lives

| Area                                     | Location                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Session lifecycle through `AuthProvider` | `session-management.test.tsx` (this directory)                            |
| `AuthContext` behaviour in isolation     | `src/contexts/__tests__/AuthContext.test.tsx`                             |
| Magic-link request forms                 | `src/components/auth/__tests__/LoginForm.test.tsx`, `SignupForm.test.tsx` |
| Auth modal / tab switching               | `src/components/auth/__tests__/AuthModal.test.tsx`                        |
| Signed-in header menu                    | `src/components/auth/__tests__/UserMenu.test.tsx`                         |
| Session + logout API routes              | `src/__tests__/api/auth/`                                                 |
| Full browser journey                     | `e2e/` (Playwright)                                                       |

## `session-management.test.tsx`

Exercises the session half of `AuthContext`, which the component tests mock out:

- Restoring an existing session on mount
- Reacting to `onAuthStateChange` (sign-in, sign-out, token refresh)
- `refreshSession` success and failure
- `signOut` clearing user state
- Surfacing `getSession` failures without crashing the provider

Supabase's client is mocked at `@/lib/supabase/client`, so these tests assert on
what the provider does with the SDK's responses, not on the SDK itself.

## Conventions

- Query by accessible role/label; `getByTestId` only as a last resort.
- `await` every `userEvent` call, and use `findBy*` / `waitFor` for async state.
- Never assert on a message that would reveal whether an email is registered —
  a magic-link request must look identical for known and unknown addresses.

## Notes on removed suites

The password-era suites (`login-flow`, `registration-flow`, `logout-flow`,
`protected-routes`, `auth-error-handling`, `simple-auth`) and the `auth-setup.ts`
MSW scaffolding were removed when password auth was deleted. They asserted on
`signInWithPassword`, `signUp` with a password, password-strength rules, and
"remember me" — none of which exist any more. Protected-route redirects are now
enforced by `src/middleware.ts` and covered end-to-end in `e2e/`.
