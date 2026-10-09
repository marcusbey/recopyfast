---
validated: yes
---
# Plan — Story s72-edit-board-history-xss

> Owner decisions (2026-10-09): plan **validated**; restore panel folded in (R1 + R2); **one shared email
> rule** (tighten `isPlausibleEmail`); database lockdown is **s72b**, separate; read-only production count
> **run before ship** — done 2026-10-09 by the orchestrator (Supabase connector, `SELECT` only): every
> count **0** (`content_versions.created_by`, `staging_access.email`, `site_editors.email`,
> `staging_history.user_email` hold no `<>"\``/whitespace; no live address fails the tightened rule).

Branch: `feature/s72-edit-board-history-xss`
Research: `docs/research/s72-edit-board-history-xss.md` — read it first; this plan does not repeat it.
Source: `docs/reviews/s70a-embed-ui-not-content.md` F1 (major) and F4(a). No Design step: no new UI —
the History row keeps its layout.

**Base.** s72 builds only after PR #75 (`feature/s70a-embed-ui-not-content`) merges, and rebases on
it: same source file, and s70a's ceilings (45840 / 33073) are the ones this story must stay under.
This branch holds docs only until then. Line numbers below are s70a's (`107c400`); main's are given
where they differ. Re-grep after the rebase — another session was still editing s70a (migration
and plans, no embed file) while this plan was written.

## Severity

**Major**, as the review rated it. Not critical: the attacker must already hold `admin` on the
same site (owner or collaborator admin), the victim must be a staging-invite editor who opens Edit
Board → History (the owner's edit-session link gets 401 from that route and sees an empty list),
there is no cross-tenant reach, and production has no users. Not minor: it is stored, persistent
(no product path deletes a version row short of deleting the site) and invisible, and it gives a RecopyFast role script execution on
the customer's own domain — the boundary the product promises never to cross (copy, never code) —
with the editor's bearer tokens (`rcf_edit_link`, `rcf_editor_grant`) and the customer origin's
cookies and app sessions in reach.

## What the owner must decide

1. **Restore panel.** Also render the restore refusal as text (R1) and replace "Restored true
   elements" with "Version restored" (R2)? R1 is hardening (every refusal is a fixed server string
   today) and does not fit the byte budget without R2; R2 fixes a visible bug (the RPC returns a
   boolean). **Recommended: yes to both** — the guard test (task 2) can then say "every `innerHTML`
   in the embed is a literal". If no: drop R1 and R2 and their test cases; G alone measures
   −3…−7 / −3…−5.
2. **Where the email rule lives.** (a) Tighten the shared `isPlausibleEmail`, so `staging/access`,
   `editor/editors` (add editor), `request-code` and `submit-code` share one rule; or (b) a
   staging-only rule. **Recommended: (a).** The current rule accepts `<svg/onload=alert(1)>@x.co`,
   and `site_editors.email` is admin-chosen through it too; one rule, in the module that already
   decides what "the same person" means (`editor-directory.ts:47-50`). Cost: non-ASCII addresses are refused (Supabase Auth already refuses them), and an
   existing editor whose address fails the rule could no longer request a code — decision 4's
   count says whether one exists.
