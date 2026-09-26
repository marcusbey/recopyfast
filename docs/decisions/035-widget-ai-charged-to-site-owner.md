# ADR 035 — Widget AI spend is authorised by editor credentials and charged to the site owner

- Status: accepted
- Date: 2026-09-25
- Scope: s40-ai-widget-auth

## Context

`POST /api/ai/suggest` is the widget's AI endpoint: its only live caller is the "🪄 AI" button in
the in-page editor, on a customer's own origin (`recopyfast.src.js` `showAISuggestions`). The
dashboard component that also called it is imported by nothing but its tests.

The route authenticated with the dashboard's cookie session. A cross-origin `fetch` from a
customer's page carries no cookie for our domain, so every request answered 401 and every owner
and every invited editor saw "Failed to generate suggestions", on every site. Fixing authentication
alone would not have helped: every function on the charge path (`getEffectivePlan`,
`getUserCreditBalance`, `consumeCredits`, `consumeFeatureUsage`) built its own cookie client, and
the credit tables allow only `auth.uid() = user_id` or `service_role`, so a cookieless request
resolved the payer to "no plan" and refused.

Two questions had to be settled: who may spend, and who pays.

## Decision

**Widget AI spend is authorised by editor credentials, through `validateEditorTokenFromRequest`
graded with `requireEditorPermission(…, "edit")`, and charged to the site owner through the
service role.**

- Authorisation is the helper every widget write already uses (`PUT /api/staging/content/[siteId]`,
  `POST /api/staging/publish`): a device grant in `X-RCF-Editor-Grant`, pinned to the origin it was
  minted on, or an edit-session / staging token in the request body. No new auth path (ADR 002
  rule 3 — this is the scoped-editor-grant case it names). A lone `Authorization: Bearer <site
  token>` is read as a staging token and refused before anything about the owner is read.
- The payer is the site owner: the `admin` row in `site_permissions`, via `resolveSiteOwnerId` —
  the same definition seat billing uses, now exported rather than duplicated. Never the caller,
  never `sites.user_id` (ADR 002 rule 5).
- The billing functions accept an optional explicit client. Absent, they behave exactly as before
  (cookie client, `getEffectivePlan`). Present, every read and write of the call — entitlement via
  `resolveEntitlement(client, …)`, balance, compare-and-swap, usage rows — goes through it. Only a
  route that has already authorised and graded an editor for the site, and resolved the owner, may
  pass a service-role client.
- The plan gate is the existing `canUseAIFeatures`, unchanged: the balance decides, `aiFeatures`
  shapes only the message. The owner sees the gate's sentence; an invited editor sees one that
  tells them to ask the owner.
- Rate limits: per IP before authorisation, per site after the permission grade, both fail closed
  (ADR 002 rule 4). The per-site bucket sits behind the grade because a site id is public and a
  bucket in front of it would let anyone lock the owner out of AI.

## Considered options

- **The site token, via `authorizeSiteRequest`.** Rejected: the site token is printed in every
  customer page's source. Accepting it would let anyone with `curl` spend an owner's credits.
- **The cookie session.** Rejected: impossible cross-origin from a customer's domain, and public
  CORS (`*`) is forbidden to pair with credentials (`src/lib/http/public-cors.ts`). It is the
  mechanism that broke the feature.
- **Charge the caller.** Rejected: a device-grant editor has no account to charge, and an edit
  session can be opened by a collaborator who is not the owner. The owner holds the plan and the
  wallet, as with seats.
- **A `SECURITY DEFINER` spend function in Postgres.** Rejected for now: it would re-implement the
  entitlement and balance rules (plan precedence, trial windows, included-then-purchased order) in
  SQL beside the TypeScript ones, and the two would drift. The compare-and-swap in
  `deductPurchasedCredits` already makes the spend safe under concurrency.

## Consequences

**Easier.** Owners and invited editors get suggestions from the widget. One definition of "who
pays for this site" now serves both seats and AI.

**Harder.** One more service-role route for ADR 002's count (32 of 82 route files after s40). It
writes billing rows (`credit_usage`, `credit_purchases` decrements, `usage_tracking`, refund
grants) for a user who is not the caller, so the explicit-client parameter is a loaded gun: its
doc comments say who may pass one, and the route-level tests drive the real editor-access code with
real signed grants. `usage_tracking` rows now actually get written on this path (the old cookie
insert was silently denied by RLS).

**Watch.** With two `admin` rows on one site the payer is whichever PostgREST returns first —
inherited from seat billing and deliberately unchanged here (s40 research, open question 3).
`/api/ai/translate` has no widget caller and keeps its cookie auth; `edit-board/styles/apply`
still calls the model unmetered behind a staging token. Both are follow-ups.
