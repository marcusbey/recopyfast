/**
 * The footer's "Cookie settings" (s107): reopen the consent banner wherever
 * the analytics runtime is mounted.
 *
 * Its own module, with no imports, on purpose. The footer is in every
 * marketing page's chunk; when this lived in `gtag.ts`, the whole runtime
 * (consent, page-location sanitising, gtag wrappers) was copied into nine
 * page chunks on the critical path, and the s17 comparison gate's TBT went
 * over its 200 ms limit (PR #94, Comparison Lighthouse run 38217319595).
 */

export const OPEN_COOKIE_SETTINGS_EVENT = "rcf:open-cookie-settings";

export function openCookieSettings(): void {
  window.dispatchEvent(new CustomEvent(OPEN_COOKIE_SETTINGS_EVENT));
}
