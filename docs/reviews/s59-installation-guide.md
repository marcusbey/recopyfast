# Review — Story s59-installation-guide

> Fresh-context review of `git diff origin/main...feature/s59-installation-guide`.
> Pinned commit: `f0a676d1870c532baee66925e24f9b6552a23c10`.
> Pinned tree: `a46ed89723fd9efd5f92733171cfae819048ed88`.
> Base: `origin/main` at `fb7f41ca09437dce1bac41398cc58399203584b5`.
> Judged against the validated plan, research, screen/copy designs, `AGENTS.md`, the
> accepted installation/authentication decisions and the actual APIs named by the guide.

## Verdict

The public installation guide, dashboard/footer entry points and downloadable agent handoff are
implemented coherently at the pinned source. Runtime content comes from one typed module, the
placeholder snippet comes from the real builder, public documentation paths retain security headers
without paying for a session lookup, and the shared Next.js recipe states the current hydration,
navigation and analytics limits.

The two major issues found during the preceding review are fixed in `16a7c83`. The page now follows
the approved App-surface tokens and typography, and the agent brief now describes the real invited-
editor email-code flow without inventing a magic-link alternative. I found no remaining critical,
major or minor issue.

The final merge reconciles this branch with the independently reviewed, CI-green and deployed s60
mainline. It changes no s59 product, test, research, plan or design byte. The only conflict was the
append-only story ledger; the resolution preserves the s59 block from the reviewed branch and the
s60 block from main verbatim.

## Resolved review findings

### App-surface design drift

Initial severity: major. Resolved by `16a7c83`.

`/docs/install` previously used the Marketing-only `sky-*` / `slate-*` palette,
`font-display` and weight 700 despite its approved design specifying semantic App tokens,
Instrument Sans and JetBrains Mono. The final page uses `background`, `card`, `surface-2`,
`foreground`, `muted-foreground`, `border`, `primary` and `ring`; headings use `font-sans`
with weight 600, while snippets and the agent brief use `font-mono`. No `sky-*`, `slate-*`,
`font-display` or `font-bold` class remains in the page source.

The final production-browser evidence at 1440×1000 and 390×844 shows the expected deep-teal App
surface, readable hierarchy, desktop contents rail, mobile disclosure and no horizontal page
overflow. I inspected both final viewport captures during this review.

### Invented invited-editor magic-link path

Initial severity: major. Resolved by `16a7c83`.

The downloadable brief previously told an invited editor to use an emailed code “or magic link.”
The actual `/edit` flow calls `/api/editor/request-code` and `/api/editor/submit-code` and exposes a
six-digit code field; owner authentication is the separate surface that supports magic links. The
runtime brief now requires the recipient's own “six-digit emailed sign-in code,” and its regression
explicitly refuses the phrase “magic link.” Historical design-copy files remain specifications of
the pre-repair draft; the plan deliberately makes the typed runtime module canonical for the page,
copy action and Markdown response.

## Plan and scope compliance

- [x] The approved guide and agent brief live in `src/lib/docs/installation-content.ts`. The
  placeholder example is produced through the real `buildEmbedScript` signature with explicit
  public origins and no live credential.
- [x] `/docs/install` is server-rendered. Only the copy control is client-side. Clipboard success
  follows a resolved `writeText`; denial or an unavailable API displays and focuses the complete
  selectable fallback.
- [x] `/docs/install/agent-instructions.md` returns the exact same runtime string displayed and
  copied on the page, with Markdown content type and attachment filename.
- [x] Footer and `SiteInstallationCard` link the public guide. The card exposes it while a site is
  awaiting installation, live or stale.
- [x] The canonical Next.js recipe no longer claims a root-layout script completes SPA support.
  It requires hydration, direct-load/navigation/Back/reload checks and protection from analytics
  reading editor-entry query credentials.
- [x] The guide truthfully documents the legacy supported runtime: saved copy arrives after widget
  startup and a network read, so this documentation story promises neither SSR nor zero-flash
  rendering. The later stable-startup story remains separate.
- [x] Public middleware exemptions are exact for the guide and Markdown endpoint. Near-match and
  child paths retain the ordinary session-aware path; both public paths retain the normal security
  headers.