3. **The database half.** Lock `staging_access` down in s72, or as a separate story? **Recommended:
   separate — `s72b-staging-invite-writes`** (stub in `docs/stories.md`). Why: revoking the admin's
   read of `verification_code` and write of `email_verified` closes nothing on its own — the admin
   can INSERT a row with a code they chose (the app's own insert sends that column through the
   admin's RLS client), write `verified_user_agent_hash`/`verified_at` (an unkeyed hash), or PATCH
   `email` on a verified row; revoking `token` breaks the invite list and gains nothing (the
   creating admin receives the token by design, ADR 034). The effective fix moves invite create and
   revoke to the service role (ADR 037), revokes web-role INSERT/UPDATE and the platform defaults,
   and needs the real-database privilege suite ADR 033 requires and a code-first deploy — a database
   blast radius, while this story's is the embed on customer domains. The embed fix alone makes
   every stored value harmless, including rows written before it. s72b absorbs s69 R3. Alternative
   for s72b: retire staging invites (the access model is `site_editors` since s66c1).
4. **Read-only production count, before ship** (owner precondition; SELECT only, through the
   channel the owner names — the s70a F7 lesson). **Recommended: yes.** Not run against production at
   research, never run by the implementer; the owner pastes the output in the PR. Both queries were
   dry-run at research on a throwaway local PostgreSQL 14 seeded with lookalikes (payloads, spaced,
   dotless, hyphen-led label, one-letter TLD, non-ASCII, valid, revoked, inactive, expired): every
   count came out as intended.

   ```sql
   -- Was the sink ever exploited, or seeded? Expected: 0 everywhere.
   SELECT 'content_versions.created_by' AS field, count(*) FROM public.content_versions WHERE created_by ~ '[<>"`]|\s'
   UNION ALL SELECT 'staging_access.email',       count(*) FROM public.staging_access   WHERE email      ~ '[<>"`]|\s'
   UNION ALL SELECT 'site_editors.email',         count(*) FROM public.site_editors     WHERE email      ~ '[<>"`]|\s'
   UNION ALL SELECT 'staging_history.user_email', count(*) FROM public.staging_history  WHERE user_email ~ '[<>"`]|\s';

   -- Decision 2: live addresses the tightened rule would refuse. Expected: 0.
   SELECT 'site_editors' AS tbl, count(*) FROM public.site_editors
     WHERE revoked_at IS NULL AND (length(email) > 254 OR email !~
       '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])$')
   UNION ALL SELECT 'staging_access', count(*) FROM public.staging_access
     WHERE is_active AND expires_at > now() AND email IS NOT NULL AND (length(email) > 254 OR email !~
       '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])$');
   ```

   A non-zero first count is an incident, not a footnote: stop and tell the owner before shipping.

## Target story

`docs/stories.md` → s72. Nothing a response carries reaches the embed's HTML as markup; the
invite route refuses an address that is not an address; the "THE RULE" comment is true; the
embed gets smaller.

## Tasks (ordered)

0. [ ] **Rebase and baseline.** After PR #75 merges: `git fetch && git rebase origin/main`. Record
   `npm run build:embed -- --check` (expected 45840 / 33073 — whatever main's ceilings are is the
   budget), and the three dynamic sinks with
   `grep -n "innerHTML = '<span>' + dateStr\|Restored ' + result\|(result.error || 'Failed to restore')" public/embed/recopyfast.src.js`
   (s70a: `:6516`, `:6587`, `:6593`; main: `:6496`, `:6567`, `:6573`). If main's embed source
   moved in a way that changes these three statements, stop and re-plan.
1. [ ] **RED — the History tab and the restore panel render text.** New
   `src/__tests__/embed/edit-board-history-xss.test.ts`, booting the real `recopyfast.src.js` the way
   `embed-ui-not-content.test.ts` does (script tag, stubbed `fetch`, `settle()`, then
   `showStagingBanner()` with a verified `stagingAccess`, a click on `#rcf-edit-board-btn`, then on
   the "History" tab). Its `fetch` stub answers `GET /edit-board/history?` with one version whose
   `created_by` is the case's value, and `POST /edit-board/history/<id>` with the case's reply.
   - `created_by = '<img src=x onerror="window.__rcfPwned=1">'`: `#rcf-edit-board-panel img` is
     empty; `.rcf-eb-card-meta`'s child nodes are a Text node (the date) then one `SPAN` whose
     `textContent` is exactly `'by ' + payload` — the row's two flex items, unchanged;
     `window.__rcfPwned` is undefined. GUARD: the card's title reads "Version 1" (the tab loaded).
     Red today: an `<img>` is created.
   - `created_by` absent: the span reads "by Unknown". (Pin; green today.)
   - `description = '<img src=x>'`: rendered as text, no `img`. (Pin of the existing
     `textContent`, `:6509`; green today — declared as a pin, not a red.)
   - Restore answered `402 {error: '<b id="rcf-err">Plan ended</b>'}` (decision 1): no `#rcf-err`
     element; `.rcf-eb-empty`'s `textContent` is the literal string. Red today.
   - Restore answered `200 {success: true, elementsRestored: true}` (decision 1): the panel reads
     "Version restored" and contains no "true". Fake timers after the click, never advanced past
     1.5 s, so `location.reload` never runs. Red today.
