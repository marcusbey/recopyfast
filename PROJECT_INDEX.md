# ReCopyFast Project Index

Last indexed: 2026-07-03

## Product Purpose

ReCopyFast is a universal CMS layer for existing websites. A customer installs a script tag, then a recipient can open a shared website URL, edit content directly on the page, save changes to staging, and publish those changes to the live website without using a CMS dashboard.

Primary recipient URL contracts:

- Preferred staging link: `?rcf_staging=1&rcf_token=<token>`
- Compatibility edit-session link: `?rcf_edit_token=<token>`

Core content contract:

- Live reads use `published_content`.
- Recipient/editor saves write `staging_content`.
- Publish copies staging to published, mirrors `current_content` for legacy compatibility, and clears staging.

## Runtime Shape

| Surface | Location | Role |
| --- | --- | --- |
| Next.js app | `src/app` | Dashboard, marketing pages, API routes, auth, billing, staging APIs |
| Embed script | `public/embed/recopyfast.js` | Runs on customer sites, discovers content, enables inline editing, saves/publishes |
| Secure embed alias | `public/embed/recopyfast-secure.js` | Thin compatibility loader for the main embed script |
| Realtime server | `server/index.js` | Socket.io fanout, content-map ingestion, staged realtime updates, socket publish |
| Supabase schema | `supabase/` and `supabase/migrations/` | Core tables, staging workflow, billing, security, publish RPC |
| Dashboard UI | `src/components/dashboard` | Sites, content, share links, staging access, publish, analytics, AB tests |
| Shared libraries | `src/lib` | Auth, Supabase clients, site tokens, billing, API keys, sanitization, monitoring |

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Starts Next and WS server together |
| `npm run dev:next` | Starts Next only on `3000` |
| `npm run dev:ws` | Starts Socket.io server from `server/` |
| `npm run build` | Production Next build |
| `npm run lint` | ESLint over `src/` |
| `npm run type-check` | Full TypeScript check, including test files |
| `npm run type-check:build` | App/build TypeScript check using `tsconfig.build.json` |
| `npm test -- --runInBand` | Jest suite serially |
| `RUN_RECOPYFAST_CORE_E2E=1 npx playwright test e2e/share-edit-publish.spec.ts --project=chromium` | Mutating core browser flow against a disposable Supabase project |

## Important Environment Variables

| Variable | Used By | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Next app, snippets, WS CORS | Public app origin, usually `http://localhost:3000` locally |
| `NEXT_PUBLIC_WS_URL` | Embed, dashboard | Public Socket.io origin, current local default is `http://localhost:4001` |
| `WS_PORT` | `server/index.js` | Current local default is `4001` |
| `NEXT_PUBLIC_SUPABASE_URL` | Next app and WS server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser Supabase client | Anonymous client key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server APIs and WS server | Server-side only; never expose to browser |
| `STRIPE_SECRET_KEY` / `STRIPE_TEST_SECRET_KEY` | Billing routes | Selection is centralized through Stripe config |
| `ALLOWED_ORIGINS` | WS server CORS | Comma-separated embed/dashboard origins |

## Core Product Flow Index

### 1. Site Registration And Snippet Generation

Start here:

- `src/app/api/sites/register/route.ts`
- `src/app/api/sites/route.ts`
- `src/lib/sites/embed-script.ts`
- `src/components/dashboard/SiteRegistrationModal.tsx`
- `src/components/dashboard/SiteDetailView.tsx`

Expected generated snippet:

```html
<script src="<app-origin>/embed/recopyfast.js" data-site-id="<site-id>" data-site-token="<site-token>" data-api-url="<app-origin>/api" data-ws-url="<ws-origin>"></script>
```

### 2. Recipient Token Normalization

Start here:

- `src/lib/auth/editor-access.ts`
- `src/lib/auth/staging-access.ts`
- `src/lib/auth/edit-sessions.ts`
- `src/app/api/staging/validate/route.ts`
- `src/app/api/edit-sessions/validate/route.ts`

Internal access shape:

```ts
{
  kind: "staging" | "edit-session";
  siteId: string;
  token: string;
  permissions: ("view" | "edit" | "publish" | "admin")[];
  email?: string | null;
  userId?: string | null;
  expiresAt?: Date | null;
  verified?: boolean;
}
```

Permission implications:

- `admin` implies `view`, `edit`, `publish`, `admin`.
- `publish` implies `view`, `edit`, `publish`.
- `edit` implies `view`, `edit`.

### 3. Embed Bootstrap And Editing

Start here:

- `public/embed/recopyfast.js`
- `public/embed/recopyfast-secure.js`
- `src/app/api/content/[siteId]/route.ts`
- `src/app/api/staging/content/[siteId]/route.ts`

Key behavior:

- No-token page loads live `published_content`.
- `rcf_token` and `rcf_edit_token` both enter the same editor UI after validation.
- In-page save persists with HTTP `PUT /api/staging/content/[siteId]` before success UI.
- Socket update is fanout/ack-oriented and not the sole persistence path.
- Site-token-only embed writes are for content discovery/live registration, not live publishing.

### 4. Publish

Start here:

- `src/app/api/staging/publish/route.ts`
- `server/index.js`
- `supabase/migrations/20260617000000_publish_staging_transaction.sql`

Publish must use the shared database RPC:

- Inserts staging history.
- Updates `published_content`.
- Mirrors `current_content`.
- Clears `staging_content`.
- Returns changed element IDs/count.

