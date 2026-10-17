# Embed budget feasibility — 2026-10-12

Read-only research against reviewed s67b `a57bf70`, under Node 24.14.0. No production source,
artifact, build gate or dependency was changed. Scratch experiments are evidence about candidate
approaches, not approved implementation. The source worktree remained clean and its official
artifact freshness check passed.

## Measured baseline and candidates

| Experiment                                                                                | Full artifact gzip | Widget gzip | Evidence boundary                                                                |
| ----------------------------------------------------------------------------------------- | ------------------ | ----------- | -------------------------------------------------------------------------------- |
| Reviewed artifact                                                                         | 45,769 B           | 32,992 B    | Official build; transport slice 13,141 B                                         |
| Physically remove bundled Socket.IO transport                                             | About 32,990 B     | —           | Size mapping only; native replacement not included                               |
| Terser pass 2 plus only the six used editing-rule exports                                 | 44,583 B           | 31,783 B    | Scratch artifact passed all seven generated-artifact Chromium fixtures           |
| Optimistic invalid floor: optimized artifact, transport and four realtime methods deleted | 31,210 B           | 31,211 B    | Deliberately behavior-breaking; still over target before adding native transport |

The invalid floor is not an implementation proposal. It demonstrates that removing Socket.IO and
applying the measured compression changes alone cannot yet prove the full 30,000-byte goal.
It does not prove that a larger behavior-preserving rewrite is impossible.

## Where the bytes are

- Socket.IO client: 42,162 raw / 13,141 gzip. Its marginal removal saves about 12,779 B in the
  complete concatenated artifact because compression context is shared.
- Widget: 280,636 source bytes, 112,322 minified bytes, 32,992 gzip.
- Shared editing rules: 27,942 source bytes; 8,987 inlined bytes / 3,894 independently gzipped.
  Curated exports save 125 B in the full artifact and 119 B in the widget.
- Deletion-based cost mapping of the largest UI areas: Edit Board 2,945 B; text editor 2,675 B;
  AI suggestions 1,956 B; staging banner 1,773 B; image editor 1,704 B; editor auth client
  1,334 B; injected styles 868 B; form editor 755 B. These costs identify rewrite candidates;
  they are not permission to delete the features.
- Nine editor-UI regions together account for 14,324 B; the remaining core is about 18,668 B.
  Moving those regions to a later request would reduce only bootstrap bytes, not the full
  behavior payload required by this goal.

## Candidate limits

Terser plus curated exports saves 1,186 B in the full artifact and 1,209 B in the widget. Terser
is only transitively present today and `npm ls terser` does not declare it directly. A reproducible
build cannot depend on Next's internal copy; adding a direct build dependency needs an explicit
validated scope. The seven passing scratch fixtures cover CLS, boot, edit/publish, languages,
images, history and nested composition; they do not replace the full embed/browser matrix.

Raising the target from ES2018 to ES2020+ saves only 84 B in the bundle and changes the browser
floor. Mangling underscore properties saves 19 B in the widget. Broader property mangling
reached 31,128 B but failed two fixtures: language UI timed out and the public
`window.ReCopyFast.rescan` method disappeared. It is not behavior-equivalent.

## Existing story ownership

- `s08-embed-transport`: an existing validated plan and ADR 004 select native WebSocket, but the
  plan predates removal of the fallback loader and later authorization/ownership/restoration
  hardening. No current branch or review exists. Refresh research and revalidate the actual
  protocol/compatibility plan before implementation.
- `s06c-embed-shrink`: existing validated plan, no branch or review. Its CSS-minification lever
  was already consumed, its arithmetic is stale, and its fourth acceptance criterion explicitly
  remains undecided. Refresh it against the actual native-transport artifact, not an estimate.
- `s67b`: already reviewed and green. ADRs 066/068 preserve applied-descendant ownership,
  exact whitespace and node identity, complete/partial restoration, descendant-first cleanup,
  retained shared children and discovery protections. These remain constraints on all shrinking.

## Next executable sequence

1. Complete the existing manual release gate for s67b.
2. Refresh s08's research/plan against that exact tree and obtain the required human validation.
3. Implement and test native WebSocket compatibility; measure its real complete artifact.
4. Refresh s06c against those measured bytes, including the Terser dependency decision and
   generated-artifact, CSP, browser, freshness and ratchet tests.
5. If still over 30,000 B, investigate a substantive same-file, behavior-preserving UI rewrite
   under a concrete validated plan. Keep the original 30,000-byte goal intact unless the owner
   explicitly changes it. Lazy chunking, feature removal, weakened protections or bootstrap-only
   accounting do not close this milestone.

No new decision record, browser-floor change, dependency, source implementation or target revision
is authorized by this research report itself.