2. [ ] **RED — every `innerHTML` in the embed is a literal.** New
   `src/__tests__/embed/html-sinks-are-literal.test.ts`, reading the source as text:
   - every `.innerHTML =` / `+=` statement's right-hand side (up to its `;`, across lines) is
     string literals joined by `+`, except exactly `svg.innerHTML = ICONS[name]` (a const map of
     literals, `:1983-1989`); the failure message lists line and right-hand side;
   - `outerHTML`, `insertAdjacentHTML`, `document.write`, `createContextualFragment` and
     `DOMParser` occur zero times;
   - GUARDS against a vacuous pass: the scanner finds at least 25 sinks in the source (30 today),
     and flags a fixture string `el.innerHTML = '<b>' + name + '</b>';` as dynamic.

   Red today on the three statements of task 0 (the research scanner listed exactly those three
   plus the allowlisted icon map). Under decision 1 = no, the restore success and failure lines are
   added to the allowlist by exact text, with a comment naming the decision.
3. [ ] **GREEN — `public/embed/recopyfast.src.js`, exactly these hunks and nothing else.**
   - History meta (`:6516`): replace the `innerHTML` line with

     ```js
     // TOMBSTONE (s72). This line was `cardMeta.innerHTML = '<span>' + dateStr +
     // '</span><span>by ' + created_by + '</span>'`. created_by is a staging
     // invite's address, which a site admin chose unchecked and could verify
     // without its mailbox: an address shaped like `<img src=x onerror=…>` ran
     // on the customer's origin when an editor opened History, beside the edit
     // link's bearer tokens (s70a review F1). Text, never markup, for anything
     // a response carries. The date goes in as a bare string: `.rcf-eb-card-meta`
     // is a flex row, a text run is its own flex item, so the 8px gap still
     // separates the two. Pinned by edit-board-history-xss.test.ts and
     // html-sinks-are-literal.test.ts.
     const by = document.createElement('span');
     by.textContent = 'by ' + (version.created_by || 'Unknown');
     cardMeta.append(dateStr, by);
     ```
   - Restore success (`:6587`, decision 1): `content.innerHTML = '<div class="rcf-eb-empty">Version restored</div>';`
     with a one-line note: `restore_content_version` returns a boolean, so the count printed "true".
   - Restore failure (`:6593`, decision 1):
     `content.innerHTML = '<div class="rcf-eb-empty"></div>';` then
     `content.firstChild.textContent = result.error || 'Failed to restore';`
   - "THE RULE" (`:2705-2712`, F4(a)): after "matches the `closest()` selector below", add: "with
     one named exception: the container hint (`showContainerHint`) is a bare `div` that discovery's
     scan selector never matches, so it carries neither (s70a review F4: a marker measured +7 / +8
     bytes for no behaviour). Give it a marker the day it gains a child the scan selector can match."
   - `npm run build:embed`. Then task 4.
4. [ ] **Ratchet the ceilings down to the measurement.** `MAX_BUNDLE_GZ` / `MAX_WIDGET_GZ`
   (`scripts/build-embed.mjs:289-290`) and `SEEDED_MAX_BUNDLE_GZ` / `SEEDED_MAX_WIDGET_GZ`
   (`src/__tests__/embed/build-size-gate.test.ts:106-107`) := the rebased branch's measurement.
   Ledger block "RATCHETED DOWN <date> (s72-edit-board-history-xss), from <main's ceilings>",
   itemized as s70a's is: the ceilings before; `−3…−7 / −3…−5` the History meta as a text node and
   a span; `−6 / −4` the restore lines (R1 + R2 together, single runs; R1 alone is +4 / +6); the
   F4(a) comment `0…+2 / 0…+1` (banner hash only); the measured pair — the new ceilings. Research
   measured 45828–45829 / 33062–33064 for the whole edit on `107c400` across eight comment salts.
   Only the two ends are measurements of shipped bytes; say so, as s70a's block does.
   **Stop rule:** if the rebased branch measures above the ceilings on main, do not raise anything
   — stop and report; the funding options are in the research table.
5. [ ] **RED — one email rule.** (Decision 2 = a.) New
   `src/lib/auth/__tests__/editor-directory-email.test.ts`, a table for `isPlausibleEmail`:
   accepts `editor@example.com`, `First.Last+tag@sub.example.co.uk`, `o'brien@example.com`,
   `a@b.co`, a 254-character valid address; refuses `<img/src/onerror=alert(1)>@x.co`,
   `<svg/onload=alert(1)>@x.co`, `"quoted"@example.com`, `a b@example.com`,
   `a@b.co\r\nBcc: c@d.ef`, `a@b` (no dot), `a@-b.co`, `a@b..co`, `ä@example.com`, 255 characters,
   `""`, `a@b.c`. Red today on the two payloads, the quoted, `a@-b.co`, `a@b..co` and non-ASCII
   rows; the rest pass today and stay as pins.
   In `src/__tests__/api/staging/access.test.ts`, new describe "s72 — POST /api/staging/access email
   rule": an invite whose `email` is `42`, `["editor@example.com"]`, `{}`,
   `<img/src/onerror=alert(1)>@x.co`, `editor@example` or 255 characters answers 400
   `{ error: "Enter a valid email address." }`, the body never contains the submitted value, and
   neither `createStagingAccess` nor `sendStagingVerificationEmail` is called;
   `" editor@example.com "` is created with `email: "editor@example.com"`. Red today (the payload is
   accepted). The existing s51, s68c and s68b blocks stay green unchanged.
