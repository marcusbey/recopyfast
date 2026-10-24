---
validated: yes
story: s122-install-detected-email
---
# "Install detected" email to the site owner

Owner request 2026-10-24: 'can we start implementing the solutions' (s120 research: owner gets an 'Install detected' email after their developer installs)

Goal: when a site flips to `live` for the first time, its owner learns it from their inbox,
not by checking the dashboard — the missing last step of the s120 developer handoff, where
the owner never sees the install happen. Branch `feature/s122-install-detected-email`, based on
main `230a0ea6` (#120). Embed allocation 0 bytes.

- [x] Trigger: `POST /api/content/[siteId]` schedules `notifyOwnerOfInstall(siteId)` in
      `after()` beside DataFast `script_installed`, only when `markSiteLive` reports the
      transition (ADR 006 guarded update, ADR 074 hook point). Not on the response path
      (ADR 010); a thrown or failed send never reaches the check-in.
- [x] Ledger: migration `20261024120000_site_install_emails.sql` — `site_install_emails`,
      primary key `site_id` (cascade with the site), `pending | sent | failed`, short
      `error_code` constrained to `^[a-z_]{1,64}$` so no address can be stored. RLS on,
      service-role only, no web principal privilege (ADR 002 / datafast_visitors shape).
      Claimed before the provider call (ADR 011), `ON CONFLICT DO NOTHING`; not reclaimable,
      because nothing re-fires the trigger and a second email is the defect.
- [x] Module `src/lib/sites/install-detected-email.ts`: provider check before the claim; owner =
      earliest `admin` row in `site_permissions`; address via `resolveUserIdentity` (Admin API);
      claim error (including a missing table) skips the send; Sentry `captureMessage` with stage
      and code tags only, never an address or provider message.
- [x] Renderer `sendInstallDetectedEmail` in `src/lib/email/resend.ts` (existing Resend
      integration): subject "Your site is connected — you can edit it now", domain and site name
      (escaped, single-line), one "Open your dashboard" button to
      `/dashboard/sites/<id>` stripped of query and fragment — never an edit, staging or session
      link (s76, ADR 027) — three tips (Edit website → click text, Publish, Changes → revert) and
      the developer thank-you line. No claim that edits survive a redesign.
- [x] Preferences: none exist in the repo (ADR 011's digest preference table never shipped);
      this is a one-time transactional confirmation, so nothing to consult.
- [x] Tests: unit suite (once on first flip, duplicate on later calls, one send under 5
      concurrent calls, no resend after a failure, token-free single link, copy, escaping,
      missing table skips, no provider claims nothing, never rejects); route suite (scheduled
      after the response, only for the flipping report); PG17 replay suite (one claim wins a
      race, failed row still blocks, constraints, privileges, cascade), registered in
      `scripts/run-db-invariants.mjs`.
- [x] Run lint, type-check, format:check, full Jest, the PG17 migration replay and the
      production build.
- [ ] Merge and deployment: manual, separate from this plan.

Deploy order: apply the migration before (or with) the code. If the code lands first, the
claim fails on the missing table and the send is skipped — those sites get no email, nothing
breaks, nothing is sent twice.

Rollback: revert the code; the table can stay (additive, unused).
