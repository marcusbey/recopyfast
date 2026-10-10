# s35 — Research

## Verified premise

`SiteDetailView.tsx` currently says never to expose the Site Token publicly, while buildEmbedScript emits it into public HTML. ADR 027 specifies rotation revokes old snippets and documents the live-socket caveat. `sites.status` plus `resolveEffectiveSiteStatus` is s02's current liveness state. Activation uses the durable verification milestone (`status = live` or `live_at` present), so 14 quiet days do not undo installation. Do not infer verification from content counts or domain-verification DNS state.

s03 is planned only: no account_milestones implementation/migration exists in this checkout. The current publish RPC (`20260924060000_restore_site_wide_publish.sql`) inserts staging_history.action=publish for changed content or attributes. Join staging_history to content_elements via content_element_id, filter content_elements.site_id and action=publish, limit existence query to one. Draft create/update and ordinary discovery content_history rows are not publish evidence.

`site_editors.revoked_at IS NULL` is the active allowlist predicate in editor-directory.ts; activation additionally requires Publish permission (`publish` or `admin`, matching normalization); pending email grants and site_permissions are different concepts. Existing SiteEditorsCard owns invitation form and delivery feedback. Overview uses /api/sites with a five-row recent list; all sites are available and checklist must not inherit that limit. SiteDetailView gets selected site data. Existing /api/edit-sessions/create is the dashboard edit entry; no new edit-auth path is needed. Verified create route returns an expiring rcf_edit_token in editUrl, consumed and stripped by the embed. The A-29 tokenless link change belongs to a different path; do not assume it changed this endpoint.

## Boundaries and traps

Use the authenticated server Supabase client for permission and activation reads, with RLS on (ADR 002 §2). The regenerate-snippet route needs service-role for credential writes and is not a precedent for these reads. Authenticate, then rate-limit by user and site before permission/data queries. No credential data is returned by the new progress API. Unknown/query error is error, never false success. Existing overview list stats intentionally fail soft; do not repurpose edits_count as publish evidence. Persist per-user/site dismissal using a distinct top-level Supabase user_metadata boolean key, never an authorization signal; update just that key to avoid overwriting concurrent other-site dismissals. No migration needed.

Audit closeout rows A-25/D3 concern token lifetime/rotation already implemented by s29; this story corrects dashboard copy, not token verification. Existing UI failing markers target registration trimming, unrelated accessibility and toolbar behavior; no existing failing marker is in this scope. Preserve every guard.

## Browser action detail

[MDN Window.open](https://developer.mozilla.org/en-US/docs/Web/API/Window/open) confirms that `noopener` returns null even when a new window opens, and popup creation must occur directly within a user gesture. Pre-open a blank window synchronously, detach its opener, then navigate it only after the edit-session response has passed URL validation; close it on failure. A null return from that initial open is then a valid popup-blocked signal.

## Verification

Setup installs root and server. Test/build environment must be extracted from ci job placeholders, with no .env copied. Targeted Jest during implementation; full precommit once at end, build, embed freshness/gzip, audit:prod. Keep existing 44 Playwright count unchanged: no spec added because component/API tests directly cover this bounded feature and local disposable E2E services are not established. Complexity 3, no structural dependency or schema addition. Five-minute GTM goal still needs a timed user journey after independent review/ship.

## PR #33 fix decisions — 2026-09-25

Step 3 measures any publish record for this site, including owner publishes; its label is “An edit published”. The Live copy enumerates the three observed facts without claiming the invited editor performed the publish. The checklist's invitation form preselects Publish; other invitation entry points retain their defaults.

Dialog ownership is independent of progress branches so invitation feedback and fallback links survive completion and refresh failure. Poll every 60 seconds while incomplete and visible, with a single tab-return trigger and no polling after dismissal/completion. Use the repository-standard `refetch` API.

Batching is deferred: the existing overview mounts the same independently scoped component as site detail; batching would add an endpoint and shared request/identity/dismissal coordination. The bounded fix keeps user/site limits and reduces scheduled polling fourfold without adding that coupling.

The prior delivery-blocker note was stale: commit `e361c35` is already pushed in draft PR #33, with the independent review preserved locally. This fix run uses only exact CI placeholder environment values; no database-backed or production verification is claimed. Current gate results belong in the plan and PR.
