# ADR 041 — Editing, publishing and AI spend need the site owner's plan

- Status: accepted
- Date: 2026-09-28
- Scope: s51-edit-needs-a-plan
- Amends: [ADR 035](./035-widget-ai-charged-to-site-owner.md) — its "Watch" note on multi-admin
  sites (the payer is now deterministic)

## Context

Nothing on the write side read a plan. The only plan checks in the product were site creation,
collaborator seats, A/B generation and the middleware's page redirect, and that redirect lets
credit holders through and never runs for `/api`. A lapsed trial, a credits-only account, or an
owner whose subscription had ended kept saving and publishing live. So did every editor they had
invited and every API key they had minted. The credentials outlive a lapse:

- edit sessions last up to 24 hours;
- device grants last 12 hours, or 7 days sliding;
- API keys never expire unless given a date.

Two further facts shaped the answer:

- `resolveSiteOwnerId` returned *an* admin rather than *the* owner. Sharing a site as `manager`
  inserts a second `admin` row, and the owner query was an unordered `.limit(1)`.
- The widget treats any 401/403 on a write as terminal. `handleTerminalWriteFailure` forgets the
  edit link, locks editing and shows "Session ended — draft kept". Any other status alerts the
  body's own text. The embed sits at its gzip ceiling, so the widget cannot grow to learn a new
  refusal.

## Decision

**Every content write, every credential issuance and every AI spend requires the SITE OWNER's
entitlement to be `plan`, through one helper, `checkOwnerCanEdit(siteId)` in
`src/lib/billing/owner-can-edit.ts`. It is asked after the route has authorised its caller, and
it refuses with a 402.**

- **Keyed by the owner, never the caller.** The owner is the earliest `admin` row in
  `site_permissions`: `order("created_at", ascending)`, then `order("id")`, then `limit(1)`. The
  registration row is always the oldest, and a manager's row is always newer. The entitlement is
  read with the service role (the ADR 035 precedent), because the caller may have no account and
  RLS would hide the owner's entitlement from a collaborator.
- **Fails closed, honestly.**
  - `plan_ended` (a `credits` or `none` owner) and `no_owner` (no admin row, logged) answer
    **402** with `{ error, message, reason, upgradeRequired: true }`. Both fields carry "This
    site's plan has ended — the owner can reactivate it." The widget and dashboard read `error`;
    the editor-auth routes, the code prompt and the `/edit` hub read `message`.
  - A read error answers a retryable **503** that never mentions a plan. A Supabase blip must not
    tell a paying customer they lapsed.
- **After authorization, and after the route's per-site limiter.** A "plan ended" answer to an
  anonymous caller would tell anyone holding a site id (it is in the public snippet) whether that
  customer lapsed. The rule for every gate: it runs only once the caller is authenticated for
  that site. An unauthenticated caller, or one without access to the site, gets the same answer
  whatever the owner's plan, and the plan is not read. Two issuance routes hide their authorization inside a library call that also
  inserts: `edit-sessions/create` and `staging/access`. They read the caller's first-party access
  first, and gate only a caller who holds a row.
- **Gated:**
  - content writes: staging save, publish, version restore, `edit-board/styles/apply`, bulk
    import and update, `/api/v1/content` POST and PUT, `ai/translate`, `ai/suggest`;
  - issuance: `edit-sessions/create` and `extend`, `staging/access`, `editor/submit-code` (site
    mode, after the code is spent), `editor/handoff/create`, and `editor/refresh-grant`. The
    refresh authenticates the grant with `validateDeviceGrant` before it gates, because
    `refreshDeviceGrant` checks the grant and rotates it in one call.
- **Never gated:** public delivery. That covers the embed, `GET /api/content/[siteId]`,
  discovery, `GET /api/v1/content`, bulk export, the validate routes, the staging, preview and
  history reads, and the WebSocket broadcast (it has no write path).
- **Nothing is revoked.** A lapse refuses writes. It never touches a session, a grant, an editor
  row or a key, so the same credential works again the moment the owner picks a plan.
