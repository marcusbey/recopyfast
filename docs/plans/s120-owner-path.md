---
validated: yes
story: s120-owner-path
---
# Owner page, send-to-your-developer install flow and WordPress (WPCode) guide

Validation source: Owner explicitly requested this scope in chat on 2026-10-22: 'Build /for/owners plus the send-this-to-your-developer install flow and the WordPress (WPCode) install guide, with owner messaging and DataFast goals.'

Goal: give the site owner (research: `docs/research/s120-owner-path.md`) a page that speaks to
them, and a way to get the one line installed without sharing a password. Branch
`feature/s120-owner-path`, based on main `45d65def` (#118). Embed allocation 0 bytes.

- [x] Install-method choice (`InstallMethodChoice.tsx`) in the registration modal and the site
      installation card: "I'll do it myself" keeps the existing steps; "My developer will" shows
      `DeveloperHandoffMessage`. Fires `install_method_selected`.
- [x] Message builder (`src/lib/sites/developer-handoff-message.ts`): accepts exactly the tag
      `buildEmbedScript` emits, a hostname-only domain, per-platform recipes, a three-line
      security note and the guide links; a final credential scan refuses any editor link, session,
      staging token or secret. `mailto:` stays under 2,000 characters by falling back to a short
      body, then to subject only; the UI says which, and the owner pastes the copied message.
      Fires `developer_message_copied` / `developer_message_emailed`.
- [x] Public guides: `/docs/install/for-developers` (what the script does, CSP lines from the
      install example, verify, redeploy behaviour, remove) and `/docs/install/wordpress` (WPCode
      Header & Footer). Both static, in the docs route allow-lists, sitemap, llms.txt and the
      canonical tests; linked from `/docs/install`. The WordPress recipe links its guide through a
      `guide` field rendered as a link by both dashboard renderers.
- [x] `/for/owners` (`OwnersPage.tsx`): owner headline, sourced per-change cost under the
      owner-approved "$75" headline, three steps, the real `InteractiveHero`, can/can't change,
      handoff, platform fit, honest FAQ. Price and websites limit from `/api/pricing`
      (`useStarterPlanPrice`, `OwnerStarterPrice`). Header/footer nav link "For business owners".
- [x] DataFast taxonomy extended in `datafast-goals.ts` (three goals, `docs` target, five CTA
      locations); ADR 074 amended to list them.
- [x] Review fixes (PASS-WITH-FIXES): approval sentence, trial CTA wording, websites limit,
      sourced cost framing, "site token", demo copy, reason-specific refusal text, mailto fallback
      text, credential-scan test and hostname false positive, recipe guide link, s119 reminders.
- [x] Run lint, type-check, format:check, full Jest and the production build; confirm the three
      new routes are static.
- [ ] Merge and deployment: manual, separate from this plan.

Rollback: revert the branch. No schema, API, permission, billing or embed change.
Out of scope (research appendix): reversion detector (s119), other per-platform guides, a
WordPress plugin, "first change free" offer, `/for/restaurants`.
