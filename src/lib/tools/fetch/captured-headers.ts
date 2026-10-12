/**
 * The response headers a scan keeps (s96, plan decision 4).
 *
 * An allowlist, frozen here for every lens: the CSP checker (s97) reads the
 * policies and the platform hints, so s97 never edits the fetcher. Anything not
 * listed is dropped on arrival — `set-cookie` above all, which would otherwise
 * carry a stranger's session id into a public report.
 *
 * Each value is capped at 4 KB. Node joins a repeated header with ", ", which
 * for a CSP header is exactly the "several policies" form the spec defines.
 */

import type { IncomingHttpHeaders } from "node:http";
import { clampText } from "@/lib/tools/text";

export const CAPTURED_RESPONSE_HEADERS = [
  "content-security-policy",
  "content-security-policy-report-only",
  "server",
  "x-powered-by",
  "x-generator",
  "via",
  "x-shopify-stage",
  "x-shopid",
  "x-wix-request-id",
  "x-vercel-id",
  "x-nextjs-cache",
  "x-nf-request-id",
  "x-frame-options",
] as const;

export type CapturedHeaderName = (typeof CAPTURED_RESPONSE_HEADERS)[number];

export type CapturedHeaders = Partial<Record<CapturedHeaderName, string>>;

export const MAX_CAPTURED_HEADER_LENGTH = 4096;

export function captureHeaders(headers: IncomingHttpHeaders): CapturedHeaders {
  const captured: CapturedHeaders = {};
  for (const name of CAPTURED_RESPONSE_HEADERS) {
    const raw = headers[name];
    if (raw === undefined) continue;
    const value = Array.isArray(raw) ? raw.join(", ") : String(raw);
    captured[name] = clampText(value, MAX_CAPTURED_HEADER_LENGTH);
  }
  return captured;
}
