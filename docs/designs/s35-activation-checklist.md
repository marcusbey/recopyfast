# s35 — Activation checklist

Design source: `docs/design-system.md`, existing overview, SiteDetailView, SiteEditorsCard.
Operator-approved scope, 2026-09-25. Goal: guide a new account to a client publishing an edit in under five minutes; this is a product goal, not a measured performance claim.

## Layout and actions

A compact Card for each owned/admin site on the dashboard overview, including sites beyond the five recent-site rows. The same component appears near the top of site detail. Heading: site name, then “Get your client publishing”. Three semantic list rows: “Install detected”, “Invite a client”, “First published edit”. Each complete row has a success StatusBadge and no action. Each incomplete row has exactly one main action: “Copy snippet”, “Invite a client”, “Open site in edit mode”.

Use Card, Button, StatusBadge, Skeleton, Alert and Dialog primitives; Instrument Sans, text-title/text-sm, token surfaces, teal primary, gap-4/p-6, responsive stacked rows. No new primitives, animation, hardcoded colours, or dependency.

The invite action opens a Dialog containing the existing SiteEditorsCard and its InviteEditorForm; focus moves into the form. Preserve existing invite error and permissions behavior. Edit action uses the existing authenticated edit-session route and opens the site's edit URL, with inline error handling. Copy uses the issued embed snippet, including locally regenerated credentials on detail.

## States

Loading: shaped Skeleton. Error: inline destructive Alert with Retry; unknown data never becomes a completed or empty checklist. All three facts true: replace checklist with a single success “Live” state. Dismissed incomplete site: no checklist, persisted per signed-in user and site. Saving dismissal failure: keep checklist and show retryable error. Completion takes precedence over dismissal. Non-admin users do not see owner onboarding actions. Refresh on returning from external edit mode and after invitation; bounded refresh while incomplete lets install/publish progress appear without reloading. Prevent late responses from one site/account showing in another.

## Token copy

“ This token identifies your site to ReCopyFast. It is visible in your page’s HTML by design. Only your registered domain can use it. Regenerate snippet revokes old snippets; replace the snippet on your site afterward.” Use no leading space. Retain ADR 027's existing rotation confirmation about already-connected WebSockets. Do not relabel any secret API key as a public token.

## Design system gaps

None. Inline Alert supplies feedback. Existing primitive composition is sufficient.
