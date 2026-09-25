# s35 — Research

## Verified premise

`SiteDetailView.tsx` currently says never to expose the Site Token publicly, while buildEmbedScript emits it into public HTML. ADR 027 specifies rotation revokes old snippets and documents the live-socket caveat. `sites.status` plus `resolveEffectiveSiteStatus` is s02's live/stale/awaiting-install state. Do not infer verification from content counts or domain-verification DNS state.

s03 is planned only: no account_milestones implementation/migration exists in this checkout. The current publish RPC (`20260924060000_restore_site_wide_publish.sql`) inserts staging_history.action=publish for changed content or attributes. Join staging_history to content_elements via content_element_id, filter content_elements.site_id and action=publish, limit existence query to one. Draft create/update and ordinary discovery content_history rows are not publish evidence.

`site_editors.revoked_at IS NULL` is the active allowlist predicate in editor-directory.ts; pending email grants and site_permissions are different concepts. Existing SiteEditorsCard owns invitation form and delivery feedback. Overview uses /api/sites with a five-row recent list; all sites are available and checklist must not inherit that limit. SiteDetailView gets selected site data. Existing /api/edit-sessions/create is the dashboard edit entry; no new edit-auth path is needed. Verified create route returns an expiring rcf_edit_token in editUrl, consumed and stripped by the embed. The A-29 tokenless link change belongs to a different path; do not assume it changed this endpoint.

## Boundaries and traps

Reuse authenticated site-admin authorization precedent from regenerate-snippet before any service-role site-scoped read. No credential data is returned by the new progress API. Unknown/query error is error, never false success. Existing overview list stats intentionally fail soft; do not repurpose edits_count as publish evidence. Persist per-user/site dismissal using a distinct top-level Supabase user_metadata boolean key, never an authorization signal; update just that key to avoid overwriting concurrent other-site dismissals. No migration needed.

Audit closeout rows A-25/D3 concern token lifetime/rotation already implemented by s29; this story corrects dashboard copy, not token verification. Existing UI failing markers target registration trimming, unrelated accessibility and toolbar behavior; no existing failing marker is in this scope. Preserve every guard.

## Browser action detail

[MDN Window.open](https://developer.mozilla.org/en-US/docs/Web/API/Window/open) confirms that `noopener` returns null even when a new window opens, and popup creation must occur directly within a user gesture. Pre-open a blank window synchronously, detach its opener, then navigate it only after the edit-session response has passed URL validation; close it on failure. A null return from that initial open is then a valid popup-blocked signal.

## Verification

Setup installs root and server. Test/build environment must be extracted from ci job placeholders, with no .env copied. Targeted Jest during implementation; full precommit once at end, build, embed freshness/gzip, audit:prod. Keep existing 44 Playwright count unchanged: no spec added because component/API tests directly cover this bounded feature and local disposable E2E services are not established. Complexity 3, no structural dependency or schema addition. Five-minute GTM goal still needs a timed user journey after independent review/ship.
