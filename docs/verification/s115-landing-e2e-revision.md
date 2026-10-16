# s115 landing E2E revision

Date: 2026-10-16

The s114 editorial homepage removed the offer-aware legacy hero, shader sky and pinned `HeroDemo`
track, but four browser checks still targeted those deleted surfaces. The repaired checks now prove:

- Pricing alone renders the open, full and unavailable founding-offer states while the editorial
  hero keeps one stable trial CTA and its approved problem/solution copy.
- A browser with WebGL disabled loads the approved editorial hero image with usable dimensions and
  creates no canvas or legacy `data-sky` surface.
- The real demo in `real-demo-section` owns a native nested mobile scroller, and two real CDP touch
  swipes move it forward without the old backwards snap.

The rest of `landing.spec.ts` was scanned for the removed `#hero`, offer-aware hero CTA and
`data-sky` expectations; no other stale references remain. On a fresh production build served with
`next start`, the four formerly failing tests passed together in 5.7 seconds with no retry.

Follow-up stabilization: the touch helper now stops attraction through the hydrated reload control,
centres the actual `data-demo-scroller`, waits two animation frames for layout, and derives the
gesture from the scroller's visible viewport intersection. Both touch endpoints are asserted inside
that intersection before CDP dispatch, so a cold layout cannot turn the regression check into a
zero-movement retry. The positive final movement and every nondecreasing intermediate sample remain
required. Both mobile tests then passed five consecutive production-mode repetitions: 10/10 tests
in 17.4 seconds with retries disabled.
