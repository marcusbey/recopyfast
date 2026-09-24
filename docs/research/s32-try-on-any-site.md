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

## Pre-share fix decisions (2026-09-24)

The operator resolved image replacement: local raster files read via FileReader and
raster data URLs only; no remote image requests. The review reproduced host link and
button activation during editing and identified immutable caching on a saved URL.
Fix capture-phase isolation with click-point caret placement, preserve inline nodes,
and use a stable URL with revalidation. Real-browser request events must cover the
whole preview lifecycle, including image replacement, rather than mocked transports.
The independent review remains untouched; its initial count/evidence is historical.
No new dependency, database, auth, billing or deployment work.

## Fix mode 2 delta evidence (2026-09-24)

The independent `Delta review 889041c` reproduces list-item selection before the
Alt navigation check, unbounded clickable ancestors, descendant paste/drop escaping
exact-target guards, cloned bars after body restoration, and native text editing
being replaced by Range insertion. D6 needs a pre-existing document capture listener
to prove window precedence. File MIME validation alone cannot prove decodability;
validate local image decode without a remote request, and reject >5 MiB before read.
The active inventory is currently 43; historical verification counts remain dated
evidence, while CI/config/reporter/contracts/QA register must match new collection.
Merged origin/main e43010a (PR #23); story-list conflict retains both s29 and s32.
