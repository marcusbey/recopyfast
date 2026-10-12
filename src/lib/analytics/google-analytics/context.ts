import { readConsentChoice } from "./consent";
import { isAnalyticsActive } from "./gtag";

/** Only documented client IDs, never cookie-format parsing or fabricated IDs. */
export function isAnalyticsClientId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{1,32}\.[0-9]{1,32}$/.test(value);
}

async function postContext(body: object): Promise<boolean> {
  try {
    const response = await fetch("/api/analytics/context", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    // No identifiers or network exception text: analytics cannot break auth/navigation.
    console.warn("[analytics/context] request unavailable");
    return false;
  }
}

let captureGeneration = 0;
/** Synchronous: safe inside Supabase's cross-tab auth notification lock. */
export function invalidateAnalyticsCapture(): void {
  captureGeneration += 1;
}
export async function revokeAnalyticsContext(): Promise<void> {
  invalidateAnalyticsCapture();
  document.cookie =
    "rcf_analytics_pending=revoke; Max-Age=2592000; Path=/; SameSite=Lax";
  await retryAnalyticsRevocation();
}

export async function signOutAnalyticsContext(): Promise<void> {
  invalidateAnalyticsCapture();
  document.cookie =
    "rcf_analytics_pending=signout; Max-Age=2592000; Path=/; SameSite=Lax";
  await retryAnalyticsRevocation();
}

let revocationInFlight: Promise<void> | null = null;
let captureInFlight: Promise<void> | null = null;
let captureRequest: Promise<boolean> | null = null;
export async function retryAnalyticsRevocation(): Promise<void> {
  if (revocationInFlight) return revocationInFlight;
  revocationInFlight = performPendingRevocation();
  try {
    await revocationInFlight;
  } finally {
    revocationInFlight = null;
  }
}
async function performPendingRevocation(): Promise<void> {
  // A first capture returns the HttpOnly capability. Revoking before that
  // response arrives would erase nothing, then let its Set-Cookie resurrect
  // attribution on a shared-device sign-out. Finish the bounded request first.
  if (captureRequest) await captureRequest;
  const pending = document.cookie
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("rcf_analytics_pending="))
    ?.split("=")[1];
  const action =
    readConsentChoice(document.cookie) === "denied" ? "revoke" : pending;
  if (action !== "revoke" && action !== "signout") return;
  if (await postContext({ action }))
    document.cookie = "rcf_analytics_pending=; Max-Age=0; Path=/; SameSite=Lax";
}

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
  const generation = captureGeneration;
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
    generation !== captureGeneration ||
    document.cookie.includes("rcf_analytics_pending=") ||
    !isAnalyticsActive() ||
    readConsentChoice(document.cookie) === "denied"
  )
    return;
  // get(session_id) does not prove the session's true end. Deliberately omit it
  // rather than attach a day-14 payment to a day-1 session (ADR070).
  captureRequest = postContext({ action: "capture", clientId });
  try {
    await captureRequest;
  } finally {
    captureRequest = null;
  }
}
