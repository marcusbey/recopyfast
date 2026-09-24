# s32 — Research

## Verified context

- Branch `feature/s32-try-on-any-site`, clean at start at `d8696a1` (PR22, development dependencies only), with requested `a9e3f21` ancestor; root and server setup passed.
- `src/app/demo/page.tsx` composes Header, Footer and InteractiveHero without
  production embed credentials. Marketing uses pinned light slate/sky styling.
- `src/components/layout/Header.tsx` owns both desktop and mobile navigation.
- `src/app/sitemap.ts` has an explicit static route list.
- A-24 is already fixed: `src/middleware.ts:isSessionlessPath` skips Supabase
  construction for /embed assets while retaining security headers. Preserve this
  guard; give the preview asset its own exact path rule. /try is public.
- `next.config.ts:headers` provides static response headers including nosniff.
- `playwright.config.ts`, `e2e/support/strict-reporter.ts`, and CI each encode 39.
  s24 requires changing all active contracts together and retaining zero skips,
  failures and flakes. One added spec yields 40.
- No existing failing audit marker belongs to this new feature; A-24 guards stay.
- CI main-job placeholders are in `.github/workflows/ci.yml`; no env files copied.

## Traps and boundaries

React sanitizes javascript href props. Set the trusted, constant bookmarklet href
through a ref/effect and verify the hydrated DOM, not merely source text.
Host CSP can reject our script origin, inline styles, or replacement images;
never bypass a host policy. Explain the limitation and offer the local sample.
Keep preview runtime separate from production embed and its byte accounting.
Avoid rich paste/drop HTML, form submits and link navigation during edit. Restore
original child nodes on Cancel (including handlers), editable attributes and all
injected UI/listeners on Exit. Handle detached elements and nested candidates.
Use event delegation so new page content works without per-node listeners.
A new remote image necessarily makes an image request; user clarification is
pending. Default to the explicit zero-network requirement (embedded data images)
unless the user authorizes the requested-image exception.

## Open questions

Image URL network policy above; no implementation dependency for text editing.
Complexity remains 3. No new dependency, database, auth, billing or deployment work.