6. [ ] **GREEN — server.** `src/lib/auth/editor-directory.ts:57-59`: `isPlausibleEmail` becomes the
   WHATWG HTML "valid e-mail address" production with a dotted domain whose last label has at
   least two characters (today's TLD rule), ≤ 254 characters —
   `` /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])$/ ``,
   the character set Supabase Auth applies (research, "Supabase Auth"); tombstone naming the
   payload it used to accept and s72. `src/app/api/staging/access/route.ts:101-107`: refuse
   `typeof email !== "string" || !isPlausibleEmail(email.trim())` with the fixed message (redact
   nothing, echo nothing), keep the order (limiter, `getUser`, then validation, before the site
   read), and pass `email.trim()` to `createStagingAccess`. Comment: the rule is advisory against
   an admin's direct PostgREST write until s72b; the embed fix is what makes stored values harmless.
   `editor/editors`, `request-code` and `submit-code` change no code; their suites
   (`src/__tests__/api/editor/editors/seat-quota.test.ts`, the request-code and submit-code route
   tests) stay green unchanged — every fixture address passes the new rule (research checked 28).
   Under decision 2 = b: a new `isDeliverableEmail` beside it, used by `staging/access` only, and
   `isPlausibleEmail` untouched.
7. [ ] **Gates and commit.** `lint`, `type-check`, `type-check:build`, `format:check`, `build`,
   `npm test`, `npm run build:embed -- --check`; Playwright `--list` unchanged (+0: no browser test
   added). In `docs/stories.md`, s69 L15 is marked "→ closed by s72". One story commit.

## Rollout

