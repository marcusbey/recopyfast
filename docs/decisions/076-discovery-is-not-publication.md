# ADR 076 — Discovery candidates are omitted from public delivery until published

- Status: accepted
- Date: 2026-10-27
- Scope: story s126-site-token-write-paths
- Accepted by: owner in chat, 2026-10-28
- Amends: ADR 046's original-content fallback and inclusion of unpublished rows.
- Numbering: highest checked-in numbered ADR is 074; 075 is reserved by s125. Recheck at merge.

## Context

H2 discovery accepts public site tokens and forgeable request origins. It currently seeds published
copy and href/alt. The widget suppresses equal-to-original text but applies attributes; the public
snapshot tells integrators to render the original fallback. Setting published content to NULL
alone leaves that fallback and attribute path open. ADR 046 intentionally guarantees parity
between the content GET and snapshot, including this fallback, so the security repair changes a
published integration contract.

## Decision

Discovery inserts NULL `published_content`. Both public read surfaces omit rows with
NULL `published_content` entirely, including their metadata, and never derive public display
content from a discovered original. Non-NULL values, including empty strings and legacy values
without `published_at`, keep the existing projection. Private-field rejection precedes filtering.
The content GET uses this projection for session callers too; authenticated candidate review
belongs to the staging/site-content APIs. Staging may fall back to original content for review,
never as an implicit public override. Existing authorized save/publish remains the promotion path.

`GET /api/v1/content` follows the same delivery rule: it omits NULL-publication candidates rather
than returning them with fallback text or an "unpublished" flag. API-key integrations therefore
receive only rows that have an explicit publication, including an intentional empty string.

Discovery metadata retains only non-publishable bookkeeping such as element type and page
provenance. It does not store caller-supplied href or alt: the publish RPC merges existing
metadata on a text-only publish, so keeping those attributes would let a site-token holder plant
a destination that an editor later promoted without reviewing it.

This is a correction to ADR 046 only, not a new authorization mechanism. Upload adopts ADR 035's
existing editor credential pattern and ADR 041's owner gate; those do not need new decisions.

## Considered options

- **Only write NULL.** Rejected: both public reads still produce candidate text and attributes.
- **Only teach the widget to ignore NULL.** Rejected: SSR and other snapshot consumers remain
  exposed; the API contract still describes candidate copy as published.
- **Return rows with null/empty display fields or a new flag.** Rejected for this bounded fix:
  existing renderers may blank host copy, ignore the flag, or fall back to original. A new flag
  does not revoke the unsafe old contract. An absent override naturally preserves host markup.
- **Require editor credentials for discovery.** Rejected: ordinary visitor discovery/install
  detection would stop, contrary to the requested product behavior.
- **Use publication timestamps or erase legacy equal-to-original rows.** Rejected: historical
  legitimate writers may lack timestamps, and equality does not establish malicious provenance.

## Consequences

New discovery cannot affect either public renderer before authorized publication. Existing
non-NULL records are preserved; this does not remediate historical poisoning or certify it absent.
L1 A/B auto-completion remains a separate indirect-publication risk.

`POST /api/ai/translate` writes translated rows without `published_content`. Those rows are now
omitted from the widget read, the unauthenticated snapshot and v1 delivery until an editor
publishes them. This is intentional: the route has no live product caller (s40 research), and
translation output is candidate content rather than authority to publish. Making translation
publish immediately would create a new authorization contract outside this security repair.

NULL rows no longer populate the widget's server-known-id set on a later page load, so visitors
may re-report those discoveries until publication. Existing client coalescing and fail-closed
server limits bound this, but high traffic can delay genuinely new discoveries. The owner accepted
this tradeoff on 2026-10-28; an optimized discovery acknowledgement protocol is separate work.

Editor staging needs a private original-text fallback. Regression coverage must prove a newly
NULL row can still be reviewed, saved and published with text/attributes. Public caching,
retraction bounds and page/shared scoping do not change. No migration or retrospective cleanup
is authorized by this decision.
