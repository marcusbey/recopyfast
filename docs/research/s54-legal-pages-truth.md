# Research — Story s54-legal-pages-truth

Researched 2026-09-28 against `main` at `7c21d00` (s50 merged) and production
`https://www.recopyfa.st` (read-only `curl`/`openssl`/`dig`). Production matches `main` for both
pages: the live `/privacy` HTML contains "SOC 2 Type II", "SIEM integration", "Role-based access
control", "audit logs for compliance", "EU Representative" and 16 occurrences of
`privacy@recopyfa.st`, exactly as `src/app/privacy/page.tsx` renders them.

## The five structuring facts

1. **The security sections are boilerplate the product never had.** SOC 2 Type II
   (`privacy/page.tsx:275-277`), MFA "enforcement" while the settings page says two-factor is "Not
   available yet" (`src/app/dashboard/settings/page.tsx:362-366`), TLS 1.3 "or higher" while both
   production hosts negotiate TLS 1.2 (openssl, below), end-to-end and client-side encryption that
   exist nowhere in the code, a 24/7 SOC, IDS/IPS, and "99.9% uptime with redundant
   infrastructure" for a WebSocket service that is one machine by design (`server/fly.toml`,
   ADR 026). The fix is mostly deletion, plus five true replacements that are each verified here.
2. **The graveyard names are few and confined to these two pages.** Audit logs (`privacy:165`,
   `:311`; `terms:177`, `:361`), RBAC (`privacy:297`; `terms:234`), SIEM (`privacy:311`) and
   in-app notifications, i.e. the notification centre (`terms:384`). A grep of `src/app`,
   `src/components` and `src/lib/compare` (API routes excluded) finds these terms, and SOC 2,
   GDPR/CCPA, 99.9% or "Data Protection Officer", on no other page. A guard that renders the two
   pages is exact.
3. **The sub-processor list is wrong both ways.** It names "AWS, Google Cloud" and an "analytics
   service" (`privacy:232-236`). Nothing runs on Google Cloud and there is no analytics SDK. It
   omits the providers that do receive personal data: Vercel, Supabase, Fly.io, OpenAI, Upstash
   and Sentry. The story's AC 3 requires the real list.
4. **Retention, deletion and termination promises have no mechanism behind them.** There is no
   account deletion anywhere (the settings tabs are Profile, Notifications, Security, API,
   Appearance: `settings/page.tsx:173-192`). The only crons are blog generation and webhook
   dispatch (`vercel.json`), and no migration schedules `pg_cron`. Raw IPs are stored in
   `edit_sessions` (`src/lib/auth/edit-sessions.ts:104`). "7 years", "12 months", "90 days",
   "30 days to export" and "cryptographic erasure" all go. Where that empties a section the law
   expects (retention, transfers), the section stays with only what is true, and the owner reviews.
5. **Some gaps are ones the product owner's rule forbids us to fill.** Neither page names the
   data controller (legal entity, address, country) or a governing law. The widget sets a 1-year
   `rcf_vid` cookie on every visitor of every customer site (`public/embed/recopyfast.src.js:955-958`,
   `:3218-3237`), for the parked A/B feature, and neither page says so. No DPA with any provider
   is on record. Terms §10 makes s54 itself a "material change" with a 30-day notice. All of
   these go to the owner and legal list in the plan. None is written into the pages.

## Target story

`docs/stories.md:1988-2002`. Product owner decision on 2026-09-28, from the s50 review
(minor 4). Complexity 2. Branch `feature/s54-legal-pages-truth`. Launch-relevant: it must be done
before the public launch posts. Embed allocation: 0 bytes.

- [ ] /privacy and /terms make no claim about features the product does not have: audit logs,
  role-based access control, SIEM integration, or any other PRD-graveyard item.
- [ ] The "EU Representative" and any other named role or entity that does not exist is removed
  or replaced by what is true. Every contact line uses `privacy@recopyfa.st` or
  `support@recopyfa.st`.
- [ ] The processing and security sections describe the actual stack (Supabase, Stripe, Vercel,
  Fly, OpenAI) without overstating certifications or controls.
- [ ] A guard test fails if a graveyard feature name reappears on either page. Required local
  gates pass. One story commit. Legal wording is conservative: remove over invent.

Product owner rule for this story (orchestrator brief): legal wording is conservative, so remove
rather than invent. Never add a new legal commitment. Where removing would leave a legally
necessary section empty, keep the section, say only what is true, and send it to owner/legal
review.

## Current state of the code

Both pages are static server components (no `"use client"`, no data fetching, no `metadata`
export). Each renders `Header`, a hero with dates, three summary cards, numbered `<section>`
cards, and `Footer`. `src/app/privacy/page.tsx` has 550 lines; `src/app/terms/page.tsx` has 510.
Their history: created in `bde44cf` (2025-08-13), rewritten in `f867b2c` (2025-08-22), recoloured
in `db276ec`, and addresses moved to `recopyfa.st` by s50 in `9bddcee` (2026-09-28). s50 changed
only `href`s, link text and one status-page bullet. The bodies were deferred to this story.

They are linked from `Footer.tsx`, `login/page.tsx:63-67` and `signup/page.tsx:48-52`. Signing
in binds the user to them.

### Classification rule

- **Statements of fact** about the product or its infrastructure get **TRUE** or **FALSE** from
  code, config or live infrastructure. They get **UNVERIFIABLE** when no evidence can exist in
  the repo or on public infrastructure: third-party agreements, processes, audits.