Application-only: merging to `main` is the Vercel deploy that serves the new artifact at the
permanent `/embed/recopyfast.js`. No migration, no Fly deploy. After the deploy, the operator:
(1) `curl -s https://www.recopyfa.st/embed/recopyfast.js | grep -c 'span><span>by '` → `0`, and the
banner's `@generated-from-sha256` equals the merged commit's; (2) records decision 4's count in the
PR if it was not run before merge.

## Run interdicts

- **Ceilings only go down.** `MAX_*` and `SEEDED_MAX_*` never rise; `recopyfast.js` is rebuilt,
  never edited; the comment edit ships only inside the byte-negative edit.
- `git diff main...HEAD -- public/embed/recopyfast.src.js` touches only `renderHistoryTab`'s meta
  line, `restoreVersion`'s two message lines and the "THE RULE" comment.
- No migration, nothing under `supabase/` or `server/`, no new dependency (no sanitizer in the
  embed; one sink does not pay for one).
- Under `src/`, only `src/app/api/staging/access/route.ts` and `src/lib/auth/editor-directory.ts`
  change, plus the tests named above. No existing assertion changes: `access.test.ts` gains a
  describe block, `build-size-gate.test.ts` only its seeded ceilings (down, with the ratchet). Any
  other test that must change is named in the PR with the reason.
- No production SQL, no Supabase connector, no credentials — decision 4's count is the owner's.
- Never `next dev` (it appends to `AGENTS.md`). Never `--no-verify`.

## The point everything turns on

**Text, never markup, for anything a response carries — and a guard that makes the next dynamic
`innerHTML` a red test rather than a review finding.** Where it could be wrong:

1. **The guard's parser.** A sink built with a template literal, split oddly, or hidden behind a
   variable holding markup could slip past a line regex. Compare its list with the research
   scanner's (30 statements, 3 dynamic + the icon map) and keep its two vacuity guards.
2. **The layout claim.** G relies on a text run being an anonymous flex item. The test asserts the
   child nodes (Text, SPAN); the s70a surface test still sees `by owner@example.com`.
3. **Bytes after the rebase.** The banner hash moves gzip by ±2 B; research's 8-salt range is the
   expectation, the rebased measurement is the ceiling.
4. **The email rule refusing a real person.** Non-ASCII addresses become 400 on four routes;
   decision 4's second query says whether anyone live is affected.

## Files touched

`public/embed/recopyfast.src.js`, `public/embed/recopyfast.js` (rebuilt), `scripts/build-embed.mjs`
(ceilings + ledger), `src/__tests__/embed/build-size-gate.test.ts` (seeded ceilings),
`src/app/api/staging/access/route.ts`, `src/lib/auth/editor-directory.ts`, `docs/stories.md`
(s69 L15 line). New: `src/__tests__/embed/edit-board-history-xss.test.ts`,
`src/__tests__/embed/html-sinks-are-literal.test.ts`,
`src/lib/auth/__tests__/editor-directory-email.test.ts`. Extended:
`src/__tests__/api/staging/access.test.ts`.

## Test strategy

- **Embed (Jest, jsdom, the shipped source):** the History tab and the restore panel driven with
  hostile values; assertions on created elements, not on handlers firing (jsdom loads no image, so
  `onerror` never fires there — the sentinel global is belt and braces).
- **Source guard:** a static scan of every HTML sink, with vacuity guards. It is the regression
  test for the class, not only for this line.
- **Routes (Jest, mocked clients):** refusal before any database call, fixed message, no echo.
- **Pure logic:** the email rule as an accept/refuse table.
- **Byte gate:** `build-size-gate.test.ts` against the ratcheted pair.
- Not verified by tests: a real browser. Optional owner check on a local or preview stack (never
  production data): a version seeded with a payload author, History opened in Chrome, nothing runs.

## Definition of Done

Repo DoD, plus: every s72 AC checked with its named test; the ceilings ratcheted to the
measurement; the review passed with no open critical; deployed, with the operator's post-deploy
check and decision 4's count recorded in the PR; s72b exists as a stub (decision 3 = separate).
