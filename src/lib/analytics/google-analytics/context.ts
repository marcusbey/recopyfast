import { readConsentChoice } from "./consent-choice";
import { isAnalyticsActive } from "./gtag";
import {
  analyticsCaptureGeneration,
  pendingAnalyticsGrant,
  postAnalyticsCapture,
  retryAnalyticsRevocation,
} from "./context-control";
export {
  invalidateAnalyticsCapture,
  revokeAnalyticsContext,
  signOutAnalyticsContext,
  retryAnalyticsRevocation,
  grantAnalyticsConsent,
} from "./context-control";

/** Only documented client IDs, never cookie-format parsing or fabricated IDs. */
export function isAnalyticsClientId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{1,32}\.[0-9]{1,32}$/.test(value);
}
let captureInFlight: Promise<void> | null = null;

export async function captureAnalyticsContext(
  measurementId: string,
): Promise<void> {
  if (captureInFlight) return captureInFlight;
  captureInFlight = performCapture(measurementId);
  try {
    await captureInFlight;
  } finally {
    captureInFlight = null;
  }
}
async function performCapture(measurementId: string): Promise<void> {
  // Snapshot before even a pending withdrawal wait: a new sign-out during
  // that wait must invalidate this interaction, not become its new baseline.
  const generation = analyticsCaptureGeneration();
  const grantTask = pendingAnalyticsGrant();
  if (grantTask) await grantTask;
  if (document.cookie.includes("rcf_analytics_pending=")) {
    await retryAnalyticsRevocation();
    if (document.cookie.includes("rcf_analytics_pending=")) return;
  }
  if (!isAnalyticsActive() || readConsentChoice(document.cookie) === "denied")
    return;
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void })
    .gtag;
  if (!gtag) return;
  // A successful revoke clears its pending cookie before auth sign-out can
  // finish. That must not make a Google callback started BEFORE withdrawal
  // eligible again. Keep an independent generation for outstanding callbacks.
  const clientId = await new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => resolve(null), 1000);
    try {
      gtag("get", measurementId, "client_id", (value: unknown) => {
        clearTimeout(timer);
        resolve(value);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
  if (
    !isAnalyticsClientId(clientId) ||
    generation !== analyticsCaptureGeneration() ||
    document.cookie.includes("rcf_analytics_pending=") ||
    !isAnalyticsActive() ||
    readConsentChoice(document.cookie) === "denied"
  )
    return;
  // get(session_id) does not prove the session's true end. Deliberately omit it
  // rather than attach a day-14 payment to a day-1 session (ADR070).
  await postAnalyticsCapture(clientId);
}
