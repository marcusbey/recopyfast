# Research — Story s18-stack-recipes

> **Warning (binding, recorded per instruction):** `docs/reviews/stories.md` ends
> `Max severity: major` / `Stories ready: no`. The breakdown has not passed a clean
> `/ks-stories-review`. None of the six majors in that review name `s18` directly, but two
> are structurally relevant here: `s18`'s own dependency, `s02-install-verified`, is
> unaffected by any of the six; `s17-cluster-engine`, the other dependency, is also
> unaffected. The operator has confirmed proceeding despite `Stories ready: no`.

## The five structuring facts

1. `buildEmbedScript` (`src/lib/sites/embed-script.ts:83-99`) is the **only** canonical
   generator of the snippet's text today. `s02`'s typed install-recipe module — the thing
   `s18` is supposed to render from — does not exist anywhere in the codebase yet.
2. `getPublicWebSocketUrl` (`embed-script.ts:63-81`) returns `""` in production because
   `NEXT_PUBLIC_WS_URL` is unset, so `buildEmbedScript`'s `wsAttribute` is omitted entirely
   (`embed-script.ts:92-96`) — today's real, issued snippet carries **no** `data-ws-url`.
3. `src/components/sections/HowItWorks.tsx:33-36` hardcodes a **static string copy** of the
   snippet shape, not generated via `buildEmbedScript` — proof that a second copy of the
   install instructions has already happened once in this repo and is kept in sync only by a
   code comment (`:14-18`) that an agent has to remember to update.
4. `e2e/share-edit-publish.spec.ts:355-387` spins up a real local HTTP server serving a
   plain-HTML page with a live, correctly parameterized embed snippet and drives a real
   Playwright browser against it — the only existing "install → verify live" automated
   harness in the repo, and it only covers plain-html.
5. No `/cms-for/`, `/alternatives/`, or any content-driven dynamic route exists yet, and
   `src/app/sitemap.ts:34-42` is a hand-maintained static array plus one DB-backed blog loop
   — `s17`'s "engine" (typed content + auto-generated sitemap entries) that `s18` is meant to
   ride on does not exist.

## Target story

**`s18-stack-recipes`** — *"As a developer with a site on some specific stack, I want the
exact snippet and the exact place to paste it, so that I am installed in a minute instead of
guessing."*

Acceptance criteria (from `docs/stories.md:857-862`):
- `/cms-for/<stack>` renders for at least wordpress, shopify, webflow, squarespace, framer,
  next-js, astro, plain-html.
- Each page renders from the install-recipe module `s02` owns — no second copy of the
  instructions exists.
- Each page names the exact file or admin location where the snippet goes for that stack.
- Each stack's snippet has been installed on a real instance of that stack and verified live,
  with evidence committed to the repository.
- Each page is reachable from the comparison cluster and appears in the sitemap.
- A stack where install is not actually possible is documented as unsupported rather than
  omitted silently.

