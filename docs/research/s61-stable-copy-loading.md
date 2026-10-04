# Research — s61-stable-copy-loading

## User outcome

A visitor should see one initial version of managed text, with published copy arriving
sooner. On 2026-10-04 the user explicitly required protection by default, overriding
an earlier proposal to make visibility delay optional. aicompoz.com is the real test
case; no selector, heading or hostname is hardcoded into product behavior.

## Verified premise

Main is 9aa492d. PR 56 (installation docs) and PR 57 (s60 API timing) remain separate
unmerged changes. This worktree is isolated from the dirty primary checkout.

The generic snippet is one external tag built in `src/lib/sites/embed-script.ts`.
`src/lib/sites/install-recipes.ts` tells every platform to install at the end of body.
The aicompoz adapter instead loads the same script with Next afterInteractive.
Neither placement can undo an authored paint that already occurred. The earlier
s11 research and stories.md M3 explicitly record this limitation.

`public/embed/recopyfast.src.js:ReCopyFast.init` serializes DOM readiness, private-mode
validation, editor auth, fonts, DOM scan, saved content, A/B lookup/assignment and sockets.
`Rules.whenFontsReady` in `src/lib/editingRules.core.ts` has a 3,000 ms limit and exists
for editing geometry. The text branch of `applyContentToElement` has no geometry
measurement; image application has separate sizing behavior that must remain tested.

`hydrateStoredContent` chooses public vs staged routes after `canReachStagingContent`,
then immediately mutates rows. A/B applies later. These must become a gather/commit
sequence for a single visible result. A valid device grant can access staging even when
`stagingMode` is false, so that boolean alone is not a sufficient private-mode guard.

`setupMutationObserver` only rescans and reports; it does not hydrate new content.
SPA navigation and continuously inserted content therefore cannot be advertised as
already supported by this initial-load change.

## Early concealment

The published target list and computed element IDs are unknown before the request/scan.
A cold visit must temporarily hold eligible text, including some unedited text.
A broad tag-only rule would hide structural containers. Use an early observer and the
same direct-text/explicit-region eligibility predicate as `shouldSkipElement`, with
ignore/contenteditable exclusions. Observe added text nodes as well as element trees.
This is a proposed mechanism, not proof of first-frame safety: browser tests must prove it.

Visibility preserves boxes. A visual child inside a managed text container can also
wait briefly. Do not force descendant media to visibility:visible: doing so could reveal
media the host intentionally hid. Images outside managed regions retain authored visibility.
Open shadow roots require their own stylesheet/observation; closed roots/iframes remain
outside the scanner. Any unsupported paint path must be documented, not silently claimed.

## Faster delivery without a new content cache

The content GET currently tries `authorizeFirstPartySiteRequest` before the site-token
path. Route explicit bearer requests directly to the existing site authorizer; a failed
bearer must never fall through to cookie auth. Cookie-only dashboard requests retain their
path. Measure the saving; do not assume a getUser call always made a network round trip.

Content OPTIONS lacks Access-Control-Max-Age; `src/lib/http/public-cors.ts` already uses
86400. A preflight cache permits sending the actual request; it does not bypass the GET's
current origin/token checks. Scope the header change to this route and test revocation.

Shared response caching is deferred. Current responses depend on origin and token; they
cannot be put into a public CDN cache by adding s-maxage. Vercel excludes requests
carrying Authorization from its CDN cache eligibility:
https://vercel.com/docs/caching/cdn-cache. Do not move credentials into query strings. Even Redis behind authorization
needs a transactionally maintained content revision across publish, direct content writes,
bulk writes, deletes and winner promotion. Post-write DEL has a crash/race window.

## Compatibility and deployment

The permanent runtime URL stays intact. Old installs continue to work, but cannot be
advertised as protected before paint; they need the new early snippet. Next needs a
server-emitted native bootstrap in head and the current hydration-safe runtime boundary;
Next beforeInteractive alone is not a demonstrated first-paint guarantee.

The aicompoz parser accepts a single external tag and rejects inline content. Its adapter
must use trusted generated bootstrap/configuration, never arbitrary environment HTML.
Analytics suppression on editor URLs and referrer protections must remain.

The measured generated bundle is 45,759 bytes gzip against 45,880, and widget-only is
32,986 against 33,120. Do not raise either ceiling. Startup ownership must be factored
without retaining duplicate helpers; the head bootstrap receives its own size gate.

## Verification boundaries

Recent production loads had about 0.83–0.93 s between FCP and content-response completion.
Those are response timings, not pixel-change timestamps. A browser-cache-disabled reload
was not a fully cold DNS/TLS/CDN test and did not reproduce the user's longer first visit.

Before/after proof must include fresh browser contexts, repeat visits, delayed fonts,
slow/hung API, blocked loader/CSP, React hydration, nested text/media, private grants and A/B.
The original full-page suite contract is 44 tests; any extra count must update its
explicit contract rather than weaken assertions or introduce skips.

Existing dependency audits still block production release. Source completion, CI,
installation migration and production first-visible-frame proof are distinct gates.
