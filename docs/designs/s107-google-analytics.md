# Design — Story s107-google-analytics

> **Retrospective artifact, 2026-10-12.** The UI shipped on the story branch before this design
> record existed. This file describes the implemented interface at `12da10d`; it does not claim a
> pre-implementation `/ks-design` checkpoint. The fresh `/ks-review` still owns acceptance.

The story adds one small interface to the existing Marketing surface: a fixed consent banner and
a footer control that can reopen it. The rest of GA is deliberately invisible. No route, page
layout, marketing section or app screen is redesigned. ADR 063 supplies the accepted analytics
baseline; ADR 069 governs the later document boundary, report exclusion and effective-state UI.

## Surfaces and entry points

### Consent banner on an allowed marketing document

The banner sits above the bottom edge, centred at `max-w-3xl`, with 16 px viewport gutters and a
safe-area-aware bottom inset. Its panel is a `data-theme="light"` composition of the existing
`Button` primitive and card tokens: `bg-card`, `border-border`, `text-foreground`,
`text-muted-foreground`, `rounded-container`, `shadow-md`. The shadow is valid because the panel
floats over the document.

Content order:

1. h2: **Analytics cookies**;
2. one state-specific explanation;
3. **How we use analytics** → `/privacy#analytics`;
4. equal-weight outline buttons: **Allow analytics**, then **Decline**;
5. after a choice exists, a ghost icon button: **Close cookie settings**.

An in-flow spacer at the end of the document matches the measured banner height. Opening the
banner therefore does not shift content already on screen, and the footer can still scroll above
the fixed panel.

### Footer control

**Cookie settings** is a text button after Privacy Policy and Terms of Service in the existing
Legal list. It uses the same slate text and hover treatment as neighbouring links. It appears only
after hydration, with a valid measurement id, while both the current route and the document's
original route are allowed to run analytics.

It is absent on app/auth/settings documents, on free-tool reports, and on marketing routes reached
inside one of those documents by client navigation. On those surfaces there is no analytics
runtime and therefore no setting to open (ADR 069).

## Mockup

`docs/designs/s107-google-analytics.html` is the low-fidelity reference. Its state controls show
the first-visit question, effective granted state, denied state, analytics-disabled build and a
free-tool report. The controls are part of the reference harness, not product UI. Execute uses the
real shared footer and `src/components/ui/button.tsx`; the HTML is never copied into production.

## States

| State                                            | Banner                                                                        | Footer control | Dismissal                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------- |
| GA id absent or invalid                          | Hidden                                                                        | Hidden         | —                                                              |
| Allowed page, consent required, no choice        | Ask copy; neither answer pressed                                              | Visible        | No close button; Escape does nothing until the visitor chooses |
| Allowed page, granted                            | Hidden until reopened; on reopen says analytics is on and Allow is pressed    | Visible        | Close button and Escape dismiss                                |
| Allowed page, denied                             | Hidden until reopened; on reopen says analytics is off and Decline is pressed | Visible        | Close button and Escape dismiss                                |
| Allowed region with no stored choice             | Analytics runs; on reopen use the effective granted state                     | Visible        | Close button and Escape dismiss                                |
| Free-tool report or other excluded path          | Hidden                                                                        | Hidden         | —                                                              |
| Allowed client route inside an excluded document | Hidden                                                                        | Hidden         | —                                                              |

The buttons keep equal visual weight in every state. A consent request cannot make Decline less
prominent than Allow. `aria-pressed` describes the effective choice rather than merely the cookie
value.

## Interaction and accessibility

- The panel is a labelled and described `region`, not a blocking dialog. The page stays usable
  while the visitor decides.
- Native buttons preserve Tab, Enter and Space. The privacy explanation is an ordinary link.
- Reopening from the footer moves focus to Allow analytics. Closing returns focus to the trigger
  when it is still connected.
- On a first visit that requires a choice, the panel has no close affordance. After a choice is
  effective, the labelled close button appears and Escape dismisses from within the panel.
- Copy describes the real state. A visitor outside a consent-required region does not see “only
  if you allow” after analytics has already started.
- The live region around the banner announces its appearance without turning the whole panel into
  an alert.

## Responsive behaviour

- At 390 px the panel keeps 16 px viewport gutters. Its two actions wrap with an 8 px gap rather
  than shrinking below the Button primitive's control height.
- At 1440 px the panel remains `max-w-3xl`; copy does not stretch to the marketing container.
- The close action occupies the top-right icon slot and the heading keeps right padding so the two
  never overlap.
- Safe-area padding protects the actions on devices with a home indicator.

## Reused components and tokens

- `Button`: `outline` for both consent choices; `ghost`, `icon-sm` for close.
- Existing footer list and link typography; the settings action matches it rather than becoming a
  new button treatment.
- Card tokens for the floating panel, pinned light with `data-theme="light"` so a marketing page
  cannot switch it into the app's dark palette.
- Instrument Sans body typography; 16/600 panel title and 14 px supporting copy.
- One-pixel border, 4 px spacing scale, global focus-visible treatment and `shadow-md` for the
  floating surface.
- Existing `/privacy#analytics` content; no tooltip, modal, toast or new icon beyond Lucide `X`.

## Design system gaps

The design system already records that the product has no banner/toast primitive. This story
composes a one-off consent region from `Button` and card tokens instead of adding a generic
primitive. That is the only applicable gap; the footer treatment and every token already exist.

No new colour, spacing value, radius, animation or dependency is introduced. The free-tool report
keeps its s96 design unchanged; absence of the control there is the intended state.
