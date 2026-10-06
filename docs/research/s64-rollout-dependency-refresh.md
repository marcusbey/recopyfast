# Research — s64-rollout-dependency-refresh

Fresh npm production audits on 2026-10-06 against exact main `719eb45` locks report root:
proxy-addr critical, sharp high, source-map-js high; server: proxy-addr critical. Both
s59/s60 independent clean installs reproduced this registry drift. No feature source caused it.

Primary advisories: GHSA-jqcg-44mw-7w3h (proxy-addr IPv4-mapped IPv6 trust subnet spoofing),
GHSA-wq5f-xc86-pv6w (sharp/librsvg CVE-2026-96889), and GHSA-68fv-2mgg-jv7q
(source-map-js indexed section offsets causing event-loop denial of service). npm metadata
reports within-range fixes for proxy-addr 1.1.0–2.0.7, sharp <0.35.5 and
source-map-js 1.0.0–1.2.1.

Root uses existing Next/sharp override and Express tree; server has a separate Express lock.
Patch generated resolutions only, preserving manifests and application behavior. Root/server
clean installs and audits prove both trees; shared source widget must remain byte-identical.
No UI design or new architecture is required. Complexity 2. No production DB/env mutation.
