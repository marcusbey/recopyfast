import { serializeConsentCookie, type ConsentChoice } from "./consent";
import { sanitizePageLocation } from "./page-location";

/**
 * Everything the browser sends Google Analytics goes through this file
 * (s107, ADR 063). The component (`GoogleAnalytics`) decides WHEN analytics is
 * active; this file decides WHAT may leave.
 *
 * - `track()` is a no-op until `setAnalyticsActive(id, true)`: GA configured,
 *   an allowlisted route, consent granted. Leaving the allowlist by a client
 *   navigation, or declining, makes it a no-op again and raises Google's own
 *   opt-out flag (`window['ga-disable-<id>']`), so enhanced measurement's
 *   automatic events (scroll, outbound click, file download) stop too.
 * - Params are slugs or nothing. A value is lower-cased and must match
 *   `SLUG`; anything else — an email, a URL, a query string — is dropped, and
 *   an event only ever carries the keys it declares in `EVENT_PARAMS`.
 * - Every page view and event carries the sanitised `page_location`
 *   (`page-location.ts`), never `location.href`.
 *
 * Per-document state lives in this module: one browser tab, one GA config.
 */

/** The events the marketing site sends, and the params each may carry. */
export interface AnalyticsEvents {
  /** A click on a same-origin link to /signup. */
  generate_lead: { cta_location: string };
  /** A click on a same-origin link into checkout (/dashboard/billing). */
  begin_checkout: { cta_location: string };
  /** The /try sample preview became active. */
  try_started: Record<string, never>;
  /**
   * A free tool produced the visitor's own result. s98's calculator sends it
   * once per page view; s96's scanners call `track("tool_scan_completed",
   * { tool_slug })` when a scan report is ready (docs/operations/analytics.md).
   */
  tool_scan_completed: { tool_slug: string };
}

export type AnalyticsEventName = keyof AnalyticsEvents;

const EVENT_PARAMS: { [E in AnalyticsEventName]: readonly string[] } = {
  generate_lead: ["cta_location"],
  begin_checkout: ["cta_location"],
  try_started: [],
  tool_scan_completed: ["tool_slug"],
};

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * `_ga` / `_ga_<id>` lifetime: 13 months (395 days) instead of Google's two
 * years, the ceiling European regulators accept for audience-measurement
 * cookies, and in line with the property's 14-month data retention. gtag.js
 * still renews it on each visit, as GA's session cookie requires.
 */
export const GA_COOKIE_EXPIRES_SECONDS = 395 * 24 * 60 * 60;

type Gtag = (...args: unknown[]) => void;

let activeMeasurementId: string | null = null;
let configuredMeasurementId: string | null = null;
let lastPageLocation: string | null = null;

function analyticsWindow(): Record<string, unknown> {
  return window as unknown as Record<string, unknown>;
}

function gtag(): Gtag | null {
  const fn = analyticsWindow().gtag;
  return typeof fn === "function" ? (fn as Gtag) : null;
}

function disableFlag(measurementId: string): string {
  return `ga-disable-${measurementId}`;
}

/**
 * `gtag('js')` and `gtag('config')`, once per document. Runs after the init
 * script queued the Consent Mode defaults, and applies a stored "granted"
 * choice before the config so the first hit already carries it. No automatic
 * page view: `trackPageView` sends each one with a sanitised URL.
 */
export function startGoogleAnalytics(
  measurementId: string,
  { choice }: { choice: ConsentChoice | null },
): void {
  const fn = gtag();
  if (!fn || configuredMeasurementId === measurementId) return;
  if (choice === "granted") {
    fn("consent", "update", { analytics_storage: "granted" });
  }
  fn("js", new Date());
  fn("config", measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_expires: GA_COOKIE_EXPIRES_SECONDS,
  });
  configuredMeasurementId = measurementId;
}

/** Turns sending on or off for this document. Off also stops gtag.js itself. */
export function setAnalyticsActive(
  measurementId: string,
  isActive: boolean,
): void {
  analyticsWindow()[disableFlag(measurementId)] = !isActive;
  activeMeasurementId = isActive ? measurementId : null;
  if (!isActive) lastPageLocation = null;
}

export function isAnalyticsActive(): boolean {
  return activeMeasurementId !== null;
}

/**
 * One page view, for the current URL. The first one of a document is the
 * landing and keeps its `utm_*`; a later one is a client navigation and keeps
 * none. Its referrer is the previous page (sanitised), or the document's
 * referrer (sanitised) on the landing. The location is also `set`, so the
 * automatic enhanced-measurement events that follow carry it too.
 */
export function trackPageView(): void {
  const fn = gtag();
  if (!activeMeasurementId || !fn) return;

  const isLanding = lastPageLocation === null;
  const pageLocation = sanitizePageLocation(window.location.href, {
    keepCampaign: isLanding,
  });
  if (!pageLocation) return;
  const pageReferrer = isLanding
    ? document.referrer
      ? sanitizePageLocation(document.referrer, { keepCampaign: false })
      : null
    : lastPageLocation;

  const params = {
    page_location: pageLocation,
    ...(pageReferrer ? { page_referrer: pageReferrer } : {}),
  };
  fn("set", params);
  fn("event", "page_view", params);
  lastPageLocation = pageLocation;
}

