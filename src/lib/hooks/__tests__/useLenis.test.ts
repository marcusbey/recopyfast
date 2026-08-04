/**
 * The scroll store, not the smooth-scrolling.
 *
 * What is worth pinning here is the contract that took scroll off React's
 * render path: progress is published by the hook and pulled by whoever needs
 * it, and `null` means nothing is driving the page. The sky reads that null to
 * decide whether to trust its own prop instead, so if it ever started reporting
 * 0 for "no Lenis mounted" the backdrop would silently pin itself to the top of
 * the page on every route that does not run this hook — a failure that looks
 * like a rendering bug and is actually an API one.
 */
import { renderHook, act } from "@testing-library/react";

type ScrollHandler = (event: { progress: number }) => void;

const handlers = new Set<ScrollHandler>();
const destroy = jest.fn();

jest.mock("lenis", () => {
  return {
    __esModule: true,
    default: class LenisMock {
      on(event: string, handler: ScrollHandler) {
        if (event === "scroll") handlers.add(handler);
      }
      off(event: string, handler: ScrollHandler) {
        if (event === "scroll") handlers.delete(handler);
      }
      raf() {}
      scrollTo() {}
      destroy() {
        destroy();
      }
    },
  };
});

import {
  readScrollProgress,
  subscribeScrollProgress,
  useLenis,
} from "../useLenis";

/** Fires what Lenis fires, without needing a scrollable document. */
function emitScroll(progress: number) {
  act(() => {
    for (const handler of handlers) handler({ progress });
  });
}

/**
 * jsdom lays nothing out, so the document is not scrollable unless told it is.
 * 3000px of content in a 1000px viewport gives a 2000px scroll range, which
 * makes the arithmetic legible: scrollY 500 is progress 0.25.
 */
function setScrollMetrics(scrollY: number, scrollHeight = 3000) {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: 1000,
    configurable: true,
  });
  Object.defineProperty(window, "scrollY", {
    value: scrollY,
    configurable: true,
  });
}

beforeEach(() => {
  handlers.clear();
  destroy.mockClear();
  /* Back to an unscrollable document, so no test inherits another's geometry. */
  setScrollMetrics(0, 0);
});

describe("scroll progress store", () => {
  it("reports null until a Lenis instance is mounted", () => {
    expect(readScrollProgress()).toBeNull();
  });

  it("publishes progress without re-rendering the caller", () => {
    let renders = 0;
    const { unmount } = renderHook(() => {
      renders++;
      return useLenis();
    });

    const rendersAfterMount = renders;
    emitScroll(0.25);
    emitScroll(0.5);
    emitScroll(0.75);

    expect(readScrollProgress()).toBe(0.75);
    expect(renders).toBe(rendersAfterMount);

    unmount();
  });

  it("publishes the exact value rather than a quantised one", () => {
    const { unmount } = renderHook(() => useLenis());

    // Two values inside the same 1/200th step the old implementation used.
    emitScroll(0.1231);
    expect(readScrollProgress()).toBe(0.1231);
    emitScroll(0.1234);
    expect(readScrollProgress()).toBe(0.1234);

    unmount();
  });

  it("notifies subscribers on mount and on every scroll event", () => {
    const seen: number[] = [];
    const unsubscribe = subscribeScrollProgress((p) => seen.push(p));
    // Mount publishes the starting position — an unscrollable jsdom document is
    // 0 — so a subscriber that never sees a scroll still knows where the page
    // is, rather than waiting for one.
    const { unmount } = renderHook(() => useLenis());

    emitScroll(0.1);
    emitScroll(0.2);
    unsubscribe();
    emitScroll(0.3);

    expect(seen).toEqual([0, 0.1, 0.2]);
    unmount();
  });

  it("returns to null on unmount so a later consumer falls back", () => {
    const { unmount } = renderHook(() => useLenis());
    emitScroll(0.6);
    expect(readScrollProgress()).toBe(0.6);

    unmount();

    expect(destroy).toHaveBeenCalled();
    expect(readScrollProgress()).toBeNull();
  });

  it("exposes a scrollTo that is stable across renders", () => {
    const { result, rerender, unmount } = renderHook(() => useLenis());
    const first = result.current.scrollTo;
    rerender();
    expect(result.current.scrollTo).toBe(first);
    unmount();
  });

  it("publishes the current position on mount, before any scroll event", () => {
    // Lenis emits nothing until the reader moves. Leaving the store at `null`
    // until then means consumers read "nothing is driving this page" and fall
    // back to 0, so a page restored partway down showed the top-of-page sky
    // until it was touched.
    setScrollMetrics(500);

    const { unmount } = renderHook(() => useLenis());

    expect(readScrollProgress()).toBe(0.25);
    expect(handlers.size).toBe(1);

    unmount();
  });
});

/**
 * The preference is about the smooth scrolling itself, so the hook has to stop
 * providing it — not provide it faster. What must survive is the store: the sky
 * drives its sunset from progress, and a reader who asked for less animation
 * still has to arrive at the bottom of the page under the right colour.
 */
describe("reduced motion", () => {
  function setReducedMotion(matches: boolean) {
    (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? matches : false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
  }

  /** The native publisher defers its read by a frame, as the Header's does. */
  async function flushFrame() {
    await act(async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => resolve(null)),
      );
    });
  }

  beforeEach(() => {
    setReducedMotion(true);
    setScrollMetrics(500);
  });

  afterEach(() => {
    setReducedMotion(false);
  });

  it("never constructs Lenis", () => {
    const { unmount } = renderHook(() => useLenis());

    // No scroll handler was registered, so nothing subscribed to Lenis, and
    // nothing had to be destroyed — the instance was never built in the first
    // place rather than built and torn down.
    expect(handlers.size).toBe(0);
    expect(destroy).not.toHaveBeenCalled();

    unmount();
  });

  it("publishes progress from the document's own scroll position", async () => {
    // 500px down a 3000px document in a 1000px viewport: 500 / 2000.
    const { unmount } = renderHook(() => useLenis());

    // Published on mount, so a page opened partway down is not pinned to the top.
    expect(readScrollProgress()).toBe(0.25);

    setScrollMetrics(1500);
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });
    await flushFrame();

    expect(readScrollProgress()).toBe(0.75);

    unmount();
  });

  it("notifies subscribers, so the sky still follows the page down", async () => {
    const seen: number[] = [];
    const unsubscribe = subscribeScrollProgress((progress) =>
      seen.push(progress),
    );
    const { unmount } = renderHook(() => useLenis());

    setScrollMetrics(2000);
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });
    await flushFrame();

    expect(seen).toContain(1);

    unsubscribe();
    unmount();
  });

  it("clamps to the ends rather than reporting past them", async () => {
    // Rubber-band overscroll on a trackpad reports a scrollY beyond the maximum.
    const { unmount } = renderHook(() => useLenis());

    setScrollMetrics(9999);
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });
    await flushFrame();

    expect(readScrollProgress()).toBe(1);

    unmount();
  });

  it("returns to null on unmount, as the Lenis path does", () => {
    const { unmount } = renderHook(() => useLenis());
    expect(readScrollProgress()).toBe(0.25);

    unmount();

    expect(readScrollProgress()).toBeNull();
  });
});
