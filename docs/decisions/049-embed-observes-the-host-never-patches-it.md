# ADR 049 — The embed follows the host page by observing it, never by patching it

- Status: accepted
- Date: 2026-10-08
- Scope: story s67-embed-spa-support
- Numbering: 043–045 are taken on the unmerged s61/s62 branches and 047–048 on
  `feature/s68-security-hardening`. Expect to renumber if another branch merges first with 049.

## Context

The plain snippet does not work on sites that render in the browser. On openflows.ai (React,
client router) the embed scans before React renders and attaches its only `MutationObserver`
after four network round trips. It never sees the render, so the page ends with 0 editable
elements and no published copy. Rows are fetched once per load, so an in-app route change never
gets its own published copy. The measurements are in `docs/research/s67-embed-spa-support.md`.

The owner's rule is one generic mechanism. That means no framework, router or site detection,
and no host-side workaround. Three forces shape the answer:

- **The host owns its DOM and its globals.** The embed runs on customer pages next to routers,
  i18n libraries and frameworks that capture or wrap `history` methods and that own their text
  nodes. Research measured today's `target.textContent = content` crashing React 19. React
  later calls `removeChild` or `insertBefore` against a text node the embed had replaced,
  throws `NotFoundError`, and unmounts the whole root. That happened on a client-rendered page
  and on an SSR page after hydration.
- **SPAs re-render.** A component re-render can put the authored copy back at any time. A copy
  that only applies once does not hold.
- **Unedited rows are not content.** Discovery stores `published_content = original_content =`
  the DOM text a visitor happened to see. If every row is applied, dynamic text (a reordered
  post list, a live counter) is frozen to whatever the first visitor saw. On SPAs that becomes
  systemic.

## Decision

The embed treats the host page as the source of truth. It reacts to the page only through
observation and in-place writes, and it enforces only what a human edited.

1. **Route detection without patching.**
   - The normalized path is compared on every observer batch, plus on the Navigation API
     `currententrychange` event where it exists, plus at the start of the edit-mode click
     handler.
   - No history method is wrapped, no host global is assigned, and nothing polls.
   - A path change is treated as a full load. Page-scoped entries get back the authored text
     the embed replaced, lose their stamp, and are dropped. Then the new path's rows are
     fetched (once per path, cached) and the page is rescanned.
2. **In-place text writes.**
   - Copy is written by setting `nodeValue` on the element's first direct text node and
     blanking its other text nodes.
   - A text node is appended only when the element has no direct one. No node the host
     rendered is ever removed or replaced.
   - Every runtime text write goes through this one writer: hydrate, realtime, A/B variants,
     and the editor's save, cancel and AI paths.
3. **Only edited rows write text, capped.**
   - A row writes text only when `current_content !== original_content`. A missing
     `original_content` counts as edited.
   - On an element with an edited row, published copy wins over any host re-render, up to 10
     writes per element per page view (one route visit). A second enforcer, such as machine
     translation or another A/B tool, therefore converges instead of ping-ponging.
   - Writes compare against the live DOM and skip when it already matches, so the embed's own
     writes never cause a loop.

### Amended on the branch, 2026-10-08 (implementation)

- **When the rescan runs after a route change.** A detected path change drops the
  page-scoped entries and fetches the new path's rows at once, but the page is not rescanned
  at the moment of detection. The Navigation API fires `currententrychange` inside
  `pushState`, before the router has rendered anything: a scan there would file the old
  page's elements under the new path, and could paint the new page's copy on the old page's
  twins. Instead:
  - the first observer batch that adds nodes after it rescans at once, in the microtask the
    render runs in, which keeps a cached route's first frame published, as measured;
  - any other batch while the page is stale — text changes only — schedules the ordinary
    debounced rescan (200 ms after the last change, never more than 1,000 ms after the
    first). This is the route that re-renders in place: a param route (`/blog/:slug`) reuses
    its components and React writes a lone text child with `nodeValue`, so the new page
    arrives without a single added node. Before the review fix (finding 1, 2026-10-08) such
    a route was never rescanned: its elements stayed unstamped and its published copy was
    never applied. Debounced rather than immediate, because such a batch can be nothing but
    the embed's own authored-copy restores, delivered before the router has rendered;
  - an edit click rescans too.
