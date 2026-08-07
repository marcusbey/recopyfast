/**
 * @jest-environment jsdom
 *
 * A-34 — the attract loop does not stop on `/demo`.
 *
 * `InteractiveHero` ends its attract loop (tab cycling + the hover-ring hint)
 * on the first sign the visitor is driving. Scroll is one of those signs, but
 * the signal lives inside the `if (!demoScrollProgress) return` branch of the
 * subscription effect (`InteractiveHero.tsx:180-192`), so it only exists on the
 * landing page, where `HeroDemo` supplies a scroll-progress MotionValue.
 *
 * `src/app/demo/page.tsx:83` mounts `<InteractiveHero />` with no such prop —
 * the page the hero's own "Watch it work" link targets. There the demo's own
 * scrollable viewport is the only thing the visitor scrolls, nothing listens to
 * it, and the tabs keep cycling every 6s while they read.
 *
 * Deliberately a separate file from `InteractiveHero.test.tsx`: that suite is a
 * `describe.skip` written against a version of this component that no longer
 * exists, and it mocks framer-motion flat, which would remove the ref this test
 * needs to reach the demo's scroller.
 */
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import InteractiveHero from "../InteractiveHero";

/** `TAB_DWELL_MS` in InteractiveHero.tsx. */
const TAB_DWELL_MS = 6000;

/**
 * The attract loop only runs while the demo is on screen. jest.setup.js stubs
 * `IntersectionObserver` with an observer that never calls its callback, which
 * would leave `isOnScreen` false, the loop switched off, and this test green
 * for a reason that has nothing to do with the defect.
 */
class OnScreenObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element): void {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** The demo site's own scrollable viewport — `siteScrollRef` in the component. */
function getDemoScroller(): HTMLElement {
  const scroller = document.querySelector<HTMLElement>(
    "[data-demo-surface] .overflow-y-auto",
  );
  if (!scroller) throw new Error("demo scroller not found");
  return scroller;
}

function activeTabName(): string {
  return screen.getByRole("tab", { selected: true }).textContent ?? "";
}

beforeEach(() => {
  jest.useFakeTimers();
  global.IntersectionObserver =
    OnScreenObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("InteractiveHero attract loop on /demo", () => {
  /* Guards the test below: `test.failing` passes on any failure, including a
     render that throws, so the mount path has to be asserted separately. */
  it("mounts with no scroll-progress prop, the way /demo mounts it", () => {
    render(<InteractiveHero />);

    expect(activeTabName()).toContain("Bella Vista");
    expect(getDemoScroller()).toBeInTheDocument();
  });

  test.failing(
    "stops cycling tabs once the visitor scrolls the demo itself",
    () => {
      render(<InteractiveHero />);
      const startingTab = activeTabName();

      /* The gesture a reader on /demo actually makes: the demo's own viewport
       is `overflow-y-auto`, so their scroll lands here and nowhere else. */
      fireEvent.scroll(getDemoScroller(), { target: { scrollTop: 240 } });

      act(() => {
        jest.advanceTimersByTime(TAB_DWELL_MS + 1000);
      });

      expect(activeTabName()).toBe(startingTab);
    },
  );
});
