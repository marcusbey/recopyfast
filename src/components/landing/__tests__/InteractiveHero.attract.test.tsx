/**
 * @jest-environment jsdom
 *
 * A-34 — the attract loop has to stop on `/demo` too.
 *
 * `InteractiveHero` ends its attract loop (tab cycling + the hover-ring hint)
 * on the first sign the visitor is driving. Scroll used to be a sign only where
 * a scroll-progress MotionValue was supplied, because the signal lived inside
 * the subscription effect — and that value comes from `HeroDemo`, on the
 * landing page and nowhere else.
 *
 * `src/app/demo/page.tsx:83` mounts `<InteractiveHero />` with no such prop —
 * the page the hero's own "Watch it work" link targets. There the demo's own
 * scrollable viewport is the only thing the visitor scrolls, so that scroll now
 * has to count on its own; otherwise the tabs cycle every 6s while they read.
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
  const scroller = document.querySelector<HTMLElement>("[data-demo-scroller]");
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
  it("mounts with no scroll-progress prop, the way /demo mounts it", () => {
    render(<InteractiveHero />);

    expect(activeTabName()).toContain("Bella Vista");
    expect(getDemoScroller()).toBeInTheDocument();
  });

  /* Vacuous otherwise: if the loop never ran, every assertion about it
     stopping passes for the wrong reason. */
  it("cycles tabs while nobody has touched it", () => {
    render(<InteractiveHero />);
    const startingTab = activeTabName();

    act(() => {
      jest.advanceTimersByTime(TAB_DWELL_MS + 1000);
    });

    expect(activeTabName()).not.toBe(startingTab);
  });

  it("stops cycling tabs once the visitor scrolls the demo itself", () => {
    render(<InteractiveHero />);
    const startingTab = activeTabName();

    /* The gesture a reader on /demo actually makes: the demo's own viewport
       is `overflow-y-auto` there, so their scroll lands here and nowhere
       else. */
    fireEvent.scroll(getDemoScroller(), { target: { scrollTop: 240 } });

    act(() => {
      jest.advanceTimersByTime(TAB_DWELL_MS + 1000);
    });

    expect(activeTabName()).toBe(startingTab);
  });

  it("stops cycling tabs once the visitor points at the demo", () => {
    render(<InteractiveHero />);
    const startingTab = activeTabName();

    fireEvent.pointerDown(getDemoScroller());

    act(() => {
      jest.advanceTimersByTime(TAB_DWELL_MS + 1000);
    });

    expect(activeTabName()).toBe(startingTab);
  });
});
