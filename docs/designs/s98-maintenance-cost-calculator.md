# Design — s98-maintenance-cost-calculator (retrospective)

Recorded on 2026-10-12 from the merged page source on `origin/main` `bc6e503`. This file repairs a missing
pipeline artifact. It describes the final implementation; it does not claim the design existed
before PR #92 was built, reviewed or merged.

No standalone HTML mockup is added. This is a retrospective record of an already implemented UI,
and the current page/components are the exact visual reference. Creating a second HTML rendering
now would introduce a less reliable duplicate rather than inform future implementation.

## Surface and design-system anchor

The calculator is a pinned-light marketing tool, consistent with `/tools`:

- page ground: `slate-50`;
- headings: `font-display`, slate foreground, tight tracking;
- accent: sky eyebrow, borders and CTA panel;
- content width: `max-w-5xl` with 24 px page gutters;
- existing primitives: `Input`, `Label`, `NativeSelect`, `CodeBlock`, `Header`, `Footer`;
- existing shape: `rounded-container` for form/result panels, larger marketing radii for FAQ and
  final CTA.

No dashboard component, Context provider, motion library or new primitive is introduced.

## Page sequence

1. **Header and breadcrumb.** Home / Free tools / Website maintenance cost calculator.
2. **Intro.** Eyebrow “Free calculator”, h1 “What free copy changes cost you”, and one paragraph
   framing free client copy work in the visitor's own terms.
3. **Calculator.** Two columns on large screens, one column on mobile:
   - left: the white form card;
   - right: result, honesty line, then share card/snippet when complete.
4. **FAQ.** Three visible question/answer rows in one bordered white surface.
5. **CTA.** Sky panel with the supported client-editing claim, signup action and desktop `/try`
   action.
6. **Footer.** Standard marketing footer.

## Calculator states

### Complete/default

All five numeric fields and currency are present. The right panel shows:

- eyebrow “Your numbers”;
- label “Unbilled copy changes, per year”;
- one large yearly figure;
- the full arithmetic sentence;
- the honesty line;
- “Share your result”, the card preview and copyable HTML.

The default is a real, clearly labelled example derived from 10 sites, 2 changes, 20 minutes,
$60/hour and 0% billed.

### Editing

The visible figure and formula update immediately. The URL waits 300 ms; the live-region text
waits 500 ms. Tests verify those update timings. The delay is intended to reduce announcement
noise; attended screen-reader behavior is not established by those tests.

### Empty field

The result panel says “Fill in all fields to see your number”. The share card and HTML disappear,
and the incomplete form is not written into the URL.

### Invalid or clamped

The field remains editable. A destructive-colored line names the accepted range and the underlying
calculation uses the clamped/default value. A valid value between steps uses a muted “Rounded to …”
line instead of an error. `aria-invalid` is set only for the range/error state.

## Form details

Order is sites, changes per site per month, minutes per change, hourly rate, share billed, currency.
Each field has a visible label and concise help that explains the number rather than the math. The
currency control offers only USD, EUR and GBP.

The form has no submit action. It is a live calculator; preventing submit also prevents Enter from
navigating or reloading.

## Result-card design

The preview is deliberately a small external-host artifact, not another app card. It has a white
ground, neutral border, dark type and a teal CTA line, capped at 360 px. Its four lines are:

1. “Free copy changes cost us”
2. “<yearly figure> a year”
3. the visitor's input summary
4. “Calculate yours · ReCopyFast”

Those colors are fixed literals because the pasted HTML must retain a readable appearance on a
stranger's page regardless of this site's theme. This is the one deliberate token exception. The
surrounding ReCopyFast page still uses the design system.

The preview itself does not navigate. The copied HTML is one link back to the calculator with the
same values and embed attribution.

## Responsive behavior (CSS-derived contract)

The source breakpoint and sizing classes specify the layouts below. Existing Playwright coverage
checks the 390 px flow and absence of horizontal document scrolling; this retrospective review
did not capture fresh 1440 px or cross-browser visual evidence.

- **390 px:** one column; form precedes result; every control uses the available width; formula and
  yearly figure wrap; the `CodeBlock` wraps; the fixed-width card caps at the viewport; no sideways
  scrolling.
- **1440 px:** calculator uses two equal flexible columns with a 40 px gap; the rest of the page
  remains centered inside `max-w-5xl`.

The FAQ and CTA stay single-surface sections at both widths. CTA actions stack on mobile and share a
row from `sm` upward.

## Accessibility contract

- One visible h1 and logical h2 sections.
- Every field is reached by its label and described by its hint plus any issue/rounding line.
- The only live region is an `sr-only` headline, polite and debounced.
- The visible result is not live.
- The result card preview is a named group.
- Decorative arrows are hidden from assistive technology.
- Copy action comes from the existing accessible `CodeBlock` primitive.
- Error meaning is expressed in text, not color alone.

## Copy and claims

The design never introduces an industry average, benchmark, testimonial or time-saved estimate.
The large figure is explicitly “Your numbers”, and the honesty line states that ReCopyFast does not
publish averages, benchmarks or savings estimates. The CTA describes only the supported invited
editing flow and keeps signup/try attribution in the destination URLs.

## Design-system gaps

No new product-surface gap. The pasted card's fixed external-host palette is a documented export
contract rather than a reusable ReCopyFast token set.

Design backfill complete. Future changes should update this file only when the implemented interaction
or visual contract changes; a separate mockup is unnecessary unless a new design is proposed.
