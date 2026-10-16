import { consentDefaults } from "./consent";

/**
 * The body of `/analytics/gtag-init.js` (s107, ADR 063).
 *
 * Why a file and not the usual inline snippet: marketing pages run the static
 * CSP (ADR 059), and this story adds no inline script to them. Why a route
 * and not a file in `public/`: the page is prerendered, so the only way the
 * per-request country hint reaches it without making it dynamic or storing
 * anything is inside a response the browser fetches anyway. The hint arrives
 * here as one boolean; nothing from the request is written into the body.
 *
 * What it does, in order, before gtag.js exists (the component requests
 * gtag.js only after this has run — `next/script` does not order two async
 * scripts):
 * 1. the gtag queue (`dataLayer` + `gtag`, pushing real `arguments` objects:
 *    gtag.js ignores arrays);
 * 2. the two Consent Mode defaults from `consentDefaults`;
 * 3. `url_passthrough: false` and `ads_data_redaction: true`;
 * 4. the hint, frozen, for the component to read.
 *
 * No `config`, no `js`, no event: those are the component's, after the
 * visitor's stored choice is known.
 */
export function buildGtagInitScript({
  consentRequired,
}: {
  consentRequired: boolean;
}): string {
  const defaults = JSON.stringify(consentDefaults({ consentRequired }));
  return [
    "(function () {",
    '"use strict";',
    "var w = window;",
    "var dataLayer = (w.dataLayer = w.dataLayer || []);",
    'if (typeof w.gtag !== "function") {',
    "w.gtag = function () { dataLayer.push(arguments); };",
    "}",
    `var defaults = ${defaults};`,
    'w.gtag("consent", "default", defaults[0]);',
    'w.gtag("consent", "default", defaults[1]);',
    'w.gtag("set", "url_passthrough", false);',
    'w.gtag("set", "ads_data_redaction", true);',
    `w.__rcfAnalytics = Object.freeze({ consentRequired:${consentRequired} });`,
    "})();",
    "",
  ].join("\n");
}
