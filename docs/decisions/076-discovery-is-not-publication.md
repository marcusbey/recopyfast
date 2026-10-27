# ADR 076 — Discovery candidates are omitted from public delivery until published

- Status: proposed — awaiting owner validation of s126; not implemented
- Date: 2026-10-27
- Scope: story s126-site-token-write-paths
- Amends on acceptance: ADR 046's original-content fallback and inclusion of unpublished rows.
- Numbering: highest checked-in numbered ADR is 074; 075 is reserved by s125. Recheck at merge.

## Context

H2 discovery accepts public site tokens and forgeable request origins. It currently seeds published
copy and href/alt. The widget suppresses equal-to-original text but applies attributes; the public
snapshot tells integrators to render the original fallback. Setting published content to NULL
alone leaves that fallback and attribute path open. ADR 046 intentionally guarantees parity
between the content GET and snapshot, including this fallback, so the security repair changes a
published integration contract.

## Decision

Propose: discovery inserts NULL `published_content`. Both public read surfaces omit rows with
NULL `published_content` entirely, including their metadata, and never derive public display
content from a discovered original. Non-NULL values, including empty strings and legacy values
without `published_at`, keep the existing projection. Private-field rejection precedes filtering.
The content GET uses this projection for session callers too; authenticated candidate review
belongs to the staging/site-content APIs. Staging may fall back to original content for review,
never as an implicit public override. Existing authorized save/publish remains the promotion path.

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

NULL rows no longer populate the widget's server-known-id set on a later page load, so visitors
may re-report those discoveries until publication. Existing client coalescing and fail-closed
server limits bound this, but high traffic can delay genuinely new discoveries. This tradeoff
requires owner acceptance; an optimized discovery acknowledgement protocol is separate work.

Editor staging needs a private original-text fallback. Regression coverage must prove a newly
NULL row can still be reviewed, saved and published with text/attributes. Public caching,
retraction bounds and page/shared scoping do not change. No migration or retrospective cleanup
is authorized by this proposal.
