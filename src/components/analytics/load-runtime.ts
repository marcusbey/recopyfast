import type { GoogleAnalyticsRuntime } from "./GoogleAnalyticsRuntime";

/**
 * Fetches the analytics runtime chunk (s107). A plain dynamic `import()`, not
 * `next/dynamic`, so the shell decides how the loaded runtime is rendered: in
 * `startTransition`, in yielding slices. Through `next/dynamic` its first
 * render was one 63 ms task in the s17 gate's traces (PR #94, Comparison
 * Lighthouse run 38217319595). Its own module so the shell's tests can count
 * fetches.
 */
export function loadGoogleAnalyticsRuntime(): Promise<
  typeof GoogleAnalyticsRuntime
> {
  return import("./GoogleAnalyticsRuntime").then(
    (module) => module.GoogleAnalyticsRuntime,
  );
}
