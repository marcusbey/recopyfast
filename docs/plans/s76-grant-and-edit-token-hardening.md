---
validated: yes
---
# Plan — Story s76-grant-and-edit-token-hardening

> CTO decision under the owner's 2026-10-09 directive.

Branch: `feature/s76-grant-and-edit-token-hardening` (from `origin/main` `72f4cff`).
Research: `docs/research/s76-grant-and-edit-token-hardening.md` — read it first. Decision: ADR 055.
No Design step: no new screen; the "Edit website" tab opens a different address and the widget's
banners and modals are unchanged.

## CTO decisions

1. **Edit link = a one-time signed code in the fragment, spent by the widget's boot check**
   (ADR 055). `editUrl = https://<host>/#rcf_edit=<code>`; code `rcfl1.{e,s,x}.<HMAC>` under a new
   domain tag; 60 s; single use via `last_used_at IS NULL` on the session. Spent only in
   `POST /api/staging/validate`, after signature, site and expiry checks and an exact-host Origin
   check; the response carries `editToken`. Why: the A-29 pins forbid the token anywhere in
   `editUrl` and any query key; a dedicated route measured +88 / +79 gz against zero headroom; the
   session row already holds the single-use state (no migration).
2. **The widget stops reading `rcf_edit_token` from the query** (downgrade and fixation through a
   2–24 h token closed). Old links minted before the deploy stop working; the owner clicks Edit
   website again. Production has no users.
3. **Embed offsets, all in the file the story changes** (measured, research table): `kind:
   result.kind` (fallback dead — the server always sends it), no `rememberDevice` in the refresh
   body (ignored server-side after task 3), `init()` tests `this.stagingMode` alone (it implies a
   token), no `|| undefined` in the boot-check body and `editorTokenBody()` (servers read strings
   only), one `keepEditLink()` for parse time and the swap, destructured restore.
4. **Device grants: the lineage decides, never the body; 30 days from first issue, both kinds.**
   Remembered-ness of a rotation = the span the server chose for the row being rotated
   (`expires_at − created_at > 24 h`). Lineage start travels in the signed grant payload as `l`
   (epoch s); a pre-s76 token falls back to its row's `created_at` once. Past the ceiling,
   validation answers `expired` (the widget prompts for a code); a replacement never expires after
   the ceiling. An undatable lineage is refused. `refreshDeviceGrant` keeps an optional, ignored
   `rememberDevice` so the A-28 suite can prove no value of it moves the lifetime; the route stops
   reading it. Issuance choices (submit-code's checkbox, handoff/create's hub session) are the
   editor's own and unchanged.
5. **L12: exact registered host** for `originBelongsToSite`, with site-auth's `normalizeDomain` /
   `parseOrigin` (one rule with the content routes). Localhost stays a non-production convenience.
6. **R4: "sessions" = the editor's `staging_access` invites on that site** (edit sessions belong to
   `site_permissions` members and are already deactivated on member removal, s68a). Matched with
   `normalizeEmail` in code, never `ilike` (wildcards). Best effort like the grant sweep: validation
   already refuses a revoked address (s68c), so a failed sweep is logged, not fatal.
7. **503 for infrastructure errors** on every editor validation path (edit session, staging invite,
   device grant, `validate-grant`); 401 only for a definitive refusal. The widget already keeps
   credentials on non-401/403 — tests only.
8. **Commits:** the protocol's docs commit, then one story commit. No migration, nothing under
   `server/`, no new dependency.

## Tasks (ordered, test-first)

0. [x] **Baseline.** Targeted suites green on `72f4cff`; `build:embed -- --check` = 45828 / 33062.
1. [ ] **503, not 401, on an outage.**
   - RED `src/lib/auth/__tests__/editor-access-outage.test.ts`: `validateEditorAccess` answers
     `{valid:false, status:503}` when the `edit_sessions` read errors, when the `site_permissions`
     read errors, when the `staging_access` read errors, when the revoked-editor read errors, and
     for a device grant whose row read errors; and still 401 for an unknown edit token, an unknown
     staging token and a revoked grant (no regression of the verdicts).
   - RED `src/__tests__/api/editor/validate-grant/route.test.ts` (new): reason `error` → 503;
     `expired` → 401 with `nextAction`.
   - GREEN: `editor-access.ts` (`maybeSingle`, error → 503 with a fixed message),
     `staging-access.ts` (`unavailable` flag), `validate-grant/route.ts`.
   - PIN (green before and after, mutation-checked): `edit-link-persistence.test.ts` keeps the link
     through a 503 from validate; `editor-auth.test.ts` keeps the grant through a 503.
