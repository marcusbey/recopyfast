/**
 * @jest-environment node
 *
 * s66a review m2. The layout harness read a Tailwind ring as the smallest
 * `0px 0px 0px <n>px` spread in `box-shadow`. Tailwind v4 composes five shadow
 * layers and Chromium serialises the unused ones as
 * `rgba(0, 0, 0, 0) 0px 0px 0px 0px`, so the smallest spread was always 0: the
 * ring check could never pass, and AC 7 rested on the unlayered global
 * `:focus-visible` outline alone.
 *
 * The fixtures below are what Chromium computed on /login (2026-10-08) for a
 * keyboard-focused `ui/Button` and `ui/Input`.
 */

import {
  focusIndicatorWidth,
  type FocusStyle,
} from "../../../e2e/support/focus-indicator";

const UNUSED = "rgba(0, 0, 0, 0) 0px 0px 0px 0px";
const BUTTON_RING = `${UNUSED}, ${UNUSED}, rgb(249, 250, 251) 0px 0px 0px 2px, rgb(33, 110, 105) 0px 0px 0px 4px, ${UNUSED}`;
const NO_RING = [UNUSED, UNUSED, UNUSED, UNUSED, UNUSED].join(", ");

const NO_OUTLINE = {
  outlineStyle: "none",
  outlineWidth: "0px",
  outlineColor: "rgb(117, 117, 117)",
};
const GLOBAL_OUTLINE = {
  outlineStyle: "solid",
  outlineWidth: "2px",
  outlineColor: "rgb(33, 110, 105)",
};

function style(overrides: Partial<FocusStyle>): FocusStyle {
  return { ...NO_OUTLINE, boxShadow: "none", ...overrides };
}

describe("focusIndicatorWidth", () => {
  it("reads ring-2 ring-offset-2 as a 2px ring, past its unused 0px layers", () => {
    expect(focusIndicatorWidth(style({ boxShadow: BUTTON_RING }))).toBe(2);
  });

  it("reads a ring with no offset at its spread", () => {
    expect(
      focusIndicatorWidth(
        style({ boxShadow: `${UNUSED}, rgb(33, 110, 105) 0px 0px 0px 2px` }),
      ),
    ).toBe(2);
  });

  it("takes the global :focus-visible outline when there is no ring", () => {
    expect(
      focusIndicatorWidth(style({ ...GLOBAL_OUTLINE, boxShadow: NO_RING })),
    ).toBe(2);
  });

  it("still finds the ring if the global outline stops applying", () => {
    // What a `focus-visible:outline-none` element computes once the global
    // rule is layered below the utilities.
    expect(
      focusIndicatorWidth(style({ ...NO_OUTLINE, boxShadow: BUTTON_RING })),
    ).toBe(2);
  });

  it("finds no indicator when there is neither", () => {
    expect(focusIndicatorWidth(style({ boxShadow: NO_RING }))).toBe(0);
    expect(focusIndicatorWidth(style({ boxShadow: "none" }))).toBe(0);
  });

  it("does not count a transparent outline (outline-hidden)", () => {
    expect(
      focusIndicatorWidth(
        style({
          outlineStyle: "solid",
          outlineWidth: "2px",
          outlineColor: "rgba(0, 0, 0, 0)",
        }),
      ),
    ).toBe(0);
  });

  it("does not count transparent ring layers, in either colour syntax", () => {
    expect(
      focusIndicatorWidth(
        style({
          boxShadow:
            "rgba(33, 110, 105, 0) 0px 0px 0px 2px, oklch(0.5 0.1 200 / 0) 0px 0px 0px 4px",
        }),
      ),
    ).toBe(0);
  });

  it("counts an opaque ring whose last colour channel is 0", () => {
    expect(
      focusIndicatorWidth(
        style({ boxShadow: "rgb(255, 0, 0) 0px 0px 0px 2px" }),
      ),
    ).toBe(2);
  });

  it("does not mistake an elevation shadow for a ring", () => {
    expect(
      focusIndicatorWidth(
        style({
          boxShadow:
            "rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.1) 0px 2px 4px -2px",
        }),
      ),
    ).toBe(0);
  });

  it("does not count an inset ring", () => {
    expect(
      focusIndicatorWidth(
        style({ boxShadow: "rgb(33, 110, 105) 0px 0px 0px 2px inset" }),
      ),
    ).toBe(0);
  });

  it("takes the wider of outline and ring", () => {
    expect(
      focusIndicatorWidth(
        style({
          outlineStyle: "solid",
          outlineWidth: "3px",
          outlineColor: "rgb(33, 110, 105)",
          boxShadow: BUTTON_RING,
        }),
      ),
    ).toBe(3);
  });
});
