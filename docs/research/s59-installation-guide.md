# Research for the installation guide

## Premise

Verified on 2026-10-03 against the current repository: no `src/app/docs` route
exists. The footer records that `/docs` was removed because it returned 404.
The dashboard has short installation recipes, but its Next.js recipe only names
a root layout/document and does not explain hydration, client navigation or
URL-collecting analytics.

## Current contracts

- `src/lib/sites/embed-script.ts`: `buildEmbedScript` generates one classic
  external script, site ID/token/API attributes, and an optional websocket
  attribute. It does not generate per-page access permissions or editor login.
- `src/lib/sites/install-recipes.ts`: canonical installation recipes for the
  dashboard and public stack pages. Update it rather than create a competing
  Next.js recipe. Plain HTML uses the closing body location.
- `src/components/dashboard/SiteInstallationCard.tsx`: Copy snippet / View install
  snippet, install status and an automatic status-update explanation.
- `src/components/dashboard/ActivationChecklist.tsx`: Invite a client prepares
  edit/publish permissions; installation and first publication are separate steps.
- `src/app/api/editor/editors/route.ts`: POST adds/restores; PATCH resends;
  an active-existing POST does not automatically email. Delivery is reported
  separately from editor enrollment.
- `src/lib/security/site-auth.ts`: normalized host comparison retains www and
  subdomains. A public site token does not replace editor authentication.
- `src/app/api/sites/[siteId]/regenerate-snippet/route.ts`: regeneration rotates
  the signing secret and invalidates previously installed site tokens.
- `src/middleware.ts`: protected routes are dashboard/settings. New public docs
  must remain readable without creating an account or choosing a plan.
- `src/components/layout/Footer.tsx`: suitable public guide entry point.
- `docs/design-system.md`: informational app surface uses Instrument Sans,
  JetBrains Mono for code, deep teal and cool-neutral tokens, existing UI primitives.

## Integration evidence from this conversation

The aicompoz.com install required two corrections before deployment: analytics
read the credential-bearing URL before widget execution, and Next client routing
retained the document-level widget on pages without a loader. The reviewed landing
change skips collectors on credential-bearing documents and uses full document
navigation for its homepage exits. These are bounded integration findings, not a
claim that every React/Next.js installation is safe with that exact adaptation.

The current widget observes the document and retains state; its exposed destroy
method does not completely remove all listeners/timers. Do not advertise generic
SPA teardown/reinit or seamless route changes in documentation.

## Review repair facts

Fresh review on 2026-10-06 found two implementation drifts from the verified
contracts above:

- `/docs/install` is an informational app surface. The design system reserves
  `sky-*`, `slate-*`, `font-display` and weight 700 for Marketing, while this
  screen's approved design calls for semantic app tokens, Instrument Sans and
  JetBrains Mono for machine text.
- Invited editors authenticate at `/edit` through
  `POST /api/editor/request-code` and `POST /api/editor/submit-code`.
  `EditorSignIn.tsx` fixes `CODE_LENGTH` at six and labels the input `6-digit code`.
  Owner login supports magic links elsewhere, but the invited-editor flow does
  not, so the installation brief must describe only the emailed-code path.

## Constraints and unknowns

The global historical story-breakdown review still says `Stories ready: no`.
This new bounded documentation story is written against the existing self-serve
installation scope and needs its own plan validation and review; that old verdict
is not represented as a fresh pass.

Builder menu names, plan support, custom CSPs and third-party scripts vary. The
copy describes required capabilities instead of inventing exact UI paths or
claiming tested compatibility. No new platform integration is implemented here.

## Complexity

3: one public guide, one copy interaction/export, two existing entry links and
shared recipe corrections. No schema, authentication, billing or embed changes.
