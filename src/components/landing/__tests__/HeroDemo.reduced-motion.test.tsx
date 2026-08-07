/**
 * @jest-environment jsdom
 *
 * A-32 (reduced-motion half) — the pinned hero demo needs a reduced-motion
 * escape.
 *
 * Without one, a reader who has asked their OS for less motion still gets the
 * full apparatus: a 320vh track, a `sticky` window pinned inside it, and a
 * scroll-driven `scale`/`y` transform on the way out — over two viewports of
 * page scroll that move something other than the page.
 *
 * It would be worse than an ignored preference. `useLenis.ts:127` skips Lenis
 * entirely for these readers, so they would also inherit the raw two-owners-of-
 * scrollTop conflict the smooth-scroll path papers over (the other half of
 * A-32, covered by `e2e/hero-demo-mobile.spec.ts`).
 *
 * `InteractiveHero` is stubbed here on purpose: the defect and its fix are both
 * in `HeroDemo`'s own track, and the real child mounts three complete demo
 * sites that have nothing to say about it.
 */
import { render, screen, cleanup } from "@testing-library/react";
import HeroDemo from "../HeroDemo";

jest.mock("../InteractiveHero", () => ({
  __esModule: true,
  default: () => <div data-testid="interactive-hero" />,
}));

/**
 * Matched on the feature name rather than on a whole query string: browsers
 * spell it `(prefers-reduced-motion: reduce)` and framer-motion asks for the
 * shorthand `(prefers-reduced-motion)`. Pinning the long form here answered
 * `false` to the only query the component actually makes, which would have left
 * this suite testing the default path under a reduced-motion heading.
 */
const REDUCED_MOTION_FEATURE = "prefers-reduced-motion";

/**
 * jest.setup.js answers every media query with `matches: false`. This replaces
 * it for the one query under test — the reader has asked for less motion.
 *
 * Called before the first render of the file and not undone: framer-motion
 * reads the preference once per module registry and caches it, so a suite
 * cannot flip it back mid-file anyway.
 */
function requestReducedMotion(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn((query: string) => ({
      matches: query.includes(REDUCED_MOTION_FEATURE),
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

function demoSection(): HTMLElement {
  return screen.getByRole("region", { name: "Interactive demo" });
}

afterEach(cleanup);

describe("HeroDemo under prefers-reduced-motion", () => {
  it("renders the demo", () => {
    requestReducedMotion();
    render(<HeroDemo />);

    expect(demoSection()).toBeInTheDocument();
    expect(screen.getByTestId("interactive-hero")).toBeInTheDocument();
  });

  it("drops the pinned scroll track", () => {
    requestReducedMotion();
    render(<HeroDemo />);

    const section = demoSection();
    /* The two halves of the pin. Either one alone still spends the reader's
       scroll on the demo instead of on the page. */
    expect(section.querySelector('[class*="320vh"]')).toBeNull();
    expect(section.querySelector('[class*="sticky"]')).toBeNull();
  });

  /* page.tsx pulls the problem section up by 100svh to park it under this one,
     unconditionally. Drop the track without leaving that viewport of slack
     behind and the pull lands on top of the demo instead of after it. */
  it("keeps a viewport of slack for the section stacked under it", () => {
    requestReducedMotion();
    render(<HeroDemo />);

    expect(demoSection().querySelector('[class*="h-svh"]')).not.toBeNull();
  });
});
