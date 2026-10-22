# Reviewed-fixes release proposal review — 2026-10-12

Independent review of the operator-local proposal
`docs/plans/reviewed-fixes-release-batch-2026-10-12.md` and preserved operator artifacts under
`.omx/release-batches/2026-10-12/`. These active operational artifacts are not included in this
public archive; the paths identify what the reviewer inspected at capture. This is readiness to request owner
approval, not authorization to merge or write production.

The first pass found ambiguity around duplicate deletion, executor atomicity, refreshed-head
authority, schema-cache proof and rollback authority. The revised proposal now refuses duplicate
groups under the A/B write lock, identifies an exact hash-pinned executor, limits routine conflict
resolution to mechanical preservation, proves non-writing RPC probes, and requires a new owner
decision for an unidentified production rollback.

A second pass reproduced two implementation defects in the operator preparation: a later
migration version was checked only in preflight, not under the ledger lock, and a PostgreSQL
socket path exceeded the platform limit when the test artifact lived in the durable worktree.
Both were corrected before any release authorization request.

The final independent re-review verified:

- Wrapper SHA-256: `6abf158314ea1de22d2ecc82ad567e505ce462a5241302ff071a9c308a7ea61b`.
- Harness SHA-256: `93056bed56d27639210ca9db3ef08c9d1fecb4d80d1728ae3e743b22536e9daa`.
- The later-version guard executes inside the ledger-locked transaction before migration SQL.
- Both out-of-order ledger regressions preserve DDL, data and ledger fingerprints.
- The disposable cluster/socket uses a short, uniquely owned `os.tmpdir()` path.
- The exact preserved-worktree harness command passed **11/11** on Node 24.14.0 and PostgreSQL
  17.11, including atomic rollback, no-overwrite, concurrent executor refusal, duplicate
  preservation, exact migration/ledger bytes and non-writing service-role RPC semantics.
- Temporary cluster state was removed and artifact hashes remained unchanged.
- The fixes did not broaden merge, migration, deployment, rollback or customer-data authority.

No production system was accessed by the independent verifier. The parent separately recorded
read-only production metadata and aggregate preflight evidence in the release proposal. Actual
PostgREST cache proof and deployment postflight remain execution-time obligations after approval.

Max severity: none
Release proposal ready for owner approval: yes
