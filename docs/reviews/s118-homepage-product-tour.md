# Review — s118-homepage-product-tour

Reviewed October 19, 2026 in the isolated homepage-product-tour checkout against
origin/main b848ce7. This independent review covers the source changes, new
ProductTour component/tests, six shipped WebP assets, research, design, asset
provenance and validated plan. The review was completed before the story commit;
the working diff and added files are the reviewed surface.

## Verdict and findings

No unresolved critical, major or minor implementation findings. The earlier
mobile full-image readability finding is resolved: the dialog preserves the
1440px image width inside its scroll body and requests a sufficiently large
Next image source. The initially missing responsive `sizes` value was caught by
the reviewer test run and fixed before this verdict.

## Checklist

- [x] Hero repair reserves 10px above/below each line for the 9px outline extent,
  retains long-copy horizontal scrolling, and explains the original clipping.
- [x] Hero secondary action targets the actual product-tour section; signup keeps
  its full-document navigation. The existing hands-on demo follows the tour.
- [x] Six chapters cover registration/snippet, installation, editing, publication,
  recent changes and original/live/history comparison, with bounded benefits.
- [x] Imports and shared Dialog APIs exist with the required signatures. DialogBody
  is the scrolling region; the shared focus trap, Escape and close behavior remain.
- [x] Keyboard chapter selection, roving focus, previous/next boundaries, failed
  images, captions, selected-image dialog and homepage composition are covered.
- [x] Editorial cream/ink/teal, typography and scoped CSS follow the existing
  marketing direction. Actual product captures retain their dashboard styling.
- [x] No new dependency, backend, auth, database, widget or billing change.
- [x] No video/play control is advertised without a recording. The screenshot tour
  is the complete present release; recording remains an optional follow-up.

## Independently executed verification

Ran the three changed landing suites after the final sizes fix:
`npm test -- --runInBand src/components/landing/__tests__/ProductTour.test.tsx src/components/landing/__tests__/EditableEditorialHero.test.tsx src/components/landing/__tests__/EditorialHomePage.test.tsx`.
Result: **3 suites, 19 tests passed**.

Before the fix the same command produced exactly one failing test for the missing
responsive sizes value. In addition, a temporary scratch copy of ProductTour was
mapped into its original Jest suite and its Previous boundary guard was neutralized
(`disabled={selectedIndex === 0}` to `disabled={false}`). This produced **1 failed,
4 passed** tests. The real source was never mutated; byte comparison confirmed it
was unchanged after the scratch run. This demonstrates a meaningful boundary
assertion without disrupting the concurrent production-build verification.

Fresh Chromium against the final production build at localhost:3218, viewport
390 × 844, independently verified the history dialog: 358px frame, 1440px rendered
image, 1472px body scroll width, and a requested image URL with `w=1920` from the
responsive sizes hint. Horizontal/vertical panning exposes readable original/live
and history content. Escape fully detaches the dialog and returns focus to
“View full screenshot”. Screenshot evidence: `/tmp/s118-review-mobile-history.png`.

Visually inspected all six final 1440 × 900 assets. They consistently show Bella
Vista, the same hours change (5 to 10 → 5 to 11), matching Changes/history values,
and synthetic sample identifiers. No production credential or unrelated account
identity was visible.

## Evidence limits and scope adjustment

These are actual-component renders with coherent sample data, explicitly presented
as an Example walkthrough. Registration success is composed from production
primitives; editing uses the local homepage demo; Changes/history use deterministic
responses. The visitor image explicitly says Example visitor view. The provenance
document accurately describes these limits. These assets demonstrate the interface
and workflow states, not a completed authenticated installation/publish/database
journey. No production write was performed by this reviewer.

The original capture task was adjusted because local Supabase was unavailable.
The documented sample-state fallback satisfies this bounded marketing release;
a real owner recording and backend journey proof remain separate work. A recording
should exercise register → install/detect → authenticated edit/save → publish →
visitor reload → Changes/history on one authorized site.

The parent owns the full-suite coverage/build/lint/type/format evidence and the
six-width hero/browser verification. This reviewer independently reran the targeted
suites and final mobile dialog, not the entire 541-suite run. Production deployment,
GitHub CI and live-host verification are downstream and are not claimed here.

Max severity: none
Ship allowed: yes
