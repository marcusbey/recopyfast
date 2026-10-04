# Review — Story s59-installation-guide

> Fresh-context anti-hallucination review.
> Diff reviewed: `git diff main...feature/s59-installation-guide`, from base
> `9aa492d` through committed source SHA `9eefdf3` (implementation `bea9203`,
> review-fix test commit `9eefdf3`), plus the pending one-class follow-up delta
> that adds `font-mono` to the snippet example. Root owns the follow-up commit,
> so this report does not invent a SHA for it.
> Judged against the validated plan, research, screen and copy designs,
> `AGENTS.md`, the accepted installation/authentication ADRs, and the actual APIs
> and UI labels named by the guide.

## Summary

The story implements the requested public guide and agent handoff without
changing the embed, authentication, editing, billing, database, or dependency
surfaces. The generated example comes from `buildEmbedScript`; the page, copy
control, visible brief, and Markdown response share one runtime source; the two
public middleware exceptions remain exact; and both requested entry links are
present.

The first review mutation exposed that the middleware test did not protect the
exact-path boundary. The follow-up test-only commit adds five negative near-match
cases. Repeating the same broadened-prefix mutation on the final SHA now makes
all five cases fail. The one minor presentation drift found on `9eefdf3` was
then corrected by the scoped `font-mono` follow-up. No open finding remains.

## Findings

No open findings.

Resolved during review:

- **minor — `src/app/docs/install/page.tsx:172` at `9eefdf3`.** The placeholder
  snippet initially used the browser's default monospace face instead of the
  JetBrains Mono token required by
  `docs/designs/s59-installation-guide.md:22-24`. The pending follow-up delta
  adds `font-mono` to the snippet `<pre>`. The reviewer inspected the exact
  one-class diff, `git diff --check` is clean, ESLint reports 0 errors, and the
  page suite passes 4/4.

## Plan and design compliance

- [x] The approved guide and agent brief live in
  `src/lib/docs/installation-content.ts`. The example is built through the real
  `buildEmbedScript` signature with explicit placeholder values and production
  origins.
- [x] `/docs/install` is server-rendered. Only the copy control is a client
  component. Clipboard success follows a resolved `writeText`; denial and an
  unavailable API show and focus a selectable fallback.
- [x] `/docs/install/agent-instructions.md` returns the exact same 5,770-byte
  Markdown string used by the copy control and visible `<pre>`. The final string
  also byte-matches `docs/designs/s59-agent-installation-copy.md`.
- [x] The footer and `SiteInstallationCard` link to the guide. The card exposes
  the link in awaiting-install, live, and stale states.
- [x] The shared Next.js recipe no longer claims a root-layout script completes
  SPA integration. Hydration, route navigation, Back/reload, analytics URL
  collection, credential query parameters, and the lack of a complete widget
  teardown contract are stated in both user and agent guidance.
- [x] The final copy truthfully states the first-paint limitation: published
  content arrives after widget startup and a network read, so snippet
  installation does not promise zero-flash rendering or SSR.
- [x] The page structure matches the design: compact header, desktop contents
  rail, mobile disclosure, generated snippet explanation, verification,
  troubleshooting, rollback, and the agent brief. Heading hierarchy is H1 → H2
  → H3.
- [x] No package, lockfile, embed source/artifact, migration, billing, editor,
  or content-route file changed. Task 6 (PR, manual merge, deployment proof) is
  intentionally outside this review and remains pending.

## API and content verification

- [x] Every changed import and called API exists with the used shape:
  `buildEmbedScript(BuildEmbedScriptParams)`, Next `Metadata` and `Link`, the
  installed Lucide icons, and the existing `Button`, `Card`, and `Alert`
  variants. The installed `next/script` type accepts
  `strategy="afterInteractive"` as described by the guide.
- [x] The operational copy matches source behavior:
  registered hosts preserve `www` and subdomain distinctions; regeneration
  rotates `sites.api_key`; computed element IDs and reads are page-scoped;
  `/edit` uses a six-digit emailed-code flow; an existing active editor needs
  PATCH/resend for another invitation email; Save writes staging content and
  Publish promotes it; installation status is separate from edit/publish proof.
- [x] The example is inert placeholder text on the guide. It contains no live
  credential and preserves the optional WebSocket explanation.
- [x] No accepted ADR is contradicted. In particular, the durable-token/key
  rotation contract, exact origin pin, page-scoped content behavior, and
  sessionStorage edit-link caveat remain intact.

## Tests and neutralization

- [x] **Reviewer full Jest on committed SHA `9eefdf3`:** with the repository's
  documented CI app origin (`NEXT_PUBLIC_APP_URL=http://localhost:3000`), **314
  suites passed, 2 skipped; 4,040 tests passed, 38 skipped; 0 failed**.
- [x] A bare-shell run first produced one unrelated failure in
  `src/__tests__/api/content/[siteId]/route.test.ts` because its first-party CORS
  assertion explicitly falls back to `NEXT_PUBLIC_APP_URL`. The isolated suite
  passed 38/38, and the full suite passed, once the documented placeholder was
  supplied. No s59 file participates in that route.
- [x] Final middleware suite: **49/49 passed**. `git diff --check` is clean.
- [x] The implementation commit hook and final review-fix hook additionally
  reported lint, type-check, format, build, and the full Jest suite green.
- [x] **Pending font-only follow-up:** reviewer ESLint reports 0 errors and the
  installation page suite passes **4/4**. A second full-suite run is not needed
  to prove a single Tailwind font class with no logic, content, or API change.
- [x] Mutations were made only in isolated archives of final SHA `9eefdf3`, then
  trashed. The story worktree's tracked files remained byte-clean.

| Neutralized behavior | Red tests |
| --- | ---: |
| Clipboard rejection/unavailability falsely sets `copied` | **2** |
| Markdown response appends content absent from the canonical brief | **1** |
| Exact docs paths broaden to `startsWith("/docs/install")` | **5** |

## Limits and release evidence still required

- The final HTTP Markdown response was checked at 5,770 bytes and matches the
  final design copy. The earlier browser download was 5,420 bytes and predated
  the added first-paint caveat, so it is deliberately excluded as final download
  proof. After deployment, download the file again and compare it with the HTTP
  response or canonical source.
- Browser evidence before the final copy amendment showed 200 responses without
  auth, no desktop/mobile overflow, an inert example, correct heading order,
  keyboard section navigation, copy-success feedback, and keyboard access to the
  download. Repeat the mobile/desktop and clipboard-denial gestures on the final
  deployed artifact; the browser adapter could not read back the successful
  clipboard payload, while the unit test does assert the exact `writeText`
  argument.
- No real customer site was installed and no live invitation, email delivery,
  recipient sign-in, save, publish, visitor reload, or restoration was performed.
  Those are appropriately outside this documentation-only story. The post-merge
  check should open both public URLs without a session, follow both dashboard
  entry links, then execute one authorized end-to-end installation journey.
- The ordinary Jest run skips 38 environment-gated tests, including database
  coverage. This story changes no schema or data-access path, so no real database
  harness was warranted for the review.
- `npm audit --omit=dev --audit-level=high` currently exits 1 with six known
  advisories: one critical, two high, two moderate, and one low. No package or
  lockfile changed in this story, so this is not an s59 finding, but the
  repository's production-audit gate remains red and limits overall release
  readiness until handled separately.

Max severity: none
Ship allowed: yes