- **Commitments** (promises about our future behaviour) are **UNVERIFIABLE** by nature.
  - **Keep** one only if the owner can honour it by hand today with what exists: a mailbox, an
    email to users.
  - **Remove** one that depends on a process, system, team or agreement that is not in evidence.
  - Every kept commitment goes on the owner/legal list.
- **GRAVEYARD**: a feature frozen in `docs/prd.md:134-148`, with no customer surface.
- **Not counted**: framing ("Your privacy matters"), statements of purpose ("to provide customer
  support"), legal bases and reservations ("to comply with valid legal processes"), and user
  obligations or prohibitions (Terms §3, §4, §6.2 except passwords).

### Evidence used more than once

- **E-TLS.** On 2026-09-28, `openssl s_client -tls1_2` succeeded against both
  `www.recopyfa.st` (`ECDHE-RSA-AES128-GCM-SHA256`) and `recopyfast-ws.fly.dev`
  (`ECDHE-ECDSA-AES256-GCM-SHA384`), and so did `-tls1_3`. `http://www.recopyfa.st` returns 308
  to HTTPS, and `/privacy` sends `strict-transport-security: max-age=63072000` with
  `server: Vercel`.
- **E-SB.** supabase.com/security (fetched 2026-09-28): "All customer data is encrypted at rest
  with AES-256 and in transit via TLS." supabase.com/docs/guides/platform/backups: "Pro Plan
  projects can access the last 7 days of daily backups … We recommend that free tier plan
  projects regularly export their data". The project's Supabase plan is not recorded in the
  repo, and `docs/operations/database-setup.md:176` ("7 days of backups on free tier, 30 days on
  Pro") contradicts Supabase's own page.
- **E-2FA.** `settings/page.tsx:334-340` (comment: "ReCopyFast signs in with magic links only —
  no password is ever set … 2FA is likewise not implemented") and `:362-366` ("Two-factor
  authentication / Not available yet"). Owners sign in with `signInWithOtp`
  (`src/contexts/AuthContext.tsx:88`). Invited editors use a one-time code
  (`api/editor/request-code`, `api/editor/submit-code`).
- **E-ENC.** Neither `src/`, `supabase/migrations/` nor the widget contains application-level
  encryption. `grep -i "encrypt|createCipher|crypto.subtle"` finds only a placeholder string at
  `src/lib/audit/logger.ts:417`.
  - User API keys are stored as a SHA-256 hash (`src/app/api/api-keys/route.ts:146-150`).
  - Webhook secrets are stored in plaintext, on purpose (`src/lib/webhooks/manager.ts:146-149`).
  - Edit tokens sit in plaintext `sessionStorage` (`recopyfast.src.js:110-135`).
- **E-CRON.** `vercel.json` schedules `generate-blog-post` and `webhook-dispatch` only. No
  migration uses `pg_cron`. Nothing deletes, anonymises or purges data on a schedule.
- **E-DEL.** There is no account deletion: no route, no `auth.admin.deleteUser`, and no settings
  tab (`settings/page.tsx:173-192`). What is self-serve:
  - site deletion (`src/app/dashboard/sites/page.tsx:216`);
  - content export (`BulkOperations`, rendered at `SiteDetailView.tsx:482`);
  - subscription cancellation (`SubscriptionCard.tsx:87`).
- **E-OPS.** `docs/operations/deployment-checklist.md` still lists "Database backups are
  scheduled" (:149) and "Backup procedures are in place" (:213) as unchecked boxes, and
  "Document incident response procedures" (:177) as a recommendation. There is no incident,
  disaster-recovery, pen-test, access-review or SOC 2 document anywhere in `docs/`.
- **E-GY.** PRD graveyard: "Teams with org roles" (`docs/prd.md:139`); "Audit log / compliance
  console (`/api/audit/*`)" (`:141`); "Notification centre (`/api/notifications`)" (`:145`).
  - `/dashboard/teams` has redirected since s04.
  - No page or component calls `/api/audit/*`. The only writer is `POST /api/audit/logs`
    (`route.ts:123`), which has no caller.
  - `NotificationCenter.tsx` is imported by nothing under `src/app`.
  - What shipped instead of roles: per-site View, Edit, Publish or Admin for each editor
    (`InviteEditorForm.tsx:40-43`).

## Claims inventory

### /privacy: `src/app/privacy/page.tsx`

| ID | Where | Exact text | Verdict | Evidence | Action (exact new text) |
|---|---|---|---|---|---|
| P1 | :34, :38 | "Effective: August 22, 2025" · "Last Updated: August 22, 2025" | **FALSE** | s50 changed the page on 2026-09-28 (`9bddcee`). | **Reword** both dates to the story commit's date, as "Month D, YYYY" (Q1). |
| P2 | :48-52 | card "Encrypted Data" / "AES-256 encryption at rest, TLS 1.3 in transit" | **FALSE** (TLS 1.3) | E-TLS: 1.2 is accepted. At-rest is Supabase's (E-SB). | **Reword** text: "AES-256 at rest in our database, TLS in transit" |
| P3 | :56-59, :192-194 | "We never sell your personal information" · "Zero-Sale Policy: We never sell, trade, or rent…" | TRUE | No ad, analytics or data-broker integration in `package.json` or the source (grep for GA, gtag, PostHog, Plausible, Mixpanel, Hotjar, Segment, Vercel Analytics: none). | keep |
| P4 | :63-66 | card "Your Control" / "Export or delete your data anytime" | **FALSE** | E-DEL: no account deletion; export covers site content. | **Reword** text: "Export your site content or delete a site anytime" |
| P5 | :80-86 | "Privacy by Design: We collect only the minimum data necessary… privacy-preserving technologies wherever possible." | **FALSE** | The widget sets a 1-year `rcf_vid` cookie on every visitor of every customer site for A/B testing, a feature with no surface (`recopyfast.src.js:955-958`, `:3218-3237`). Raw IPs are stored (P9). | **Remove** the callout `<div>`. |
| P6 | :93-106 | 1.1: email and profile; site domains; content modifications and version history; payment information via third-party providers; support communications | TRUE | Supabase Auth; `sites`; `content_history`/`content_versions`; hosted Stripe Checkout (no `loadStripe`, no card fields); the support mailbox. | keep |
| P7 | :107 | "API keys and integration settings (encrypted at rest)" | **FALSE** | E-ENC: API keys are hashed; webhook secrets and site signing keys are plaintext columns. | **Reword:** "API keys and integration settings" |
| P8 | :114 | "Usage analytics and feature interaction data" | TRUE (narrow) | Public API calls are written to `user_activity_logs` with IP and user agent (`src/lib/analytics/tracker.ts:106-117`, from `api/v1/content`). | keep |
| P9 | :115 | "IP addresses (hashed for privacy) and geolocation data" | **FALSE** | IPs are hashed only in log lines (`src/lib/monitoring/logger.ts:11-31`). They are stored raw in `edit_sessions` (`edit-sessions.ts:104`) and `user_activity_logs` (`tracker.ts:113`). Geolocation is derived only by the parked A/B bucket route (`api/ab-tests/bucket/[siteId]/route.ts:82-85`), which runs only for a site with an active test, and nothing creates one. | **Reword:** "IP addresses". Add an inline tombstone: re-add a location disclosure when A/B ships (s11b/s12). |
| P10 | :116-119 | browser and device information; session data and authentication tokens; performance metrics and error logs; security event logs and access patterns | TRUE | User agent in `edit_sessions` (`edit-sessions.ts:105`) and hashed in grants (`editor-grants.ts:176`); Supabase sessions; Sentry errors and 10% traces (`src/instrumentation-client.ts`); per-request logs. | keep |
| P11 | :126-131 | 1.3: website structure and content elements; edit session tokens; script integration status | TRUE | Content-map report (`recopyfast.src.js` `sendContentMap`); `edit_sessions`; `api/domains/verify`. | keep |
| P12 | :132 | "Website performance impact metrics" | **FALSE** | `/api/analytics/performance` has no caller in the widget or the UI (grep). Nothing measures impact. | **Remove** the `<li>`. |
| P13 | :153 | "Process and store content modifications with version control" | TRUE (narrow) | A per-string `content_history` trigger plus site snapshots (s50 B9). | keep |
| P14 | :155 | "Generate AI-powered content suggestions and translations" | **FALSE** (translations) | s50 B2: no translation surface, and visitors are always served `en`. | **Reword:** "Generate AI rewrite suggestions" |
| P15 | :160, :163-164, :166 | heading "2.2 Security & Compliance"; monitor for threats; prevent fraud and abuse; access controls and session management | TRUE | Limiters in 33 API route files; expiring and revocable editor grants. | keep the bullets. **Reword** the heading to "2.2 Security", since P16 and P17 remove every compliance item. |
| P16 | :165 | "Maintain comprehensive audit logs for compliance" | **GRAVEYARD** | E-GY. | **Remove.** |
| P17 | :167 | "Conduct security assessments and vulnerability testing" | UNVERIFIABLE | E-OPS: no record. | **Remove.** |
| P18 | :217-220 | "With essential service providers under Data Processing Agreements (DPAs)" | UNVERIFIABLE | No DPA is on record for any provider. | **Reword:** "With the service providers listed below, who process data on our behalf to run the Service". Owner/legal. |
| P19 | :226-229 | "We work with carefully vetted service providers who assist in our operations:" | UNVERIFIABLE | No vetting record. | **Reword:** "We use these service providers to run ReCopyFast:" |
| P20 | :231-234 | "Cloud hosting providers (AWS, Google Cloud) with security certifications" | **FALSE** | Hosting is Vercel (`server: Vercel`), Supabase and Fly.io (`server/fly.toml`). Nothing uses Google Cloud. | **Replace** with three list items: "Vercel — hosts the website, the API and the ReCopyFast script" · "Supabase — database, sign-in and image storage" · "Fly.io — the real-time editing server" |
| P21 | :235 | "Payment processors (Stripe) with PCI DSS compliance" | TRUE | Stripe is the processor; Checkout is hosted (no `loadStripe` in `src/`). | **Reword** for the list: "Stripe — payments" |
| P22 | :236 | "Analytics services with privacy-focused configurations" | **FALSE** | No analytics service (see P3). Sentry is error monitoring, listed on its own. | **Remove.** |
| P23 | :237 | "Email service providers with encryption capabilities" | TRUE | Resend, sending from `noreply@recopyfa.st` (`src/lib/email/resend.ts:21`). | **Reword:** "Resend — transactional email". Add three items: "OpenAI — generates AI rewrite suggestions from the text you submit" (`src/lib/ai/openai-service.ts:71`; `api/ai/suggest/route.ts:198` sends the text and its context) · "Upstash — rate limiting" (`.env.example:122`, Q6) · "Sentry — error monitoring" |
| P24 | :238-241 | "All providers operate under strict confidentiality and data protection agreements" | UNVERIFIABLE | No agreements on record. | **Remove.** Owner/legal. |
| P25 | :244-262 | 3.3 "we ensure adequate protection through" SCCs, adequacy decisions, "additional safeguards such as encryption and access controls" | UNVERIFIABLE | Transfer mechanisms live in DPAs, and none is on record. The one verifiable fact is that the WebSocket server runs in `iad`, US East (`server/fly.toml`). | **Keep the heading.** Replace the paragraph and list with one `<p>`: "Some of these providers process data in the United States. Our real-time server runs in Fly.io&apos;s US-East region." Owner/legal. |
| P26 | :273-279 | "Security First: We implement defense-in-depth security strategies and maintain SOC 2 Type II compliance…" | **FALSE** | E-OPS: no SOC 2 report or auditor. Supabase's SOC 2 is Supabase's. | **Remove** the callout `<div>`. |
| P27 | :285 | "AES-256 encryption for data at rest" | TRUE (database) | E-SB. The data in Upstash, Sentry and Vercel logs is not covered by this evidence. | **Reword:** "AES-256 encryption at rest for our database (Supabase)" |
| P28 | :286 | "TLS 1.3 encryption for all data in transit" | **FALSE** | E-TLS. | **Reword:** "TLS encryption for data in transit" |
| P29 | :287 | "End-to-end encryption for sensitive operations" | **FALSE** | E-ENC. | **Remove.** |
| P30 | :288 | "Encrypted database connections and backups" | UNVERIFIABLE (backups) | Connections use HTTPS (supabase-js). Backups depend on the plan (E-SB). | **Reword:** "Encrypted database connections" |
| P31 | :289 | "Client-side encryption for edit tokens" | **FALSE** | E-ENC. | **Remove.** |
| P32 | :296 | "Multi-factor authentication (MFA) enforcement" | **FALSE** | E-2FA. | **Reword:** "Passwordless sign-in: a one-time email link for account owners, a one-time code for invited editors" (Q2) |
| P33 | :297 | "Role-based access control (RBAC) systems" | **GRAVEYARD** | E-GY. | **Reword:** "Per-site permissions for invited editors: view, edit, publish or admin" |
| P34 | :298 | "Just-in-time (JIT) access for administrative operations" | **FALSE** | Admin access is a static `ADMIN_EMAILS` allowlist (`.env.example:213`; `api/audit/logs/route.ts:40-47`). | **Remove.** |
| P35 | :299 | "Regular access reviews and privilege rotation" | UNVERIFIABLE | E-OPS. | **Remove.** |
| P36 | :300 | "Zero-trust network architecture" | UNVERIFIABLE | No network design on record. | **Remove.** |
| P37 | :307 | "24/7 security operations center (SOC) monitoring" | **FALSE** | No SOC. Alerting is Sentry only. | **Remove.** |
| P38 | :308 | "Automated threat detection and response systems" | **FALSE** (as stated) | What exists is rate limiting (33 route files) and IP guards. | **Reword:** "Automated rate limiting on the API" (Q2) |
| P39 | :309 | "Regular penetration testing and vulnerability assessments" | UNVERIFIABLE | E-OPS. | **Remove.** |
| P40 | :310 | "Intrusion detection and prevention systems (IDS/IPS)" | UNVERIFIABLE | None configured in the repo. | **Remove.** |
| P41 | :304, :311 | heading "4.3 Security Monitoring & Response"; "Comprehensive audit logging and SIEM integration" | **GRAVEYARD** (+ no SIEM: no log drain configured) | E-GY. | **Reword** the bullet: "Error monitoring with Sentry". Heading: "4.3 Monitoring". |
| P42 | :324 | "5.1 Data Subject Rights (GDPR/CCPA Compliance)" | UNVERIFIABLE | A compliance claim with no audit behind it. | **Reword:** "5.1 Your Data Protection Rights" |
| P43 | :327-356 | the rights list (access, rectification, erasure, portability, restriction, objection, opt-out) | TRUE | Legal rights, honoured by request through `privacy@` (§5.2). Portability is also backed by content export (E-DEL). | keep. Owner/legal: erasure is by hand. |
| P44 | :369-370 | "We will respond within 30 days and may require identity verification for security." | UNVERIFIABLE (commitment) | Can be honoured by hand through `privacy@`. | keep. Owner/legal. |
| P45 | :387-389 | cookies "Essential: Required for authentication and basic functionality" | TRUE | Supabase auth cookies (`src/middleware.ts:117-123`); the editor hub cookie (`api/editor/submit-code/route.ts:112`). | keep |
| P46 | :391-393 | "Performance: Analyze site performance and user experience" | **FALSE** | No analytics cookie. Sentry sets none. | **Remove.** |
| P47 | :395-397 | "Functional: Remember your preferences and settings" | TRUE (narrow) | The theme is kept in `localStorage` (`src/hooks/useTheme.ts:27`, `:57`). | keep |
| P48 | :399-401 | "Security: Detect suspicious activity and prevent fraud" | **FALSE** | No such cookie. Stripe.js is never loaded on our pages. | **Remove.** |
| P49 | :404-407 | "You have full control over cookies through browser settings and our cookie consent banner." | **FALSE** | No cookie banner exists (grep `cookie consent`, `CookieBanner`: none). | **Reword:** "You can control cookies through your browser settings." |
| P50 | :419-426 | "Account Data: Retained for the duration of your account" · "Content Data: Retained as long as needed for service delivery" | TRUE | E-CRON: nothing deletes earlier. These are criteria, not periods. | keep. Owner/legal. |
| P51 | :427-430 | "Usage Analytics: Aggregated and anonymized after 12 months" | **FALSE** | E-CRON. | **Remove.** |
| P52 | :431-434 | "Security Logs: Retained for 7 years for compliance" | **FALSE** | No log archive or drain. Logs live only inside Vercel's and Sentry's own retention. | **Remove.** |
| P53 | :435-437 | "Support Communications: Retained for 3 years" | UNVERIFIABLE | Mailbox retention is not configured anywhere we can see. | **Remove.** |
| P54 | :440-443 | "…secure deletion methods including cryptographic erasure…" | **FALSE** | E-CRON, E-ENC. | **Remove** the `<p>`. |
| P55 | :460-462 | contact heading "Data Protection Officer" | **FALSE** | No DPO (a GDPR Art. 37 role) has been appointed. | **Reword:** "Privacy Requests" |
| P56 | :480-482 | contact heading "Security Team" | **FALSE** | There is no team. | **Reword:** "Security Issues" (the label `/terms` already uses) |
| P57 | :495-513 | "EU Representative" → `privacy@recopyfa.st`, "EU data subject rights & GDPR" | **FALSE** | An Art. 27 representative is a separate entity established in the EU. This block routes to our own mailbox. | **Remove** the block. Owner/legal. |
| P58 | :463-468, :483-488, :523-528 | `privacy@recopyfa.st` (privacy, security) · `support@recopyfa.st` | TRUE once the mailboxes accept mail | Owner-designated in s50. The s50 review saw both bounce; creating them is an operator step (`docs/reviews/s50-homepage-truth.md:282-284`). | keep |
| P59 | :538-540 | "For urgent security matters, we respond within 24 hours." | UNVERIFIABLE | Needs on-call coverage that does not exist. The 30-day part is P44. | **Remove** that sentence. The box keeps "We respond to privacy requests within 30 days." |

*Not counted:* hero framing (:29-30); the purposes in 2.1 other than P13 and P14, and all of
2.3; the legal bases in 3.1 other than P18.

### /terms: `src/app/terms/page.tsx`

| ID | Where | Exact text | Verdict | Evidence | Action (exact new text) |
|---|---|---|---|---|---|
| T1 | :34, :38 | "Effective: August 22, 2025" · "Last Updated: August 22, 2025" | **FALSE** | As P1. | **Reword** both to the story commit's date (Q1). |
| T2 | :54-57 | card "Your Content" / "You own what you create and modify" | TRUE | §5 grants only a limited license. | keep |
| T3 | :60-65 | card "99.9% Uptime" / "Reliable service you can count on" | **FALSE** | No SLA and no uptime measurement; `/status` is a 404 (s50 T7); the WebSocket server is one machine (fly.toml, ADR 026). | **Remove** the card. Change the grid at :44 from `sm:grid-cols-3` to `sm:grid-cols-2`. |
| T4 | :93-96 | "real-time content editing, … AI-powered content suggestions, and collaboration features" | TRUE | Socket.io on Fly (`/health` 200 on 2026-09-28); `api/ai/suggest`; invited editors. | keep |
| T5 | :95 | "multi-language support" | **FALSE** | s50 B2. | **Reword** the sentence: "We provide real-time content editing, AI-powered content suggestions, and collaboration features." |
| T6 | :176-177 | "We actively monitor for suspicious activity" | UNVERIFIABLE | There is no monitoring function, only limiters and Sentry. | **Remove** (together with T7). The notice becomes: "**Security Notice:** Violations of security policies may result in immediate account suspension and potential legal action." |
| T7 | :177 | "and maintain detailed audit logs." | **GRAVEYARD** | E-GY. | **Remove** (see T6). |
| T8 | :228-230 | "All data transmission is encrypted using TLS 1.3 or higher" | **FALSE** | E-TLS. | **Reword:** "All data transmission is encrypted using TLS" |
| T9 | :231 | "Content is stored with AES-256 encryption at rest" | TRUE | E-SB. Content lives in Supabase. | keep |
| T10 | :232 | "Regular security audits and penetration testing" | UNVERIFIABLE | E-OPS. | **Remove.** |
| T11 | :233 | "Multi-factor authentication for account access" | **FALSE** | E-2FA. | **Reword:** "Passwordless sign-in for account owners and invited editors" (Q2) |
| T12 | :234 | "Role-based access controls and session management" | **GRAVEYARD** | E-GY. | **Reword:** "Per-site permissions for invited editors, and session management" |
| T13 | :235 | "Comprehensive logging and monitoring systems" | UNVERIFIABLE ("comprehensive") | Sentry and request logs exist. | **Reword:** "Error monitoring and logging" |
| T14 | :236 | "GDPR and CCPA compliance protocols" | UNVERIFIABLE | No audit, no protocol document. | **Remove.** |
| T15 | :243 | "Maintain strong, unique passwords for your account" | **FALSE** | E-2FA: accounts have no password. | **Remove.** |
| T16 | :245 | "Regularly review and rotate edit tokens" | TRUE (the capability exists) | `api/sites/[siteId]/regenerate-snippet`; editor revocation (`SiteEditorsCard.tsx:339`). | keep |
| T17 | :256, :259-262 | "Service Availability & Business Continuity" / "We maintain a target uptime of 99.9% with redundant infrastructure" | **FALSE** | As T3. | **Remove** the bullet. Heading: "Service Changes". |
| T18 | :263-266 | "Scheduled maintenance is performed during low-traffic periods with advance notice" | UNVERIFIABLE | There is no maintenance process and no notice channel. | **Remove.** |
| T19 | :267-270 | "We implement disaster recovery procedures to minimize service disruptions" | UNVERIFIABLE | E-OPS (backups and incident procedures are still unchecked TODOs), E-SB. | **Remove.** |
| T20 | :271-274 | "We reserve the right to modify or discontinue features with 30 days notice" | UNVERIFIABLE (commitment) | Can be honoured by hand. | keep. Owner/legal. |
| T21 | :275-277 | "Emergency security updates may be applied without prior notice" | TRUE | A reservation. | keep |
| T22 | :302-305 | "Data loss or corruption (though we implement robust backup systems)" | UNVERIFIABLE (backups) | E-SB, E-OPS. | **Reword:** "Data loss or corruption" |
| T23 | :333-336 | "You may terminate your account at any time through account settings" | **FALSE** | E-DEL. | **Reword:** "You may stop using the Service at any time: cancel your subscription from Billing, and ask us to delete your account at privacy@recopyfa.st", with the address as a `mailto:` link styled like the others. This points to the erasure right that already exists (privacy §5.2) and adds no new commitment. Owner/legal. |
| T24 | :355-357 | "We provide 30 days to export your data after account closure" | UNVERIFIABLE | E-DEL: there is no closure flow to hang a grace period on. | **Remove.** |
| T25 | :358 | "All edit tokens are immediately invalidated" | UNVERIFIABLE | Same: no closure flow. | **Remove.** |
| T26 | :359 | "Content data is securely deleted within 90 days" | **FALSE** | E-CRON. | **Remove.** |
| T27 | :360-362 | "Audit logs may be retained for security and compliance purposes" | **GRAVEYARD** | E-GY. | **Remove.** |
| T28 | :363-365 | "Backup systems are purged according to our data retention policy" | **FALSE** | No retention policy exists. | **Remove.** With T24-T27 this empties 9.2: delete the "9.2 Data Handling Upon Termination" heading and list, and retitle §9 "Termination". |
| T29 | :383 | "Email notification to registered users" | UNVERIFIABLE (commitment) | Can be honoured by hand. | keep. Owner/legal. |
| T30 | :384 | "In-app notifications for 30 days" | **GRAVEYARD** | E-GY (notification centre). | **Remove.** |
| T31 | :385-387 | "Updates to the “Last Updated” date on this page" | TRUE once T1 is applied | — | keep |
| T32 | :388 | "Changes become effective 30 days after notification" | UNVERIFIABLE (commitment) | This clause governs s54 itself (Q1). | keep. Owner/legal. |
| T33 | :403 | "Immediately investigate and contain the incident" | UNVERIFIABLE (commitment) | Can be honoured by hand. | keep. Owner/legal. |
| T34 | :404 | "Notify affected users within 72 hours" | UNVERIFIABLE | A fixed clock needs detection and an incident process that do not exist (E-OPS). GDPR's 72 hours is owed to the supervisory authority, not to users. | **Reword:** "Notify affected users as the law requires" (Q4). Owner/legal. |
| T35 | :405 | "Provide detailed incident reports and remediation steps" | UNVERIFIABLE | E-OPS. | **Remove.** |
| T36 | :406-409 | "Implement additional security measures to prevent recurrence" · "Cooperate fully with law enforcement when required" | UNVERIFIABLE (commitments) | Can be honoured by hand. | keep. Owner/legal. |
| T37 | :414-421, :440-449, :457-466, :491-500 | Security Contact, Legal Inquiries, Security Issues → `privacy@`; General Support → `support@` | TRUE once the mailboxes accept mail | As P58. | keep |
| T38 | :474-476 | contact heading "Data Protection Officer" | **FALSE** | As P55. | **Reword:** "Privacy Requests" |

*Not counted:* hero framing (:29-30), "Fair Use" card, §1, the §2 amber notice, §3, the §4
prohibitions (including "penetration testing", which stays: users may not pen-test us), §5, the
§6 intro, §6.2 other than T15 and T16, §8 other than T22, and the §9.1 reservations other than
T23.

### Counts

Counts are rows. A row can group several lines that make one claim, for example P58's three
contact blocks.

| Verdict | /privacy | /terms | Total | IDs |
|---|---|---|---|---|
| TRUE | 15 | 7 | 22 | P3, P6, P8, P10, P11, P13, P15, P21, P23, P27, P43, P45, P47, P50, P58 · T2, T4, T9, T16, T21, T31, T37 |
| FALSE | 27 | 11 | 38 | P1, P2, P4, P5, P7, P9, P12, P14, P20, P22, P26, P28, P29, P31, P32, P34, P37, P38, P46, P48, P49, P51, P52, P54, P55, P56, P57 · T1, T3, T5, T8, T11, T15, T17, T23, T26, T28, T38 |
| GRAVEYARD | 3 | 4 | 7 | P16, P33, P41 · T7, T12, T27, T30 |
| UNVERIFIABLE | 14 | 16 | 30 | P17, P18, P19, P24, P25, P30, P35, P36, P39, P40, P42, P44, P53, P59 · T6, T10, T13, T14, T18, T19, T20, T22, T24, T25, T29, T32, T33, T34, T35, T36 |
| **Rows** | 59 | 38 | 97 | |

The 30 UNVERIFIABLE rows get one of three actions:

- **Kept as commitments the owner honours by hand (7):** P44, T20, T29, T32, T33, T36, and
  T34 in its reworded form.
- **Reworded to what is true (7):** P18, P19, P25, P30, P42, T13, T22.
- **Removed (16):** P17, P24, P35, P36, P39, P40, P53, P59, T6, T10, T14, T18, T19, T24, T25,
  T35.

### Sub-processors: used versus listed

| Provider | What it receives | Evidence | On /privacy today |
|---|---|---|---|
| Vercel | Every request: app, API, embed script, IPs | `server: Vercel` on production; `vercel.json` | no (says "AWS, Google Cloud") |
| Supabase | Accounts, content, sessions, IPs, images (Storage) | `.env.example:8-13`; `src/lib/supabase/*`; `api/upload/image` | no |
| Fly.io | Editor WebSocket traffic (`recopyfast-ws`, `iad`) | `server/fly.toml`; `https://recopyfast-ws.fly.dev/health` answers 200 | no |
| Stripe | Billing identity, payments (hosted Checkout) | `stripe` dependency; `api/billing/*` | yes |
| OpenAI | Text and context submitted for AI rewrite (`gpt-4o-mini`) | `src/lib/ai/openai-service.ts:71`; `api/ai/suggest/route.ts:198` | no |
| Resend | Recipient addresses, codes, invitations | `src/lib/email/resend.ts` | generic ("email service providers") |
| Upstash | Rate-limit keys (hashed or IP-derived) | `.env.example:122` "Provider: Upstash" | no |
| Sentry | Errors, 10% traces, user id only (no replay, no email) | `src/instrumentation-client.ts`; `sentry.server.config.ts` | no |

- **Not used:** Anthropic, Gemini or anything on Google Cloud, any analytics SDK, Stripe.js on
  our pages.
- **`next/font/google`** (`src/app/layout.tsx:6`) self-hosts the fonts at build time, so it is
  not a runtime processor.
- **Unknown, for the owner:**
  - the host behind the `mail.recopyfa.st` MX, which receives the `privacy@` and `support@` mail;
  - whether Supabase Auth's own mailer or a custom SMTP sends the owners' magic-link emails.

## Anchor points

| File | Change |
|---|---|
| `src/app/privacy/page.tsx` | Every P-row with an action. Add a header tombstone above `export default` (see Traps). Add inline tombstones at P9 (location), P32 (2FA) and P28 (TLS 1.3). Remove the `Globe` import (P57 empties it) and the already-unused `FileText`. |
| `src/app/terms/page.tsx` | Every T-row with an action. Add the header tombstone. Change the summary grid from `sm:grid-cols-3` to `sm:grid-cols-2` (T3). Remove the `Clock` import (T3 empties it) and the already-unused `AlertTriangle` and `Users`. |
| New `src/__tests__/app/legal-pages-truth.test.tsx` | The guard. It renders both pages with `Header`/`Footer` mocked, like `legal-contacts.test.tsx:20-24`, and asserts graveyard and unbacked phrases are absent from the rendered HTML, with a bite check and positive pins for the provider list. |
| `src/__tests__/app/legal-contacts.test.tsx:76-90` | Swap the role labels only (P55-P57, T38). Address assertions unchanged. |
| `docs/stories.md:1994-2000` | Tick the s54 boxes in the story commit. |

## Verified APIs / functions

- **Render harness.** `legal-contacts.test.tsx` renders `@/app/terms/page` and
  `@/app/privacy/page` directly under jsdom, with `@/components/layout/Header` → `{ Header: () =>
  null }` and `@/components/layout/Footer` → `{ __esModule: true, default: () => null }`. Its
  helpers:
  - `mailtoLinks(container)`;
  - `addressUnder(label)`, which finds the `h4` by accessible name and reads the sibling
    `mailto`.
- **The s50 pattern** (`src/__tests__/marketing/retired-promises.test.ts`): a `RETIRED` list,
  `it.each(RETIRED)("no public page says %s")`, and a sanity case proving the scan reaches real
  source (`:131-150`). It scans AST literals so comments never count. A render gives the same
  guarantee for a static page, because JSX comments are not rendered. It also sees exactly what
  a visitor sees, attributes included, via `innerHTML`.
- **Jest.** `testMatch` is `src/**/*.(test|spec).{js,jsx,ts,tsx}` (`jest.config.js`), so a new
  `*.test.tsx` under `src/__tests__/app/` is picked up. The default environment is jsdom.
- **Lint.** Both files currently carry three pre-existing `no-unused-vars` warnings (`FileText`
  in privacy:10; `AlertTriangle`, `Users` in terms:7, :11). `react/no-unescaped-entities`
  applies to JSX text, so an apostrophe must be written `&apos;`, as P25's text does.

## Traps & constraints

- **A test pins today's role labels.** `legal-contacts.test.tsx:76-90` asserts `h4`s "Data
  Protection Officer" (both pages), "Security Team" and "EU Representative". s54 must change that
  test. AGENTS.md § Tests: change the test and say so in the PR. Only the label arrays change.
  - Privacy: `["Privacy Requests", "Security Issues"]`.
  - Terms: `["Legal Inquiries", "Security Issues", "Privacy Requests"]`.
  - The `support@` and `privacy@` expectations stay as they are, as does the "status page" case.
- **`retired-promises.test.ts` also scans these files.** It looks for "recopyfast.com",
  "money-back", "priority support", "onboarding call" and "future pro features" in string
  literals, not comments. The tombstones may name retired claims, because neither guard reads
  comments. Its diff must stay empty.
- **No other test reads these bodies.** E2E-040 and E2E-041 (`e2e/public-pages.spec.ts:26-42`)
  check only the status code. `comparison-discovery.test.tsx:45-46` checks only that the footer
  links exist.
- **Guard phrase choice.** Keep "penetration testing" off the list, because the §4 prohibition
  (`terms:146-147`) legitimately stays. Use `innerHTML`, not `textContent`, so `title`/`alt`
  attributes count too. No Tailwind class on either page contains a listed phrase.
- **Tombstones (AGENTS.md § Comments).** Each page needs a header comment.
  - It explains that until s54 the page promised SOC 2, MFA, TLS 1.3, audit logs, RBAC, SIEM, a
    24/7 SOC, 99.9% uptime, retention periods and an EU representative, and that none of it was
    backed.
  - It states the rule: every sentence is backed by code or infrastructure, or is a commitment
    the owner honours by hand.
  - It names the guard test.
  - Inline tombstones go where a future agent is most likely to "restore" boilerplate: location
    (P9: re-add when A/B ships), 2FA (P32: settings says not available), and TLS (P28: 1.2 is
    accepted on Vercel and Fly).
- **Terms §10 binds this change.** "Changes become effective 30 days after notification", and
  login and signup bind users to these pages. The owner decides the Effective date and whether
  registered users are emailed (Q1). The implementer writes the dates; they send nothing.
- **Mailboxes.** `legal-contacts.test.tsx:12-13` says the owner confirmed both mailboxes. The
  s50 review says both bounced (`docs/reviews/s50-homepage-truth.md:282-284`). This is still
  unresolved, and it is an operator step outside this story.
- **Design debt, left alone.** Both pages use raw palette classes (`sky-*`, `amber-*`, `red-*`).
  That is not a truth problem and not s54's job; s50 set the precedent of copy-only. The one
  layout touch is T3's grid column count, a removal-driven change that needs no design pass.
- **Out of scope, noted for follow-ups.**
  - The `rcf_vid` cookie and the A/B requests the widget makes on every visitor's page load
    (fact 5) are a product fix, not a copy fix.
  - The blog's "any site" copy (`blog/page.tsx:71`, `blog/[slug]/page.tsx:112`) is left over from
    s50.
  - `docs/operations/database-setup.md:176` misstates Supabase's backup retention.
- **Worktree and database.** The shared local Supabase is in use by other stories.
  - Run gates in `.omx/worktrees/s54-legal-pages-truth`.
  - Set `RCF_TEST_SUPABASE_CONFIG` to the scratchpad's `dead-supabase.toml` (ports
    59998/59999), so the DB suites report `[gated]`.
  - Source the scratchpad's `ci-env.sh`, which holds the CI placeholder env.
  - s54 touches no DB path.

## Open questions

These are for the owner, at plan validation.

1. **Dates (P1, T1).** Recommendation: "Last Updated" is the story commit's date. For
   "Effective", Terms §10 says 30 days after notice to registered users.
   - With no customers yet, set it to the same date.
   - If there are live accounts, the owner emails them and gives a date 30 days out.
2. **True replacements versus pure removal** (P32, P33, P38, P41; T11, T12, T13).
   **Recommendation: replace.** Each replacement is a verified fact (E-2FA, E-GY,
   limiters, Sentry), and without them §4.2 and §4.3 would be empty. Pure removal is the fallback
   if the owner wants the pages to make no security claims at all.
3. **The seven kept commitments** (P44, T20, T29, T32, T33, T34 reworded, T36). Keep each only
   if the owner will honour it by hand. Removing one is always allowed; adding one is not.
4. **Breach notice (T34).** Recommendation: "as the law requires". Keeping "within 72 hours" is
   a promise with no process behind it (E-OPS).
5. **Account deletion (T23).** The reword routes deletion to `privacy@` by hand. A self-serve
   deletion is a product story, not s54.
6. **Upstash.** It is named only by `.env.example:122`. The owner confirms that production Redis
   is Upstash before it is listed. Otherwise the line becomes "Redis hosting — rate limiting",
   with the provider named.

## Real complexity

The story scores this 2. **After research: 2.** It is copy in two static server components, one
new render test, and a label swap in one existing test. There is no migration, no route, no
widget byte and no layout change beyond one grid column count.

The volume is higher than the score suggests: about 75 edits across 97 rows. But each is
mechanical, and each has its exact text in the tables above. The risk is not complexity but
**adding words**: the reviewer must be able to check every added line against the Action
column.

## Split proposal

Not required.