### 5. Realtime

Start here:

- `server/index.js`
- `src/lib/collaboration/realtime.ts`
- `src/components/collaboration/*`

Socket responsibilities:

- Validate site token or editor token during connection.
- Receive content maps from embedded sites.
- Broadcast staged/live updates to site/dashboard rooms.
- Acknowledge staged save/publish failures instead of reporting success before persistence.

## API Route Map

### Public/embed-facing

- `src/app/api/content/[siteId]/route.ts`
- `src/app/api/staging/validate/route.ts`
- `src/app/api/staging/verify/route.ts`
- `src/app/api/staging/content/[siteId]/route.ts`
- `src/app/api/staging/publish/route.ts`
- `src/app/api/edit-sessions/validate/route.ts`
- `src/app/api/edit-sessions/extend/route.ts`

### Dashboard/auth

- `src/app/api/auth/*`
- `src/app/api/sites/*`
- `src/app/api/staging/access/route.ts`
- `src/app/api/edit-sessions/create/route.ts`
- `src/app/api/edit-sessions/active/route.ts`
- `src/app/api/teams/*`

### Content operations

- `src/app/api/content/[siteId]/route.ts`
- `src/app/api/v1/content/route.ts`
- `src/app/api/bulk/export/route.ts`
- `src/app/api/bulk/import/route.ts`
- `src/app/api/bulk/update/route.ts`
- `src/app/api/edit-board/*`
- `src/app/api/ai/suggest/route.ts`
- `src/app/api/ai/translate/route.ts`

### Commercial/security/ops

- `src/app/api/billing/*`
- `src/app/api/pricing/route.ts`
- `src/app/api/webhooks/stripe/route.ts`
- `src/app/api/api-keys/route.ts`
- `src/app/api/security/*`
- `src/app/api/audit/*`
- `src/app/api/health/*`

## Database And Migrations

Primary migration order:

1. `20250817000000_complete_database_setup.sql`
2. `20251230000000_staging_workflow.sql`
3. `20251230100000_edit_board.sql`
4. `20260127_ab_testing_v2.sql`
5. `20260531000000_stripe_event_idempotency.sql`
6. `20260611010000_rls_hardening.sql`
7. `20260611020000_tighten_permissive_policies.sql`
8. `20260611030000_api_keys_site_scoping.sql`
9. `20260611040000_billing_constraints.sql`
10. `20260611050000_content_elements_query_index.sql`
11. `20260617000000_publish_staging_transaction.sql`
12. `20260617001000_ticket_wallet_compat.sql`

Core tables to know:

- `sites`
- `content_elements`
- `staging_access`
- `staging_history`
- `edit_sessions`
- `site_permissions`
- `teams`, `team_members`, invitations/activity tables
- `billing_*`
- `api_keys`
- `webhook_*`

## Tests And Verification

Unit/integration:

- Jest config: `jest.config.js`
- Test setup: `jest.setup.js`
- Focused contract tests:
  - `src/lib/auth/__tests__/editor-access.test.ts`
  - `src/lib/sites/__tests__/embed-script.test.ts`
  - `src/__tests__/api/sites/register/route.test.ts`

Browser E2E:

- Playwright config: `playwright.config.ts`
- Core guarded spec: `e2e/share-edit-publish.spec.ts`
- Public/landing/dashboard/auth specs: `e2e/*.spec.ts`

Known current verification state from the last repair pass:

- `npm run lint`: exits 0 with warnings.
- `npm run type-check:build`: passes.
- `npm run build`: passes.
- `git diff --check`: passes.
- Focused contract Jest tests pass.
- Full `npm run type-check` still fails on legacy test typings.
- Full `npm test -- --runInBand` still fails across stale auth/UI/test-harness expectations.

## Common Entry Points By Task

| Task | Start With |
| --- | --- |
| Change install snippet | `src/lib/sites/embed-script.ts` |
| Debug shared recipient link | `src/lib/auth/editor-access.ts` |
| Debug staging invite/link auth | `src/lib/auth/staging-access.ts`, `src/app/api/staging/*` |
| Debug edit-session link auth | `src/lib/auth/edit-sessions.ts`, `src/app/api/edit-sessions/*` |
| Debug inline save | `public/embed/recopyfast.js`, `src/app/api/staging/content/[siteId]/route.ts` |
| Debug publish | `src/app/api/staging/publish/route.ts`, publish RPC migration, `server/index.js` |
| Debug live site content load | `src/app/api/content/[siteId]/route.ts`, `content_elements.published_content` |
| Debug realtime fanout | `server/index.js` |
| Debug dashboard site list/detail | `src/app/dashboard/sites/page.tsx`, `src/components/dashboard/SiteDetailView.tsx` |
| Debug billing | `src/app/api/billing/*`, `src/lib/stripe/*`, `src/components/billing/*` |
| Debug API keys | `src/app/api/api-keys/route.ts`, `src/lib/api/rate-limiter.ts`, `src/app/api/v1/content/route.ts` |

## Notes For Future Agents

- Do not treat `current_content` as the live source of truth for new behavior; it is legacy compatibility.
- Do not use recipient Supabase cookies for public staging/edit-token APIs; use server-side token validation.
- Do not maintain separate editor logic in `recopyfast-secure.js`.
- Do not seed or mutate the configured Supabase project for E2E unless it is disposable or explicitly approved.
- The README still contains older WS/snippet defaults in some places; use this index and `.env.example` as the newer runtime map.
