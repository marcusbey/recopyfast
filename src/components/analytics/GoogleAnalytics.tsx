"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { getMeasurementId } from "@/lib/analytics/google-analytics/measurement-id";
import { isAnalyticsRoute } from "@/lib/analytics/google-analytics/routes";

/**
 * Its own chunk, fetched after hydration: the banner, the consent logic and
 * the gtag runtime stay out of the critical bundle every page hydrates with.
 * s17's comparison gate (ADR 061) measured TBT at 172–185 ms against a 200 ms
 * limit before this story; this keeps that headroom for the pages themselves.
 */
const GoogleAnalyticsRuntime = dynamic(
  () =>
    import("./GoogleAnalyticsRuntime").then(
      (module) => module.GoogleAnalyticsRuntime,
    ),
  { ssr: false },
);

/**
 * Google Analytics 4 on the public marketing pages (s107, ADR 063).
 *
 * Mounted once, in the root layout, so it follows client navigations. Renders
 * nothing — and loads nothing — unless a measurement id is configured
 * (Production only) AND the current path is on the allowlist
 * (`isAnalyticsRoute`): the dashboard, auth and account pages, the API and the
 * widget never get the runtime, let alone gtag.js.
 */
export function GoogleAnalytics() {
  const measurementId = getMeasurementId();
  const pathname = usePathname();
  if (!measurementId || !isAnalyticsRoute(pathname)) return null;
  return <GoogleAnalyticsRuntime measurementId={measurementId} />;
}
