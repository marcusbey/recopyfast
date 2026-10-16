# ADR 072 — Payment analytics reconciles existing billing evidence

Status: accepted within the human-validated s112 plan; implementation requires independent review.
Date: 2026-10-12.

## Decision

A separate authenticated cron reads successfully processed billing events, verifies original event and authoritative Stripe object mode, and normalizes recognized collected cash. It never invokes financial mutations or changes webhook success. A private `analytics_delivery_sources` receipt records only bounded normalization claims, retry timing, outcome and an optional outbox reference. Discovery is an indexed anti-join with no source-age cursor; new and retry slots are reserved independently. Expired normalization claims may be reclaimed because this phase never sends Google requests.

The s111 outbox remains the sole delivery ledger. Canonical live invoice or one-off PI source keys freeze either one pre-occurrence same-account context or explicit absence. An opaque transaction UUID is assigned once and reused by refunds. Context cleanup cannot choose a different device later. The source completion transaction shares s110's context lock and checks account existence under a narrow service-only definer function; this is necessary to read/key-lock `auth.users`, not to grant a browser authority over payment evidence.

A refund reuses its purchase context and can send only after that purchase has accepted HTTP. Sending/uncertain purchases hold corrections for reconciliation; known-unsent purchases suppress corrections. Both current consent and occurrence eligibility still apply. A later automatic duplicate-protection return cancels pending acquisition, leaves already-sent history intact on the wire and can enqueue a correction for the known-sent parent. It does not make the returned charge a successful acquisition in first-party metrics.

The first-party readout normalizes existing billing evidence independently of consent or GA delivery. Historical paid status survives genuine refunds and current entitlement revocation. Automatic returned duplicate charges are the acquisition exclusion. Unknown history yields lower bounds; unknown refund/dispute overlap yields unknown net money. No new financial ledger is introduced.

## Rejected alternatives

- Enqueueing inside monetary handlers would couple analytics failures to provisioning/refund retries.
- A timestamp overlap would permanently miss an old event marked processed later.
- Reading only GA rows would erase unconsented paying accounts and misclassify returning customers.
- Reusing an entire PI amount for every invoice, assuming invoice credits are new cash, or giving every refund the latest charge-event timestamp would invent financial/attribution evidence.
- Retrying uncertain Google sends would risk duplicate conversions. Reclaimable normalization is a different state machine.
- Retaining GA client identity beyond consent expiry merely to correct revenue would violate the approved retention boundary. GA therefore cannot be called the complete net-revenue ledger.

## Bounds and limitations

The cron handles at most two source attempts, reserving one new and one retry slot. Read adapters enforce 1.5-second provider timeouts, no SDK retries, a 10-second source deadline and a source-wide read budget. Catalog awaits are separately bounded without modifying billing callers. Larger/incomplete histories, unsupported currency, mixed credits, ambiguous partial allocation and missing causal refund evidence remain explicit completeness diagnostics. Provider validation and isolated QA receipt are release gates; no synthetic production purchase or real test charge is permitted.
