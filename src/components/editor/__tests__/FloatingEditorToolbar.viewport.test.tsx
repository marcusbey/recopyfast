/**
 * @jest-environment jsdom
 *
 * A-33 — the editor toolbar's Save and Cancel sit off-screen on a phone.
 *
 * `InteractiveHero.tsx:204` tells `useFloatingPosition` the toolbar is 420px
 * wide. The hook clamps `left` to a minimum (`useFloatingPosition.ts:95-98`)
 * but never shrinks, wraps or reflows, so on a 390px viewport it hands back
 * `left: 12` for a strip that needs 420 — and `FloatingEditorToolbar.tsx:97-101`
 * renders it `fixed`, out of flow, with nothing able to scroll to the overflow.
 * Save and Cancel are the last two children, so they are what falls off. The
 * demo's advertised primary action has no reachable confirm or cancel.
 *
 * ON MEASUREMENT. jsdom lays nothing out: every `scrollWidth` is 0 and every
 * `getBoundingClientRect()` is zeros, so the toolbar's width has to be modelled
 * rather than measured. The model below is derived from the toolbar's own fixed
 * Tailwind sizing and counted off the rendered DOM, so removing a button or
 * shrinking the input moves it — but it is a model, and only the Playwright
 * spec can measure the real thing.
 */
import { render, screen, cleanup } from "@testing-library/react";
import FloatingEditorToolbar from "../FloatingEditorToolbar";
import { useFloatingPosition } from "@/lib/hooks/useFloatingPosition";
import type { TypographyStyles } from "@/types/editor";

/** iPhone 13 CSS pixels — the viewport the finding names. */
const VIEWPORT_WIDTH = 390;
const VIEWPORT_HEIGHT = 844;

/** What InteractiveHero.tsx:201-207 passes for this toolbar. */
const DECLARED_TOOLBAR_WIDTH = 420;
const TOOLBAR_HEIGHT = 48;
const TOOLBAR_OFFSET = 12;

/* The width model, in the toolbar's own units. */
/** `p-2` (8+8) around a 16px lucide icon. */
const ICON_BUTTON_PX = 32;
/** `px-3` + 16px Sparkles + `mr-2` + the `w-48` input + the 1px right rule. */
const AI_SECTION_PX = 241;
/** `w-px` + `mx-1`. */
const DIVIDER_PX = 9;
/** The action group's `px-2` plus its four `gap-1` gaps. */
const ACTION_GROUP_CHROME_PX = 32;

const STYLES: TypographyStyles = {
  fontSize: "1rem",
  fontWeight: "400",
  color: "#000000",
  textAlign: "left",
};

function boundsOf(left: number, top: number, width: number, height: number) {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Mirrors how InteractiveHero positions and renders the toolbar. */
function ToolbarHarness({ elementBounds }: { elementBounds: DOMRect }) {
  const { position } = useFloatingPosition({
    elementBounds,
    toolbarHeight: TOOLBAR_HEIGHT,
    toolbarWidth: DECLARED_TOOLBAR_WIDTH,
    offset: TOOLBAR_OFFSET,
  });

  return (
    <FloatingEditorToolbar
      position={position}
      styles={STYLES}
      onStylesChange={() => {}}
      onSave={() => {}}
      onDelete={() => {}}
      isVisible
    />
  );
}

function renderToolbar(): HTMLElement {
  /* A headline near the top of a phone-width demo: full-bleed but for the
     page gutter, which is the widest an element can be here. */
  render(
    <ToolbarHarness
      elementBounds={boundsOf(16, 320, VIEWPORT_WIDTH - 32, 40)}
    />,
  );

  const toolbar = document.querySelector<HTMLElement>('[class*="z-[9999]"]');
  if (!toolbar) throw new Error("toolbar did not render");
  return toolbar;
}

/** What `scrollWidth` would report in a browser, counted off the rendered DOM. */
function modelledScrollWidth(toolbar: HTMLElement): number {
  const inputs = toolbar.querySelectorAll("input").length;
  const buttons = toolbar.querySelectorAll("button").length;
  const dividers = toolbar.querySelectorAll('[class*="w-px"]').length;

  return (
    inputs * AI_SECTION_PX +
    buttons * ICON_BUTTON_PX +
    dividers * DIVIDER_PX +
    ACTION_GROUP_CHROME_PX
  );
}

let originalWidth: number;
let originalHeight: number;

beforeEach(() => {
  originalWidth = window.innerWidth;
  originalHeight = window.innerHeight;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: VIEWPORT_WIDTH,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: VIEWPORT_HEIGHT,
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalWidth,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: originalHeight,
  });
});

describe("FloatingEditorToolbar on a 390px viewport", () => {
  /* Guards the two below: `test.failing` passes on any failure, a render that
     throws included, so what is being measured has to be asserted on its own. */
  it("renders Save and Cancel as the last two controls", () => {
    const toolbar = renderToolbar();

    expect(screen.getByTitle("Save changes")).toBeInTheDocument();
    expect(screen.getByTitle("Cancel")).toBeInTheDocument();

    const buttons = Array.from(toolbar.querySelectorAll("button"));
    expect(buttons.slice(-2).map((button) => button.title)).toEqual([
      "Save changes",
      "Cancel",
    ]);
    expect(Number.parseFloat(toolbar.style.left)).not.toBeNaN();
  });

  /* STAYS `test.failing`, and not because the toolbar is still broken — the two
     assertions below cannot both hold for any value of `left`, so no production
     change can retire this marker. 420 is wider than 390, so the second wants
     `left <= -30` while the first wants `left >= 0`. It fails at 432 vs 390.

     What it is really asking — that the strip fit the phone — is asked by
     "keeps Save and Cancel on screen" below, which measures the modelled width
     of what is actually rendered rather than the 420 the positioner was told.
     That one is enforced, and passes: the toolbar now reflows on a narrow
     viewport instead of overflowing (FloatingEditorToolbar.tsx).

     Rewriting the arithmetic here would mean choosing a new constant to compare
     against, which is the assertion doing the test's job for it. Left as-is for
     whoever revisits what `DECLARED_TOOLBAR_WIDTH` should be at this size. */
  test.failing("keeps the width it declares inside the viewport", () => {
    const toolbar = renderToolbar();
    const left = Number.parseFloat(toolbar.style.left);

    /* The positioner's own contract: it was told the strip is 420 wide, and it
       placed it where only 378 remain. */
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + DECLARED_TOOLBAR_WIDTH).toBeLessThanOrEqual(VIEWPORT_WIDTH);
  });

  it("keeps Save and Cancel on screen", () => {
    const toolbar = renderToolbar();
    const left = Number.parseFloat(toolbar.style.left);

    /* Cancel is the last child, so the toolbar's right edge is its right edge:
       past the viewport means past the phone, and `fixed` means nothing can
       scroll to it. */
    expect(left + modelledScrollWidth(toolbar)).toBeLessThanOrEqual(
      VIEWPORT_WIDTH,
    );
  });
});
