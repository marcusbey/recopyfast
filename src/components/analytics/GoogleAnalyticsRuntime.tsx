"use client";

import * as React from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import {
  readConsentChoice,
  type ConsentChoice,
} from "@/lib/analytics/google-analytics/consent";
import { OPEN_COOKIE_SETTINGS_EVENT } from "@/lib/analytics/google-analytics/cookie-settings";
import {
  analyticsEventForClick,
  applyConsentChoice,
  setAnalyticsActive,
  startGoogleAnalytics,
  track,
  trackPageView,
} from "@/lib/analytics/google-analytics/gtag";
import { getDocumentPathname } from "@/lib/analytics/google-analytics/document-path";
import { isAnalyticsPage } from "@/lib/analytics/google-analytics/routes";
import { ConsentBanner } from "./ConsentBanner";

/** What the init script leaves on `window` (see `init-script.ts`). */
interface ConsentHint {
  consentRequired: boolean;
}

function readConsentHint(): ConsentHint {
  const value = (window as unknown as { __rcfAnalytics?: unknown })
    .__rcfAnalytics;
  // Fail closed: anything but an explicit `false` means "ask first".
  const isNotRequired =
    typeof value === "object" &&
    value !== null &&
    (value as { consentRequired?: unknown }).consentRequired === false;
  return { consentRequired: !isNotRequired };
}

/**
 * The Google Analytics runtime (s107, ADR 063): loaded by the `GoogleAnalytics`
 * shell, as its own chunk after hydration, on allowlisted marketing pages only.
 *
 * Order, on an allowlisted page:
 * 1. after mount, the first-party `/analytics/gtag-init.js` (consent defaults
 *    and the country hint, no inline script — the static CSP, ADR 059);
 * 2. on its `onReady`: where the hint says no consent is needed, or the
 *    visitor already allowed, `config` is queued and gtag.js is requested.
 *    Where consent is needed and no choice is stored, the banner shows and
 *    NOTHING is requested from Google until "Allow analytics";
 * 3. one sanitised `page_view` per allowlisted pathname (query-only changes,
 *    like the s98 calculator's `router.replace`, are not page views).
 *
 * Leaving the allowlist by a client navigation unmounts it (the shell stops
 * rendering it) and raises Google's opt-out flag on the way out, so nothing
 * more is sent from that page. It still checks the route and the document's
 * route itself (`isAnalyticsPage`), as a second line.
 */
export function GoogleAnalyticsRuntime({
  measurementId,
}: {
  measurementId: string;
}) {
  const pathname = usePathname();
  const isAllowedRoute = isAnalyticsPage(pathname, getDocumentPathname());
  const [isMounted, setIsMounted] = React.useState(false);
  const [hint, setHint] = React.useState<ConsentHint | null>(null);
  const [choice, setChoice] = React.useState<ConsentChoice | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [hasRequestedGtag, setHasRequestedGtag] = React.useState(false);

  const isGranted =
    hint !== null &&
    (choice === "granted" || (choice === null && !hint.consentRequired));
  const isActive = isGranted && isAllowedRoute;

  // Non-urgent, like every update below that the visitor did not cause: in a
  // transition React renders in slices that yield to the browser, so loading
  // analytics never shows up as a long task (the s17 gate's TBT, PR #94).
  React.useEffect(() => {
    const choiceInCookie = readConsentChoice(document.cookie);
    React.startTransition(() => {
      setChoice(choiceInCookie);
      setIsMounted(true);
    });
  }, []);

  React.useEffect(() => {
    const open = () => setIsSettingsOpen(true);
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, open);
  }, []);

  // Declared before the two below on purpose: effects run in order, so the
  // config is queued before activation and activation before the page view.
  React.useEffect(() => {
    if (!isGranted) return;
    startGoogleAnalytics(measurementId, { choice });
    setHasRequestedGtag(true);
  }, [isGranted, choice, measurementId]);

  React.useEffect(() => {
    if (hint === null) return;
    setAnalyticsActive(measurementId, isActive);
  }, [hint, isActive, measurementId]);

  // Unmounted when a client navigation leaves the allowlist: stop sending.
  React.useEffect(
    () => () => setAnalyticsActive(measurementId, false),
    [measurementId],
  );

  React.useEffect(() => {
    if (isActive) trackPageView();
  }, [isActive, pathname]);

  React.useEffect(() => {
    if (!isActive) return;
    const onClick = (event: MouseEvent) => {
      const result = analyticsEventForClick(
        event.target,
        window.location.origin,
      );
      if (result) track(result.event, result.params);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [isActive]);

  const onInitReady = React.useCallback(() => {
    const consentHint = readConsentHint();
    React.startTransition(() => setHint(consentHint));
  }, []);

  const choose = (next: ConsentChoice) => {
    applyConsentChoice(measurementId, next);
    setChoice(next);
    setIsSettingsOpen(false);
  };

  if (!isAllowedRoute || !isMounted) {
    // Mounted-only: nothing is requested during prerender, so no preload of
    // the init script competes with the page's own critical requests.
    return null;
  }

  const needsChoice = hint?.consentRequired === true && choice === null;
  const isBannerVisible = isSettingsOpen || needsChoice;
  // The choice in effect, for the banner (independent review F4): where no
  // consent is needed and nothing is stored, analytics is on — say so, show
  // "Allow" pressed, and let a visitor who opened it from the footer close it.
  const choiceInEffect: ConsentChoice | null =
    choice ?? (hint?.consentRequired === false ? "granted" : null);

  return (
    <>
      <Script
        id="rcf-ga-init"
        src="/analytics/gtag-init.js"
        strategy="afterInteractive"
        onReady={onInitReady}
      />
      {hasRequestedGtag ? (
        <Script
          id="rcf-ga-gtag"
          src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
          strategy="afterInteractive"
        />
      ) : null}
      <div aria-live="polite">
        {isBannerVisible ? (
          <ConsentBanner
            currentChoice={choiceInEffect}
            shouldTakeFocus={isSettingsOpen}
            onChoose={choose}
            onDismiss={() => setIsSettingsOpen(false)}
          />
        ) : null}
      </div>
    </>
  );
}
