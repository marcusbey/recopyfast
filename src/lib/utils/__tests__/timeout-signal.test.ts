import { timeoutSignal } from "../timeout-signal";

/**
 * Devin on PR #77: the Changes page's reads and writes called
 * `AbortSignal.timeout`, which Safari before 16 lacks, so every request threw
 * before it was sent. The helper falls back to an AbortController.
 */
describe("timeoutSignal", () => {
  const nativeTimeout = AbortSignal.timeout;

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    AbortSignal.timeout = nativeTimeout;
  });

  it.each([
    ["with AbortSignal.timeout", true],
    ["without AbortSignal.timeout (Safari before 16)", false],
  ])("aborts after the delay and not before, %s", (_label, hasNative) => {
    if (!hasNative) {
      // @ts-expect-error -- removing the API to model a browser without it
      delete AbortSignal.timeout;
    }

    const signal = timeoutSignal(30_000);

    jest.advanceTimersByTime(29_999);
    expect(signal.aborted).toBe(false);

    jest.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).name).toBe("TimeoutError");
  });
});
