# Review — s120-owner-path

Independent review of `feature/s120-owner-path` at `b77b61e5` (three story commits on main
`45d65def`). Verdict: **PASS-WITH-FIXES**. Every finding below was fixed on the branch in a
follow-up pass on October 23, 2026; nothing is deferred except where noted.

## Findings and resolution

### Major

1. **Pipeline docs missing** (AGENTS.md absolute rule). Resolved: story s120 in
   `docs/stories.md`, `docs/research/s120-owner-path.md`, `docs/plans/s120-owner-path.md`
   (`validated: yes`, owner's chat request of 2026-10-22 quoted) and this record.
2. **Approval overclaim on /for/owners.** "They can keep the publish button" was false for the
   registering owner, who is `admin` (includes publish), and Starter sells 0 collaborator seats.
   Resolved: the note now says edit-without-publish applies only when the developer holds the
   account on Pro and invites the owner (limits read from the `plans` migration and
   `canShareSite`). Test asserts the new sentence and the absence of the old one.
3. **"Start free"** while the free plan allows 0 websites. Resolved: "Start your free trial" on
   both owner-page CTAs and both guide footers, matching the homepage and /try.

### Minor

- Credential scan unreached by tests and `api-key.example` false positive. Resolved: parser-valid
  tags carrying `sk_live_`, `rcf_token`, `access_token` and `api_key=` now reach and trip the final
  scan; the `api[_-]?key` pattern ignores hostname labels (followed by `.`, `-` or `:port`), with
  tests for three such domains. The refusal alert text depends on `reason`.
- Subject-only `mailto:` fallback described as carrying the snippet. Resolved: the message exposes
  `mailtoBody: "full" | "short" | "none"`; the "none" helper says to paste the copied message into
  the email. The `developer_message_emailed` `body` param gains `none`.
- Hardcoded "one website". Resolved: `limits.websites` read from `/api/pricing`; a missing or
  invalid value names no count.
- "$75" sourcing. Headline kept (owner-approved); the sentence under it now carries the sourced
  framing ("Small website edits typically cost $50–150 each when you pay your developer per
  change") and the file comment explains both figures.
- "site key" renamed "site token". Demo copy no longer names the restaurant and says changes stay
  "in this tab until you reload" (React state only).
- ADR 074 table lists the three s120 goals, the `docs` target and the new CTA locations (dated
  amendment).
- The WordPress recipe's guide path is now a `guide` field rendered as a link in the
  registration modal and the site installation card.
- "We don't warn you about that yet" kept (PR #119 unmerged), with an "Update when s119
  source-drift detection (PR #119) ships." comment beside the owner page and developer guide
  occurrences.

## Verification

After the fixes: lint 0 errors (no warnings in changed files), type-check and format:check
clean; full Jest with `NEXT_PUBLIC_APP_URL=http://localhost:3000`: 559 suites passed (1
skipped), 8,288 tests passed (2 skipped); `npm run build` passed with `/for/owners`,
`/docs/install/for-developers` and `/docs/install/wordpress` prerendered static (○). Merge and
deployment remain manual.
