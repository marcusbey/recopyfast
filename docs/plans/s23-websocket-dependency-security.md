---
validated: yes
---

# s23 — Clear the realtime server audit

No UI design or architectural decision. Validated by the user's explicit "yes" on
20 September 2026 after the three plan links and summaries were presented.

## Tasks

- [x] Capture the baseline server audit failure and exact Express/body-parser/qs versions.
- [x] Raise only the server Express floor from `^4.22.2` to `^4.22.3` and regenerate the server
  lock with Node 24/npm. Confirm Express4.22.3, body-parser1.20.8 and qs6.16.0; inspect every
  incidental lock change. Do not change Socket.IO, server behavior, Fly configuration or root deps.
- [x] Add a blocking CI step/job that runs clean server install and
  `npm audit --omit=dev --audit-level=moderate` inside `server/`; keep the root audit unchanged.
- [x] Prove audit zero, clean install, server manifest test, real server integration test, root
  precommit/prepush and Docker `/health` smoke. Add no behavior test merely to bless lockfile churn.
- [ ] Commit one story, obtain fresh review, push a draft PR and require actual CI to pass.
- [ ] Under the user's completion authorization, squash-merge only after review/CI, deploy the
  `server/` image to existing Fly app `recopyfast-ws`, preserve one-machine topology, and verify
  exact release, `/health`, main app readiness and two-client websocket propagation. Roll back to
  the captured prior Fly release if health or propagation fails.

## Boundaries

No Express5, dependency override, migration, secret change, product feature, Vercel release or
machine scaling. Do not weaken any audit/test gate. Work stops for plan revalidation if source
compatibility requires more than manifest/lock/CI/docs changes.
