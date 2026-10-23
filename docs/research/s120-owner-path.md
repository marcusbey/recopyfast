# Research — s120-owner-path

October 22, 2026. Summary of the owner-angle brief kept outside the repo at
`.omc/gtm/research/site-owner-angle-2026-10-22.md` (research only: nothing was posted, nobody
was contacted, nothing was spent). Labels: **[V]** verified from a cited source, **[R]** read
from this repo or the live site, **[H]** hypothesis.

## Question

Should ReCopyFast sell to the site owner (the freelancer's client) rather than mainly to
freelancers and agencies? Starting point [R]: about 130 homepage visits in 14 days, one
post-launch signup (owner QA), CA$0 revenue; freelancer feedback was "I already handle client
edits on retainer" and "small clients won't edit themselves".

## Evidence

- **The pain is real and recurring [V].** Owner threads (r/smallbusiness, r/webdev and others)
  describe paying for typos, waiting days and being "held hostage" by a developer. Outside
  numbers, mostly vendor-funded: 44% of US consumers visited a closed location because online
  hours were wrong (Yext 2022); 62% would avoid a business with incorrect info online
  (BrightLocal 2023).
- **What a change costs today [V].** $50–150 an hour for freelance edits
  (WebsiteMaintenance.com; $75–150/h in r/webdev rate threads; $100/h for edits); care plans with
  edits $100–250/month; "unlimited edits" WordPress services from about $99–179/month. Starter at
  $9/month is less than one paid change, so price is not the blocker: activation and trust are.
- **Who pastes the script is the structural issue [V/H].** Ghosted or locked-out owners can't
  install anything (we can't serve them). Squarespace/Wix/Shopify owners mostly have native
  editors (low value; code injection needs Squarespace Core or a paid Wix plan with a connected
  domain). The clean self-serve segment is WordPress owners with admin access, via a header and
  footer plugin such as WPCode. Everywhere else a developer pastes the line once.
- **Redeploy risk [R].** A published edit survives a developer deploy while the element keeps its
  identity; moving or redesigning the element silently reverts it, and there is no warning on
  main (`public/embed/recopyfast.src.js`, `computeStableElementId`). Do not claim "edits survive
  updates" until a detector ships (s119, PR #119, unmerged).
- **SEO [V/R].** Published copy is applied in the browser after load; Google renders JavaScript,
  many other crawlers do not. Never promise SEO.

## Verdict carried into s120

The owner is the better demand source and complementary to the freelancer lane, not a self-serve
replacement. Build first (brief appendix items 1–3): the owner-first "who will install?" choice
with a message the owner sends from their own mailbox, per-platform install pages starting with
WordPress/WPCode, and the `/for/owners` page. Messaging rules: "control of your website's words",
never "take control of your website"; no SEO promise; no "edits always survive"; never ask for
admin passwords. Headline options approved by the owner: "Change your hours, prices and specials
yourself, without waiting on your web developer." and "Stop paying $75 to fix a typo."

## Repo facts the build relied on [R]

- Plans (`supabase/migrations`, `plans` table): free 0 websites; Starter 1 website, 0
  collaborators; Pro 5 websites, 5 collaborators. Seat quota enforced by `canShareSite`
  (`src/lib/feature-gating/permissions.ts`) in `src/app/api/sites/[siteId]/share/route.ts`.
- The registering owner gets `admin` (includes publish); edit-only is a permission someone else
  grants. Signup CTAs elsewhere say "Start your free trial" (`Hero.tsx`, `/try`).
- The embed tag's site token is public by design and origin-bound (ADR 027); `sites.api_key` is
  the HMAC secret and must never leave the dashboard.

## Not verified (hypotheses)

Owners will ask their developer; developers will comply; WordPress owners will self-install;
owners will pay after the first change.
