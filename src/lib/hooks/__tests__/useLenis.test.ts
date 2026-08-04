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

beforeEach(() => {
  handlers.clear();
  destroy.mockClear();
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

  it("notifies subscribers on every scroll event", () => {
    const seen: number[] = [];
    const unsubscribe = subscribeScrollProgress((p) => seen.push(p));
    const { unmount } = renderHook(() => useLenis());

    emitScroll(0.1);
    emitScroll(0.2);
    unsubscribe();
    emitScroll(0.3);

    expect(seen).toEqual([0.1, 0.2]);
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
});
