/**
 * An `AbortSignal` that aborts after `ms`, as `AbortSignal.timeout(ms)` does.
 *
 * `AbortSignal.timeout` is missing in Safari before 16 (the embed already
 * treats it as optional), and calling it there throws before any request is
 * sent: the Changes page could not load at all (Devin on PR #77). Where it is
 * missing, an `AbortController` aborts with the same `TimeoutError`.
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
  }, ms);
  return controller.signal;
}
