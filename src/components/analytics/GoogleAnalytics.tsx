"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { getMeasurementId } from "@/lib/analytics/google-analytics/measurement-id";
import { getDocumentPathname } from "@/lib/analytics/google-analytics/document-path";
import { isAnalyticsPage } from "@/lib/analytics/google-analytics/routes";
import { loadGoogleAnalyticsRuntime } from "./load-runtime";
import type { GoogleAnalyticsRuntime } from "./GoogleAnalyticsRuntime";

type Runtime = typeof GoogleAnalyticsRuntime;

/**
 * Google Analytics 4 on the public marketing pages (s107, ADR 063).
 *
 * Mounted once, in the root layout, so it follows client navigations. Renders
 * nothing — and fetches nothing — unless a measurement id is configured
 * (Production only) AND both the current path and the path the document was
 * loaded on are on the allowlist (`isAnalyticsPage`): the dashboard, auth and
 * account pages, the API and the widget never get the runtime, let alone
 * gtag.js — nor does a marketing page reached from one of them by a client
 * navigation, which keeps that page's document and its CSP (independent
 * review F1). Leaving the allowlist by a client navigation unmounts the
 * runtime, which switches GA off on the way out.
 *
 * TBT, measured (PR #94, Comparison Lighthouse run 38217319595): the gate's
 * median TBT went from 172–185 ms on `main` to 187–210 ms, over its 200 ms
 * limit. Two causes in the traces: the gtag runtime copied into every page
 * chunk through the footer (now `cookie-settings.ts`, import-free), and the
 * runtime's first render as one 63 ms task once its chunk arrived. The loader
 * is a plain `import()` after hydration, and the runtime is mounted inside
 * `startTransition`, so React renders it in slices that yield to the browser.
 */
export function GoogleAnalytics() {
  const measurementId = getMeasurementId();
  const pathname = usePathname();
  const isEnabled =
    measurementId !== null && isAnalyticsPage(pathname, getDocumentPathname());
  const [Runtime, setRuntime] = React.useState<Runtime | null>(null);

  React.useEffect(() => {
    if (!isEnabled || Runtime) return;
    let isCancelled = false;
    loadGoogleAnalyticsRuntime().then(
      (loaded) => {
        if (isCancelled) return;
        React.startTransition(() => setRuntime(() => loaded));
      },
      (error: unknown) => {
        // A failed chunk (a deploy that replaced it mid-visit) means no
        // analytics on this page view, never a broken page. Nothing to retry.
        console.warn("[analytics] runtime chunk failed to load", error);
      },
    );
    return () => {
      isCancelled = true;
    };
  }, [isEnabled, Runtime]);

  if (!isEnabled || !measurementId || !Runtime) return null;
  return <Runtime measurementId={measurementId} />;
}