- **What the cap counts.** It counts every text write the embed makes to the element in the
  page view, the first apply included: at most 10 in total. A host that keeps writing wins
  from its tenth write-back onwards.

## Considered options

- **Wrap `history.pushState` / `replaceState` and listen to `popstate`.** Rejected.
  - It misses every router that captured the native function before a late-loaded snippet
    ran, which covers any async or tag-manager install.
  - It forms order-dependent wrapper chains with routers that patch history themselves, such
    as the Next.js app router.
  - It cannot be removed by `destroy()` once another library has wrapped it after the embed.
  - A throw inside the wrapper breaks the host's navigation.
  - It costs ~60–90 gz, against ~10 for the path check.
- **Poll `location.pathname`.** Rejected. It costs CPU on every page of every customer site
  forever, lags by the interval, and is throttled in background tabs.
- **Framework adapters or detection (React, Next, Vue routers).** Rejected by the owner's rule.
  Every adapter is site-specific code that breaks silently when the framework changes.
- **Keep `textContent` replacement.** Rejected: it crashes React 19 apps in production (blank
  page). It is safe only for single-text-node elements, which the embed cannot know in
  advance.
- **Re-apply only when the host restores the authored copy** (AC 4's original wording).
  Rejected by owner decision 2 (2026-10-08). It lets other host text show until the next
  rescan, and its behaviour depends on timing.
- **Apply every row, edited or not.** Rejected by owner decision 1 (2026-10-08). It freezes
  dynamic text to the first visitor's DOM. The accepted loss is rows created through
  `POST /api/v1/content`, which stores `original_content = published_content`, until a
  follow-up stores `null` there.
- **Treat `#/` hashes as paths.** Deferred (owner decision 3). It would change the ids on
  existing hash-routed sites. Hash routes stay out of scope, and the install guide documents
  the workaround.

## Consequences

- **Easier.**
  - Any router whose navigation changes the DOM is covered without knowing which router it is.
  - Host navigation cannot be broken by the embed, because the embed sits on no navigation
    path.
  - `destroy()` can undo everything the embed installed.
- **React.** The React crash class from replaced text nodes is closed for text. SSR sites that
  receive published copy before hydration still trigger React 19's #418 and a client
  re-render. s67 shortens that to a self-healing double swap. Rendering published copy on the
  server (s65a) is the real fix.
- **Harder.**
  - On a browser without the Navigation API, a route change that mutates no DOM is noticed
    late: at the next mutation or the next edit click.
  - An element with markup children keeps its child elements (icons stay) and has their text
    blanked. Today they are destroyed, so this is a visible change on such elements.
  - An edited dynamic element is frozen to published copy, up to the cap. That is the product's
    promise, stated explicitly.
- **To watch.**
  - Host write-backs at the cap. Once the embed has written an element 10 times in a page
    view, the host's next write stands and the edited copy loses for the rest of that page
    view.
  - A route change that mutates no DOM, on any browser: the new page's elements are
    re-identified at the next observer batch of any kind (debounced unless it adds nodes) or
    at the next edit click (see the amendment above).
  - A router that renders more than a second after the path changed, on a page that keeps
    changing meanwhile (a ticker): the debounced rescan can run before the new page exists
    and file the old page's elements under the new path for that interval. The new page's
    own render corrects it at its next batch.
  - The lazy-loader case, where an edited image's `src` is swapped by attribute and no
    attribute observer exists. This is a known gap.
  - `applyImageSource` still removes `<picture><source>` nodes. That is the same hazard class
    for images. No crash was measured, and it is a follow-up.