- **Credits come with a plan.** AI spend happens only inside editing. `/api/billing/checkout`
  refuses `intent: "credits"` unless the buyer's entitlement is `plan` (403 `upgradeRequired`,
  before any Stripe call), and the no-plan billing screens say so. Credits already held are kept.
- Middleware routing is unchanged, and still fails open. Its comments now say where the rule
  lives.

## Considered options

- **The gate inside `validateEditorAccess`.** Rejected, for two reasons. It would also gate reads
  (the validate routes, staging GET), which pushes the widget to clear stored credentials. And it
  misses the owner's own session path (`authorizeFirstPartyEditorAccess`), bulk, v1 and the AI
  routes.
- **"Any admin holds a plan".** Rejected: a lapsed owner could keep editing through a paying
  manager's row. The site's plan is the owner's plan.
- **A 403.** Rejected: the widget treats 401/403 as terminal. It would show "Session ended" and
  forget the edit link, which is false, and it breaks "nothing is revoked". A 402 shows the
  server's message for 0 embed bytes.
- **Revoking credentials on lapse.** Rejected: access would not return by itself when the owner
  pays. Every editor would need a new invite, and every integration a new key.
- **Gating `editor/handoff/redeem`.** Rejected, as a CTO decision on 2026-09-28. The 60-second
  code is only checked inside `redeemHandoff`, which also consumes it and mints the grant. The only
  check in front of it is a forgeable Origin header, so a gate there would answer "plan ended" to
  anyone holding a public site id: an oracle on the customer's billing. The gate is also
  unnecessary:
  - a code is reachable only through `handoff/create`, which is authenticated (hub session plus
    the editor's row) and gated;
  - the code lives 60 seconds;
  - every write the redeemed grant could make is gated. A grant redeemed for a lapsed owner's site
    is refused 402 on its first save (`src/__tests__/api/editor/handoff/redeem/route.test.ts`).

  Splitting `redeemHandoff`, so that the gate could sit between checking the code and minting the
  grant, was also rejected, to avoid scope growth into `editor-handoff.ts`.
- **A per-request entitlement cache.** Rejected as unnecessary. Each handler calls the gate once:
  3 round trips for a paying owner, 4 for a lapsed one, at human write rates.

## Consequences

**Easier.** One place answers "may anyone write to this site". Seats, widget AI and editing now
share one deterministic payer.

**Harder.**
- **The payer moves on multi-admin sites.** Seats (`canShareSite`) and widget AI (`ai/suggest`)
  are now billed to the earliest admin row. Before, it was whichever row PostgREST returned
  first. On a site shared with a manager, that is a correction: the agency that registered the
  site pays, not its client.
- Every write costs 3–4 extra reads.
- During a lapse, every blur-save in the widget alerts the message, because a 402 is not
  terminal. That is the honest cost of 0 bytes. Making 402 terminal would cost bytes and forget
  the edit link.

**Watch.**
- Paid credits-only accounts existed before this rule. The operator lists them before deploy and
  comps or refunds each one ([runbook](../operations/edit-needs-a-plan.md)).
- `editor/handoff/redeem` is deliberately ungated (see "Considered options"). If a second way to
  mint a handoff code is ever added, it must be gated, because redemption relies on the only
  minter being gated.
- `DELETE /api/v1/content` is dead: `validateAPIKey` never sets `content_delete`. It must be gated
  if it is ever revived.
- `bulk/update` still has no rate limiter, and `ai/translate` still bills the caller rather than
  the owner. Both are pre-existing, and out of scope here.
- **Direct database writes bypass this gate (pre-existing; review major, 2026-09-28).** RLS policy
  "Users can edit content for authorized sites" (FOR ALL) plus `authenticated`'s INSERT/UPDATE/
  DELETE grants let a signed-in `edit`/`admin` member write `content_elements.published_content`
  through PostgREST with the anon key and their own session — proven locally with a planless
  owner's PATCH (200, live row changed). The A/B tables share the gap. Until story
  `s56-rls-content-writes-need-plan` ships (before public launch), "every content write needs the
  owner's plan" holds for the application's routes, not for direct PostgREST writes.
- `ab-tests/*` is in neither list above: `generate` checks and charges the caller's plan, not the
  owner's. Parked feature; closed together with the A/B tables in s56.
