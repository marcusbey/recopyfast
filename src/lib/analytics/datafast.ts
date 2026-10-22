/**
 * DataFast — the owner's attribution analytics (CTO decision, 2026-10-22).
 *
 * Unlike Google Analytics (s107, ADR 063/069) it runs on EVERY page — the
 * marketing surface, /signup, /login and the dashboard — because its job is
 * attributing the signup funnel, and it is deliberately NOT routed through the
 * GA consent gate. The values below are the owner's snippet, verbatim:
 *
 *   <script defer data-website-id="dfid_Vk5ah6dRMY195GtTY4lIP"
 *     data-domain="recopyfa.st" src="https://datafa.st/js/script.js"></script>
 *
 * The website id is public by design (it is in every page's HTML), so it is a
 * constant, not a secret. The script beacons to `${DATAFAST_ORIGIN}/api/events`,
 * which is why the CSP names this origin in connect-src as well as script-src.
 */

export const DATAFAST_WEBSITE_ID = "dfid_Vk5ah6dRMY195GtTY4lIP";
export const DATAFAST_DOMAIN = "recopyfa.st";
export const DATAFAST_ORIGIN = "https://datafa.st";
export const DATAFAST_SCRIPT_URL = `${DATAFAST_ORIGIN}/js/script.js`;

/**
 * On unless `NEXT_PUBLIC_DATAFAST_DISABLED` is exactly `"true"` — the switch
 * for a build that must make no third-party request (CI, local fixtures).
 * DataFast also ignores localhost by itself. Read at call time; in the browser
 * bundle Next inlines the literal access at build time, so it stays spelled
 * out in full here. Off means no script AND no CSP origin (the middleware asks
 * the same function), so the two cannot disagree.
 */
export function isDataFastEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DATAFAST_DISABLED !== "true";
}