function sanitizeEventParams(
  event: AnalyticsEventName,
  params: Record<string, unknown>,
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of EVENT_PARAMS[event]) {
    const raw = params[key];
    if (typeof raw !== "string") continue;
    const value = raw.trim().toLowerCase();
    if (SLUG.test(value)) safe[key] = value;
  }
  return safe;
}

/**
 * Sends one event, if analytics is active. Never throws. Returns whether the
 * event was handed to gtag: a caller that sends something once per page view
 * marks it sent only on `true`, so a call made before consent or before the
 * init script ran does not use it up (PR #94 review).
 */
export function track<E extends AnalyticsEventName>(
  event: E,
  params: AnalyticsEvents[E],
): boolean {
  const fn = gtag();
  if (!activeMeasurementId || !fn) return false;
  const pageLocation =
    lastPageLocation ??
    sanitizePageLocation(window.location.href, { keepCampaign: false });
  fn("event", event, {
    ...sanitizeEventParams(event, params as Record<string, unknown>),
    ...(pageLocation ? { page_location: pageLocation } : {}),
  });
  return true;
}

/**
 * The `document.cookie` assignments that delete GA's first-party cookies
 * (`_ga`, `_ga_<id>`, and the legacy `_gid` / `_gat*`) found in
 * `cookieHeader`, and nothing else. gtag.js writes them on the highest domain
 * it can (`cookie_domain: 'auto'`: `.recopyfa.st`), and a cookie is deleted
 * only by an assignment with its exact Domain, so each is deleted host-only
 * and on every parent of `hostname` that has a dot (a bare suffix such as
 * `st` cannot hold one; a public suffix such as `co.uk` is refused by the
 * browser, harmlessly).
 */
export function googleAnalyticsCookieDeletions(
  cookieHeader: string,
  hostname: string,
): string[] {
  const names = cookieHeader
    .split(";")
    .map((part) => part.split("=")[0]?.trim() ?? "")
    .filter((name) => /^(_ga|_ga_.+|_gid|_gat.*)$/.test(name));
  const labels = hostname.split(".");
  const domains = labels
    .map((_, index) => labels.slice(index).join("."))
    .filter((domain) => domain.includes("."));
  return names.flatMap((name) => [
    `${name}=; Max-Age=0; Path=/`,
    ...domains.map(
      (domain) => `${name}=; Max-Age=0; Path=/; Domain=.${domain}`,
    ),
  ]);
}

function deleteGoogleAnalyticsCookies(): void {
  for (const deletion of googleAnalyticsCookieDeletions(
    document.cookie,
    window.location.hostname,
  )) {
    document.cookie = deletion;
  }
}

/**
 * The visitor chose. The choice is stored first-party for six months and
 * applied at once: "granted" updates analytics consent (ads stay denied);
 * "denied" denies it, stops this document sending anything, and deletes the
 * cookies GA may already have set.
 */
export function applyConsentChoice(
  measurementId: string,
  choice: ConsentChoice,
): void {
  document.cookie = serializeConsentCookie(choice, {
    isSecure: window.location.protocol === "https:",
  });
  gtag()?.("consent", "update", { analytics_storage: choice });
  if (choice === "denied") {
    setAnalyticsActive(measurementId, false);
    deleteGoogleAnalyticsCookies();
  }
}

function ctaLocationFor(element: Element): string {
  const tagged = element
    .closest("[data-cta-location]")
    ?.getAttribute("data-cta-location");
  if (tagged) return tagged;
  if (element.closest("header")) return "header";
  if (element.closest("footer")) return "footer";
  const section = element.closest("section[id]");
  return section?.id || "page";
}

type ClickEvent =
  | { event: "generate_lead"; params: AnalyticsEvents["generate_lead"] }
  | { event: "begin_checkout"; params: AnalyticsEvents["begin_checkout"] };

/**
 * The event a click means, if any: a same-origin link to /signup is a lead,
 * one to /dashboard/billing (Pricing's "Buy" links) starts checkout. Every
 * such link is a native anchor (ADR 059), so the page unloads right after;
 * gtag.js sends with `sendBeacon`, which survives that.
 */
export function analyticsEventForClick(
  target: EventTarget | null,
  origin: string,
): ClickEvent | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;

  let url: URL;
  try {
    url = new URL(anchor.href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;

  const path = url.pathname.replace(/\/+$/, "") || "/";
  const params = { cta_location: ctaLocationFor(anchor) };
  if (path === "/signup") return { event: "generate_lead", params };
  if (path === "/dashboard/billing") return { event: "begin_checkout", params };
  return null;
}
