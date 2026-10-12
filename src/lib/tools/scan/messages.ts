/**
 * Every message `POST /api/tools/scan` can send, fixed (s96, plan decision 1).
 *
 * A caller is anonymous, so no message echoes the submitted value, an
 * exception's text or — above all — an address our resolver answered: "your
 * host resolves to 10.0.0.7" would turn the scanner into a free internal DNS
 * oracle. The visitor learns what kind of problem it was, never its detail.
 */

import type { ScanFailureReason } from "./run-scan";

export const SCAN_FAILURE_MESSAGES: Record<ScanFailureReason, string> = {
  blocked_address: "We can only scan public websites.",
  blocked_port:
    "We can only scan websites on the standard web ports. Remove the :port from the address.",
  dns: "We couldn't find that website. Check the address and try again.",
  timeout: "That website took too long to answer. Try again later.",
  too_large: "That page is too large or too complex for us to read.",
  not_html: "That address didn't return a web page.",
  http_status: "That website answered with an error.",
  redirect_limit: "That website redirected too many times.",
  redirect_invalid: "That website redirected somewhere we can't scan.",
  unreachable: "We couldn't connect to that website.",
  denylisted: "This website has asked not to be scanned.",
  target_limited:
    "That website has been scanned a lot in the last hour. Try again later.",
  robots_disallowed:
    "This website's robots.txt asks automated tools not to read it, so we didn't scan it.",
};

export const SCAN_MESSAGES = {
  disabled: "Free scans are paused right now. Please try again later.",
  notJson: "Send the scan request as JSON.",
  crossSite: "Scans can only be started from this site.",
  unidentified:
    "We couldn't identify your connection, so we can't start a scan.",
  burst: "You're scanning very quickly. Wait a minute and try again.",
  badBody: "Send a tool and a website address.",
  unknownTool: "That tool doesn't exist.",
  notScanTool: "That tool doesn't scan websites.",
  invalidUrl: "Enter a website address, like example.com.",
  daily: "You've used today's free scans. Try again tomorrow.",
  globalCap: "Today's free scans are used up. Try again tomorrow.",
  target:
    "That website has been scanned a lot in the last hour. Try again later.",
  unavailable: "Scans are unavailable right now. Please try again shortly.",
} as const;
