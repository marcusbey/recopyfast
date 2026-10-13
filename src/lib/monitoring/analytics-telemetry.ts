import type { Breadcrumb, Event } from "@sentry/nextjs";

/**
 * Google requires the MP API secret in its query string. s111's intercepted
 * Sentry envelope exposed that secret in an outgoing-fetch breadcrumb even
 * though trace header propagation was restricted. Exclude only these two
 * collector paths; unrelated Google and application requests remain monitored.
 */
export function isMeasurementProtocolRequest(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.origin === "https://www.google-analytics.com" &&
      (url.pathname === "/mp/collect" || url.pathname === "/debug/mp/collect")
    );
  } catch {
    return false;
  }
}

export function filterAnalyticsBreadcrumb(
  breadcrumb: Breadcrumb,
): Breadcrumb | null {
  return isMeasurementProtocolRequest(breadcrumb.data?.url) ? null : breadcrumb;
}

/** Defense for spans emitted by a second instrumentation layer, e.g. Next. */
export function filterAnalyticsTransaction<T extends Event>(event: T): T {
  if (event.spans) {
    event.spans = event.spans.filter(
      (span) =>
        !isMeasurementProtocolRequest(span.data?.["url.full"]) &&
        !isMeasurementProtocolRequest(span.data?.["http.url"]),
    );
  }
  return event;
}
