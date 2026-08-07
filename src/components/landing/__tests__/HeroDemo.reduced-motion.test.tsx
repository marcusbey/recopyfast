/**
 * @jest-environment jsdom
 *
 * A-32 (reduced-motion half) — the pinned hero demo has no reduced-motion
 * escape.
 *
 * `HeroDemo.tsx:43-99` never calls `useReducedMotion`. A reader who has asked
 * their OS for less motion still gets the full apparatus: a 320vh track, a
 * `sticky` window pinned inside it, and a scroll-driven `scale`/`y` transform
 * on the way out — over two viewports of page scroll that move something other
 * than the page.
 *
 * It is worse than an ignored preference. `useLenis.ts:127` skips Lenis
 * entirely for these readers, so they also inherit the raw two-owners-of-
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

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * jest.setup.js answers every media query with `matches: false`. This replaces
 * it for the one query under test — the reader has asked for less motion.
 */
function requestReducedMotion(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn((query: string) => ({
      matches: query === REDUCED_MOTION_QUERY,
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
  /* Guards the test below: `test.failing` passes on any failure, a render that
     throws included, so the mount has to be asserted on its own. */
  it("renders the demo", () => {
    requestReducedMotion();
    render(<HeroDemo />);

    expect(demoSection()).toBeInTheDocument();
    expect(screen.getByTestId("interactive-hero")).toBeInTheDocument();
  });

  test.failing("drops the pinned scroll track", () => {
    requestReducedMotion();
    render(<HeroDemo />);

    const section = demoSection();
    /* The two halves of the pin. Either one alone still spends the reader's
       scroll on the demo instead of on the page. */
    expect(section.querySelector('[class*="320vh"]')).toBeNull();
    expect(section.querySelector('[class*="sticky"]')).toBeNull();
  });
});
