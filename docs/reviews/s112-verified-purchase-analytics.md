# Review — s112-verified-purchase-analytics

Date: 2026-10-12 (Toronto). Initial independent review of the local s112 diff against
reviewed s111 base1e3af6bc5326e46530d566d23683cc042a0aa690. Findings refer to the pre-fix
snapshot; ongoing owner repairs require fresh verification. No release is permitted yet.

## Critical findings

1. The payment migration replaces zero-argument claim_analytics_delivery with a commerce
claim. An older s111 worker always calls sendSignupMeasurement and can permanently finalize
commerce after emitting the wrong event. Preserve the old signup-only contract and use a
versioned entrypoint for the new worker; changed Vercel env does not update running deployments.
2. payment-metrics.ts reports an exact net total for incomplete histories. An incomplete empty
history returns0; an incomplete history with known rows returns the subset sum as total.
An isolated regression reproduced this. Total net must be unknown when history/account scan
coverage is incomplete; any observed subset needs a distinct qualified field.
3. payment-source.ts rejects all taxed invoice refunds and all split-payment refunds, including
provable full returns. Isolated fixtures reproduced a full$20.90 return ($19 product+$1.90 tax)
and a full$38 return across two$19 invoice allocations. Both allocations are knowable. The
normalizer also reports unknown net for fully returned split payments where each net is0.
Support full proven allocations, retain unknown for ambiguous partial returns, and scope
refund deduplication to refund plus canonical parent when one refund fans out.

## Major finding

T5 readout lacks separate successful-refund totals, evidence-based subscription renewals,
and a current paid-entitlement snapshot. Returning payments includes repeat credit/lifetime
purchases and is not a renewal count. Merely noting entitlement is separate does not supply
the planned readout. Implement the defined metrics or explicit unknown coverage honestly.

## Verification and ownership

Independent Node24.14.0 run passed413 tests across23 focused suites. Native PostgreSQL17
replay passed163 assertions across19 suites, one existing PostgREST-only skip. Mocked QA
command tests passed11. Inverting independent livemode checking in an isolated copy caused
35 existing failures and was restored byte-for-byte. New isolated incomplete-net regression
failed once; the two full-refund cases failed. Shared source was never mutated by reviewer.
The reviewer stopped its owned full-suite run when concurrent repairs began; mixed-snapshot
output is not final evidence. Logs: /tmp/s112-independent-*.log and /tmp/s112-review-*.log.

A source deadline/history-read budget concern is being checked, not yet independently
classified as a reproduced defect. Owner also identified that previous_attributes.refunds
requires explicit has_more=false before inferring a new final-state transition.

No credentials, real provider requests, production changes, commits or pushes were performed
by the review. Final repairs, full gates, base alignment, provider QA and deployment remain.

## Independent repair review — passed

The frozen repair snapshot resolves every finding above. Legacy claim retains the original
four-column signup-only contract, while the new dispatcher uses the service-only v2 claim.
Incomplete history/account scans yield unknown aggregate totals with separately named observed
subsets. Proven full taxed and split-invoice refunds preserve product/tax amounts and use
refund-plus-parent deduplication. The readout now distinguishes subscription renewals, returned
cash, automatic returns and current entitlement backed by verified live payment references.
History reads share the source deadline and cache. Refund causality requires explicit complete
previous-list evidence. The migration is one atomic DO statement under executor-owned commit.

Independent Node24.14.0 review passed423 tests across23 analytics suites. Final native
PostgreSQL17 replay passed165 assertions across19 suites, with one existing PostgREST-only
skip. Neutralizing the full-refund repair caused two regression failures; byte-for-byte
restoration returned7/7 passing. All34 author-owned manifest files were verified against
SHA2560ccb090ac9df77c0f4a91458d7e2fdcd80b231c27e81e72506950006a3153e84.
Manifest: /tmp/s112-review-source-manifest.sha256. Migration SHA256:
73c5b55ebfc9538d317cd4fc8cfa29a52032f6e177dc39a7d54f46c21744bef8.
Merged base398735f is byte-equivalent to reviewed dependency1e3af6. No source changes were
made by the reviewer. Logs: /tmp/s112-independent-repair-jest.log,
/tmp/s112-independent-final-pg.log, /tmp/s112-repair-mutant.log and
/tmp/s112-repair-restored.log.

Owner's complete local suite passed7,977 tests /534 suites with38 inherited skips; coverage
statements77.10%, branches71.21%, functions75.20%, lines77.85%. Floors were raised from
67/71/74/73 to70/74/76/76 (branches/functions/lines/statements), not lowered. Build, full and
production typechecks, format, lint(0 errors/33 inherited warnings), production audit and
11 mocked QA command tests passed. The final SQL framing change was replayed independently.
Normal commit/push hooks still run on the final tree.

This is implementation approval. Hosted CI, provider validation and real QA ingestion,
reviewed production migration/deployment and genuine live-customer observation remain distinct
release evidence. No fixture or QA purchase may be reported as production traction.

Max severity: none
Ship allowed: yes