- [x] No dependency, manifest, lock, embed source/artifact, migration, billing, editor, content
  route or provider configuration changes in the story diff.
- [ ] Merge, deployment and post-deploy URL/dashboard verification remain task 6.

The branch also carries its approved PRD/story framing changes although repository lifecycle rules
normally land framing documents on main first. This remains a recorded nonblocking process
deviation rather than product behavior drift.

## API and content checks

- Every changed import and component/API exists with the used shape: Next `Metadata` and `Link`,
  installed Lucide icons, current `Button` / `Card` / `Alert` variants and
  `buildEmbedScript(BuildEmbedScriptParams)`.
- Registered hosts preserve `www` and subdomain distinctions; snippet regeneration rotates the
  signing key; public content is page-scoped; Save writes staging content and Publish promotes it.
- An existing active editor uses the existing resend action rather than a second enrollment.
  Installation detection, invitation delivery, recipient authentication and edit/publish proof
  remain separately reported outcomes.
- The agent handoff retains bounded authority, token redaction, synthetic analytics probes,
  separate-visitor verification, restoration and rollback instructions.

## Final main reconciliation

- `HEAD^2` is exactly current `origin/main` (`fb7f41c`), and the final merge tree is pinned above.
- Every s59 product file matches reviewed commit `c9a155f` byte-for-byte.
- The s59 story block matches `c9a155f` verbatim; the adjacent s60 story block matches
  `origin/main` verbatim. No criterion from either story was dropped or rewritten.
- `git diff origin/main...HEAD` remains the same 25-file s59 surface. Main's s60 route/helper,
  tests and docs do not reappear as PR56 changes.

## Independent verification

Fresh reviewer checks used Node 24.14.0:

- Focused documentation, middleware and editor-code flow on the reconciled tree:
  **12 suites / 120 tests passed**.
- Changed-file ESLint: 0 errors. Full TypeScript and configured format checks passed.
- Root and server production audits both exited 0 with zero vulnerabilities.
- Next 16.3.8 production build passed and emitted both `/docs/install` and the Markdown endpoint.
- Embed freshness passed unchanged at the fixed Node 24 ceilings: 45,880-byte bundle,
  33,120-byte widget and 13,141-byte transport. The widget SHA-256 remains identical to main:
  `6676bd5c5edce7f9f1cee18c79807e5e400e969fe13d7ca0828480547e7b61f9`.
- The final reconciliation's normal precommit recorded **4,041 tests passed / 38 skipped**, with
  lint, type-check and format green. Hosted final-SHA CI remains mandatory before merge.
- `git diff --check` is clean. The generated `AGENTS.md` delta and pre-existing `.lavish/`
  directory were preserved and excluded from the story review.

### Mutation proof

Mutations ran in disposable archives of the byte-identical s59 product source immediately before
the final main-only reconciliation. The active worktree stayed clean, and the reconciliation proof
above confirms neither guarded implementation changed.

| Neutralized behavior | Result |
| --- | --- |
| Restore the invented “email sign-in code or magic link” brief | **1 red / 6 green**: the editor-flow documentation regression failed |
| Broaden exact docs exemptions to `pathname.startsWith("/docs/install")` | **5 red / 44 green**: every protected near-match bypass was detected |

## Findings

None.

## Not verified here

- Hosted CI for the final pinned SHA remains a hard merge gate. This report does not turn a pending
  or failed check green.
- No merge, deployment, production environment change, customer-site installation, invitation,
  provider delivery, recipient sign-in, save, publish, visitor reload or restoration ran here.
- After deployment, open both public documentation URLs without a session, follow the footer and
  dashboard links, repeat mobile/desktop and clipboard-denial gestures, and compare the downloaded
  Markdown bytes with the runtime source.
- The ordinary full suite's 38 environment-gated tests remain skipped. This story changes no
  database or provider path; the focused editor-flow checks, production build and clean audits are
  the relevant fresh reviewer evidence.
- Registry advisories can change without a source commit. Merge must use the current hosted audit
  result rather than treating this report as a permanent waiver.

Max severity: none
Ship allowed: yes
