import Script from "next/script";
import {
  DATAFAST_DOMAIN,
  DATAFAST_SCRIPT_URL,
  DATAFAST_WEBSITE_ID,
  isDataFastEnabled,
} from "@/lib/analytics/datafast";

/**
 * DataFast on every page (see `src/lib/analytics/datafast.ts`).
 *
 * The nonce, and why no `nonce` prop is passed here: the app surface (ADR 059)
 * is a nonce policy with `'strict-dynamic'`, under which a host allowlist
 * alone loads nothing. The root layout cannot read the request nonce itself —
 * `headers()` there would make every marketing page dynamic, which ADR 059
 * rejected for LCP. It does not have to. While rendering a request, Next puts
 * the nonce it parsed from the request's CSP header into `HeadManagerContext`,
 * and `next/script` stamps it on the `<link rel="preload" as="script">` it
 * emits; on the client the script element is inserted by Next's own (nonced)
 * runtime, which `'strict-dynamic'` trusts. On a prerendered marketing page
 * there is no nonce and the static policy's `https://datafa.st` host entry
 * admits it. Both paths are pinned in `__tests__/DataFastScript.test.tsx`;
 * `e2e/csp.spec.ts` checks every script preload on an app page carries the
 * nonce in a real build.
 *
 * `afterInteractive` (DataFast's App Router guidance): after hydration, off
 * the LCP path. The snippet's `defer` is dropped: it means nothing on a
 * script inserted by script.
 */
export function DataFastScript() {
  if (!isDataFastEnabled()) return null;
  return (
    <Script
      src={DATAFAST_SCRIPT_URL}
      strategy="afterInteractive"
      data-website-id={DATAFAST_WEBSITE_ID}
      data-domain={DATAFAST_DOMAIN}
    />
  );
}