Dependencies (declared): `s17-cluster-engine`, `s02-install-verified` ("owns the recipe
data"). Stories.md's dependency graph also draws `s02 ──> s18` directly (`stories.md:58`) and
`s17 ─┬─> s18` (`:66-67`).

Complexity as scored: **3** — "content plus real verification work per stack."

## Current state of the code

**The snippet generator.** `src/lib/sites/embed-script.ts` exports `buildEmbedScript`,
`getPublicWebSocketUrl`, `getPublicAppUrl`, `canonicalizePublicAppUrl`. `buildEmbedScript`
returns a single literal string:

```
<script src="{appOrigin}/embed/recopyfast.js" data-site-id="{siteId}" data-site-token="{siteToken}" data-api-url="{appOrigin}/api"{wsAttribute}></script>
```

`wsAttribute` is `` (empty) unless a WebSocket origin resolves truthy — in production it does
not, so the emitted attribute list today is exactly four attributes, never five. Three server
call sites use it: `src/app/api/sites/register/route.ts:190`, `src/app/api/sites/route.ts:108`,
and `src/components/dashboard/SiteDetailView.tsx:98-103` (as a client-side fallback when
`site.embedScript` isn't already supplied by the API). All three call the same function with
the same shape — there is exactly **one** generator of the raw tag text.

**Where the snippet is displayed to a user.** Two dashboard surfaces render it:
- `SiteRegistrationModal.tsx:39-49,142-152` — shows `registrationResult.embedScript`, the
  string the `/api/sites/register` response returns (itself `buildEmbedScript`'s output). No
  install-location text, no per-stack guidance — just the raw tag plus a copy button.
- `SiteDetailView.tsx:235-265` — same pattern: raw tag in a `<code>` block, one copy button.
  Also no install-location text.

**`DomainVerification.tsx` is not a snippet-display component.** It is entirely about
domain-*ownership* verification (DNS TXT record or hosted file challenge), rendered at
`SiteDetailView.tsx:369` per `s02`'s agentic notes — but it never renders the embed script or
any per-stack "paste it here" instruction. It is **not** a drift site for install
instructions; flagging this because the task brief named it as a candidate and it isn't one.

**A copy that already drifted.** `src/components/sections/HowItWorks.tsx:26-38` (marketing
landing page, "How it works" section) hardcodes its own literal snippet string as static
content — not generated via `buildEmbedScript`. A code comment at `:7-25` explains it was
deliberately rewritten to "mirror" `buildEmbedScript`'s current output (including the
`data-ws-url` omission), but nothing enforces that mirror going forward; it is sync-by-comment,
not sync-by-import. This is the concrete, present-day proof that "two copies drift" is not a
hypothetical risk for this story — it already happened once, to a component `s18` does not
own.

**No install-recipe module, no install-location text, anywhere.** Grepping the dashboard,
marketing components, and `src/lib/` for WordPress/Shopify/Webflow/Squarespace/Framer/
Next.js/Astro/plain-HTML install-location strings (`footer.php`, `layout.tsx`, `<head>`,
`theme.liquid`, etc.) returns nothing except unrelated matches (Next's own `layout.tsx`,
`global-error.tsx` doc comments). Confirms `s02`'s AC — *"the `awaiting-install` state shows
the snippet, a copy control, and the install location for WordPress, Next.js and plain
HTML"* — is unbuilt. `s18` has no data module to render from today, by construction (`s02`
hasn't shipped).

**No content-driven route engine.** `src/app/sitemap.ts` is 98 lines: a static
`STATIC_ROUTES` array plus one `getBlogRoutes()` DB query appended to it. There is no generic
mechanism for "a typed data file plus a template produces a route and a sitemap entry" — that
is exactly what `s17-cluster-engine` is supposed to build (`stories.md:836`: *"This builds the
engine; `s18` and `s19` are clusters riding on it."*). Neither `/cms-for/` nor `/alternatives/`
exists under `src/app/`.

**An existing live-verification harness — plain-html only.**
`e2e/share-edit-publish.spec.ts:355-387`'s `startTargetServer()` starts a real Node HTTP
server on `TARGET_PORT`, serving a plain-HTML document with a genuinely parameterized
`<script src="${APP_URL}/embed/recopyfast.js" data-site-id="${siteId}" data-site-token=
"${siteToken}" data-api-url="${APP_URL}/api" data-ws-url="${WS_URL}">` tag, then drives
Playwright against it through a full edit → share → publish cycle. This is the one place in
the repo where "install the real snippet, then automatically verify it live" already happens
— and only for plain-html.

**A second, static fixture — also plain-html, not app-routed.**
`public/demo-site/index.html:536-541` is a static file (served directly from `public/`, not
through any `src/app/` route) with a stub install already in place:
`data-site-id="demo-novatech-001" data-site-token="test_demo_token_123"` (no `data-api-url`,
no `data-ws-url`). It exists purely as a fixture and isn't referenced by any app code — a
`grep` for `demo-site` under `src/app/` and `next.config.ts` returns nothing.

**The MutationObserver fallback exists, generically.** `public/embed/recopyfast.src.js:921`
calls `this.setupMutationObserver()`; the method itself is at `:3339-3341`. This is the
mechanism that would let the widget pick up content on a stack that renders after the
widget's initial scan (client-rendered storefronts, some page-builder dynamic collections).
The code gives no evidence of *which* of the eight required stacks actually need this path or
which platforms strip injected `<script>` tags — nothing in the repo documents per-platform
behavior. That research is `s18`'s own job, unstarted.

## Anchor points

| File | Lines | Why it matters to `s18` |
|---|---|---|
| `src/lib/sites/embed-script.ts` | 83-99 | `buildEmbedScript` — the exact tag text every recipe page must reproduce |
| `src/lib/sites/embed-script.ts` | 63-81 | `getPublicWebSocketUrl` — why today's snippet has no `data-ws-url` |
| `src/app/api/sites/register/route.ts` | 189-190 | one of three existing callers of `buildEmbedScript` — precedent for the calling convention |
| `src/app/api/sites/route.ts` | 108 | second existing caller |
| `src/components/dashboard/SiteDetailView.tsx` | 98-103, 235-265 | dashboard's snippet display; the surface `s02`'s `awaiting-install` state extends |
| `src/components/dashboard/SiteRegistrationModal.tsx` | 39-49, 142-152 | second dashboard snippet display, sourced from the API response |
| `src/components/sections/HowItWorks.tsx` | 7-38 | the **existing drift site** — a hardcoded, manually-synced copy of the snippet shape |
| `src/app/sitemap.ts` | 1-98 | where `s18`'s pages must register sitemap entries; currently static, no generator |
| `e2e/share-edit-publish.spec.ts` | 355-387 | reusable pattern for automated live-install verification (plain-html proven) |
| `public/demo-site/index.html` | 536-541 | static plain-html fixture, already has a (stub) install |
| `public/embed/recopyfast.src.js` | 921, 3339-3341 | `setupMutationObserver` — the fallback path for client-rendered content |
| `docs/architecture.md` | 282-294 | CSP section — `script-src 'self'`/`connect-src 'self'` constraints that bear on "hostile" platforms |

## Verified APIs / functions

- `buildEmbedScript({ siteId, siteToken, appUrl?, wsUrl? }): string` —
  `src/lib/sites/embed-script.ts:83-99`. Verified signature, verified output shape (four
  attributes, `data-ws-url` conditionally present), verified that it HTML-escapes each
  interpolated value via `escapeAttribute` (`:12-18`).
- `getPublicWebSocketUrl(appUrl = getPublicAppUrl()): string` — `:63-81`. Verified: returns
  `""` unless `NEXT_PUBLIC_WS_URL` is set, with one dev-only exception for
  `localhost:3000` → `:4001`.
- `getPublicAppUrl(): string` — `:42-46`. Verified: env var, canonicalized, falls back to
  `http://localhost:3000`.
- `canonicalizePublicAppUrl(origin: string): string` — `:29-40`. Verified: rewrites the apex
  host `recopyfa.st` to `www.recopyfa.st` only; leaves everything else, including an
  unparseable string, unchanged.
- No install-recipe function or type exists to verify — this is the false-premise finding
  above, not an omission in my search.

## Traps & constraints

- **The dependency on `s02` is real and load-bearing, not decorative.** There is no typed
  recipe data anywhere in the repo. `s18` cannot start writing real content until `s02`
  defines the module shape (per-stack file/location text, snippet variant, unsupported flag +
  reason). Starting `s18` first would force it to invent that shape itself, which is exactly
  the "two owners" collision `stories.md:868-872` (agentic notes) was written to prevent.
- **The dependency on `s17` is equally real.** No content-driven route engine exists. If `s18`
  is executed before `s17`, it will end up writing its own route/sitemap-generation code —
  which `s18`'s own notes forbid by the same principle `s19`'s notes state explicitly
  ("If this needs new route code, `s17` was built wrong").
- **`HowItWorks.tsx` is a live drift site `s18` does not own but should not add to.** It is
  outside `s18`'s stated scope (it isn't the install-recipe module, and `s02` doesn't claim it
  either), but an agent building the recipe pages should be aware a second, unmanaged copy of
  the snippet shape already exists in the marketing surface.
- **The `data-ws-url` omission must be reflected honestly.** Any recipe page's shown snippet
  has to match what `buildEmbedScript` emits *today* — no `data-ws-url`, since
  `NEXT_PUBLIC_WS_URL` is unset in production. A page showing a WS-enabled snippet would
  describe a product state (`s07`) that doesn't exist yet for any real customer.
- **The "documented as unsupported" carve-out is a real risk, not a formality.** Nothing
  currently defines what counts as "genuinely hostile" or requires evidence of an actual
  failed install attempt before a stack can be marked unsupported. Without a firmer bar, an
  executing agent could mark several of the harder platforms (Shopify, Webflow, Squarespace,
  Framer) unsupported simply to avoid the manual verification burden, which would silently
  fail the PRD's "≥8 stacks with a verified install recipe" requirement while technically
  satisfying the AC's literal wording.
- **"Evidence committed to the repository" has exactly one structural precedent, and it only
  covers 1-3 of the 8 stacks.** `e2e/share-edit-publish.spec.ts`'s live-server + Playwright
  pattern proves feasible for plain-html, and very plausibly extends to Next.js and Astro
  (developer-controlled frameworks, same "add a script tag, run the app, assert the widget
  mounted" shape). WordPress is scriptable in principle (a local WP instance via wp-cli/Docker,
  snippet installed via a theme file or a code-injection plugin, then Playwright-verified) but
  nothing in this repo does that today — it would be new harness work. Shopify, Webflow,
  Squarespace and Framer are hosted SaaS platforms with no local or CI-spinnable instance:
  "verified live" for those genuinely requires a real (often paid or trial) account operated by
  a human, with a screenshot or recording as the artifact — an autonomous coding agent cannot
  close this AC for those four stacks by itself.
- **Widget degrade-never-break (`AGENTS.md` non-negotiable #4) applies to every fixture used
  for verification.** A broken install attempt on any of the eight stacks must not throw on
  the host page; this is testable by console-error assertions in whatever harness gets built.
- **`DomainVerification.tsx` is a false lead, not a drift site** — recorded so a later pass
  doesn't re-investigate it as an install-recipe copy.

## Open questions

- What exact shape will `s02`'s install-recipe module take (field list: stack slug,
  file/location description, snippet variant if any, unsupported flag + reason)? Unknown
  until `s02` is planned. `s18` cannot be scoped to the byte/field level before that.
- What format satisfies "evidence committed to the repository" for the four hosted-SaaS
  stacks (Shopify, Webflow, Squarespace, Framer) where no CI-spinnable instance exists — a
  screenshot, a screen recording, a written verification log with a timestamp and account
  reference? The AC states the requirement but not the artifact format; this needs a decision
  at `/ks-plan`, not an assumption baked in by whoever executes first.
- Which of the eight required stacks are actually "genuinely hostile" per AC6, and why? Not
  documented anywhere in this codebase — it is unresearched, per-platform behavior that only
  the story's own execution will discover. The only codebase-verified fallback mechanism is
  the generic `setupMutationObserver` (`recopyfast.src.js:3339`), which says nothing about
  which platforms need it or which platforms strip injected `<script>` tags.
- Does `/cms-for/<stack>` reuse `s17`'s exact JSON-LD shape (`SoftwareApplication` /
  `FAQPage` / `BreadcrumbList`, per `s17` AC3) or does an install guide need its own
  structured-data type (e.g. `HowTo`, which fits step-by-step install instructions better than
  `FAQPage`)? Cannot be resolved without `s17` existing to check against.
- Should `HowItWorks.tsx`'s independently-hardcoded snippet be repointed at `s02`'s module once
  it exists? Out of `s18`'s stated scope as written — surfaced here because it's a live,
  unmanaged drift site the story's "no second copy" principle doesn't actually reach.

## Real complexity

Scored **3** in `stories.md` ("content plus real verification work per stack"). The *code*
axis genuinely supports that number, maybe even a 2: once `s17`'s engine and `s02`'s data
module exist, `s18` is templated content rendering over both — comparable to `s19` (scored 2),
slightly heavier because each page needs an exact, stack-specific file/location description
plus a documented-unsupported fallback path that `s19`'s pages don't need.

What the numeric code-complexity scale doesn't capture is an **execution-model mismatch**, not
engineering complexity: AC4 requires installing the real snippet on a real instance of each of
8 stacks and committing evidence. For plain-html, Next.js, Astro, and plausibly WordPress, that
is buildable as an automated or semi-automated harness (extending the
`share-edit-publish.spec.ts` pattern). For Shopify, Webflow, Squarespace and Framer — hosted
SaaS platforms with no local or CI-spinnable instance — a coding agent cannot single-handedly
satisfy AC4 without either real account credentials handed to it or a human performing the
install and returning evidence. This isn't a reason to raise the complexity number (the PRD's
1-5 scale measures real-time/migrations/external-systems engineering risk, not manual-QA
labor), but it is exactly the kind of thing the story's existing 4s each get an explicit
**Risk** paragraph for, and `s18` currently has none. I'd recommend adding one at `/ks-plan`
naming the human-in-the-loop dependency for the four hosted platforms explicitly, so it's a
known checkpoint rather than something discovered mid-execution when an agent hits a wall it
cannot pass alone.

No split proposal — the story is not a 5.