2. [ ] **L12.** RED `src/lib/auth/__tests__/editor-request-origin.test.ts`: exact host (scheme,
   port, case variants) true; `evil.example.com`, `example.com.evil.test`, `notexample.com`, the
   parent of a `www.` registration false; localhost true outside production only; a failed or
   empty site read false. GREEN `editor-request.ts`.
3. [ ] **A-28.** Flip the four `test.failing` in `editor-grants-ttl.test.ts`; adjust the two guards
   that described the defect (declared); add: a lineage 25 days old mints no later than its
   ceiling; a minted grant's payload carries the lineage start forward; a pre-s76 token (no `l`)
   anchors on its row's `created_at`; a row with no `created_at` and no `l` is refused;
   `validateDeviceGrant` refuses a lineage at the ceiling with `expired`. Route test: the body's
   `rememberDevice` is not forwarded. GREEN `editor-grants.ts`, `refresh-grant/route.ts`. Fixtures
   that build grant rows gain `created_at` (declared).
4. [ ] **R4.** RED `src/lib/auth/__tests__/editor-directory-revoke.test.ts`: revoking deactivates
   the address's active invites on that site in any case, not another address's (`_` in the name),
   not another site's; a failed sweep still reports the editor revoked. GREEN `editor-directory.ts`;
   the DELETE route logs the count.
5. [ ] **Edit link — format.** RED `src/lib/auth/__tests__/edit-link.test.ts`: mint/read round
   trip; a tampered payload, a grant-domain signature, a wrong prefix and garbage read as null;
   `buildEditUrl` for `example.com`, `https://example.com`, `https://example.com/path`,
   `example.com:8443`, unparseable → null. GREEN new `src/lib/auth/edit-link.ts` (no Supabase, no
   `@/` imports), `CRYPTO_DOMAIN.editLink`.
6. [ ] **Edit link — issuance.** Flip the three A-29 pins in `create-token-leak.test.ts` (signing
   key set in the file, declared) and add: the fragment's code names this session and site and
   expires in ≤ 60 s. GREEN `create/route.ts`.
7. [ ] **Edit link — redemption.** RED `src/__tests__/api/staging/validate-edit-link.test.ts`
   (stateful fake): a fresh code → 200, `editToken` = the session's token, `last_used_at` set; the
   same code again → 401, no token; expired, other site, forged → 401 with no database call; other
   origin / subdomain → 403, session unspent; consume error → 503; holder lost the grant → 401; a
   stored raw token still validates with no `editToken` in the answer. GREEN new
   `src/lib/auth/edit-link-redeem.ts`, `staging/validate/route.ts`.
8. [ ] **Edit link — widget.** RED in `edit-link-persistence.test.ts`: `/#rcf_edit=<code>` → the
   boot check carries the code, the answer's token replaces it in memory and storage, the address
   bar keeps no fragment; the next page validates with the token; a legacy `?rcf_edit_token=` boots
   a visitor and stores nothing; an ordinary `#section` is untouched; a refused code is forgotten
   and explained once. Convert the suite's other landings, and `ai-suggest-credentials`,
   `editor-terminal-session`, `plan-ended-message` (a tab already holding the session), and
   `editor-auth.test.ts`'s refresh body (declared). GREEN `recopyfast.src.js` (decision 3), rebuild.
9. [ ] **Bytes.** Ratchet `MAX_*` and `SEEDED_MAX_*` to the measurement with an itemised ledger.
   Stop rule: above 45828 / 33062 → stop and report.
10. [ ] **e2e.** `share-edit-publish.spec.ts` mints a code for its seeded session and lands on
    `#rcf_edit=`; `realtime-parity.spec.ts` starts both contexts from a tab holding the session.
    `--list` count unchanged.
11. [ ] **Docs and truth.** `docs/stories.md` s69 L12/R4 → closed by s76; comments that describe
    `rcf_edit_token` landings (`useEditSession.ts`, `Benefits.tsx`) say what is true.
12. [ ] **Gates, mutations, commit.** Full jest, type-check (both), lint, format, `build:embed
    --check`, Playwright `--list`. Mutation per guard (report table). One story commit.

## Rollout

Application only: the Vercel deploy serves the new route behaviour and the new
`/embed/recopyfast.js` together. No migration, no Fly deploy. Edit links minted before the deploy
stop working (by design). After deploy: (1) Edit website from the dashboard → the tab's address
ends in `#rcf_edit=…`, the page is editable, the address bar shows the bare URL; (2) the same URL
opened again → "Invalid or expired staging link."; (3) click to a second page → still editing.

## Run interdicts

- Ceilings only go down; the artifact is rebuilt, never edited.
- No migration, nothing under `server/` or `supabase/`, no new dependency.
- Never `next dev`; never print env files; never push or merge.
