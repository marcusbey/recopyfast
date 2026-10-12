/** First-party lifecycle controls only: no gtag, geography catalog or page-location dependency. */
import {
  readConsentChoice,
  serializeConsentCookie,
  CONSENT_COOKIE_MAX_AGE_SECONDS,
} from "./consent-choice";

async function requestContext(body: object): Promise<Response | null> {
  try {
    const response = await fetch("/api/analytics/context", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1500),
    });
    return response;
  } catch {
    // No identifiers or network exception text: analytics cannot break auth/navigation.
    console.warn("[analytics/context] request unavailable");
    return null;
  }
}

let captureGeneration = 0;
/** Synchronous: safe inside Supabase's cross-tab auth notification lock. */
export function invalidateAnalyticsCapture(): void {
  captureGeneration += 1;
}
type PendingAction = "revoke" | "signout";
type PendingIntents = Partial<Record<PendingAction, string>>;
function readPending(): PendingIntents {
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("rcf_analytics_pending="))
    ?.slice("rcf_analytics_pending=".length);
  if (!value) return {};
  if (value === "revoke" || value === "signout") return { [value]: "legacy" };
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).every((key) => ["revoke", "signout"].includes(key)) &&
      Object.values(parsed).every(
        (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(id),
      )
    )
      return parsed;
  } catch {
    /* Unknown pending state fails closed to one withdrawal attempt. */
  }
  return { revoke: "invalid" };
}
function writePending(pending: PendingIntents): void {
  const value = Object.keys(pending).length
    ? encodeURIComponent(JSON.stringify(pending))
    : "";
  document.cookie = `rcf_analytics_pending=${value}; Max-Age=${value ? 2592000 : 0}; Path=/; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
}
function enqueueIntent(action: PendingAction): void {
  invalidateAnalyticsCapture();
  const pending = readPending();
  // At most two bounded action slots. A new generation of the same action
  // cannot be acknowledged by a response to an older request (Devin review).
  pending[action] = Array.from(
    crypto.getRandomValues(new Uint32Array(4)),
    (value) => value.toString(16).padStart(8, "0"),
  ).join("");
  writePending(pending);
}
export async function revokeAnalyticsContext(): Promise<void> {
  enqueueIntent("revoke");
  await retryAnalyticsRevocation();
}
export async function signOutAnalyticsContext(): Promise<void> {
  enqueueIntent("signout");
  await retryAnalyticsRevocation();
}
let revocationInFlight: Promise<void> | null = null;
let captureRequest: Promise<Response | null> | null = null;
let grantRequest: Promise<Response | null> | null = null;
let grantTask: Promise<void> | null = null;
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
  // Finish responses that can install HttpOnly material before clearing it.
  // Never synthesize work from a settled denied choice: that exhausted the
  // shared IP allowance on every ordinary click in the original PR review.
  if (grantRequest) await grantRequest;
  if (captureRequest) await captureRequest;
  while (true) {
    const pending = readPending();
    const action: PendingAction | null = pending.revoke
      ? "revoke"
      : pending.signout
        ? "signout"
        : null;
    if (!action) return;
    const generation = pending[action];
    const response = await requestContext({ action });
    if (!response?.ok) return;
    const latest = readPending();
    if (latest[action] === generation) delete latest[action];
    writePending(latest);
  }
}

/** Only the explicit Allow handler calls this; page loads never mint proof. */
export async function grantAnalyticsConsent(): Promise<void> {
  invalidateAnalyticsCapture();
  const generation = captureGeneration;
  const previous = grantTask;
  const task = (async () => {
    if (previous) await previous;
    await retryAnalyticsRevocation();
    if (
      generation !== captureGeneration ||
      readConsentChoice(document.cookie) !== "granted" ||
      Object.keys(readPending()).length
    )
      return;
    grantRequest = requestContext({ action: "grant" });
    let response: Response | null;
    try {
      response = await grantRequest;
    } finally {
      grantRequest = null;
    }
    if (
      !response?.ok ||
      generation !== captureGeneration ||
      readConsentChoice(document.cookie) !== "granted" ||
      Object.keys(readPending()).length
    )
      return;
    try {
      const body = (await response.json()) as { expiresAt?: unknown };
      if (
        generation !== captureGeneration ||
        readConsentChoice(document.cookie) !== "granted" ||
        Object.keys(readPending()).length
      )
        return;
      if (
        typeof body.expiresAt !== "number" ||
        !Number.isSafeInteger(body.expiresAt)
      )
        return;
      const maxAgeSeconds = Math.floor((body.expiresAt - Date.now()) / 1000);
      if (maxAgeSeconds <= 0 || maxAgeSeconds > CONSENT_COOKIE_MAX_AGE_SECONDS)
        return;
      document.cookie = serializeConsentCookie("granted", {
        isSecure: window.location.protocol === "https:",
        maxAgeSeconds,
      });
    } catch {
      console.warn("[analytics/context] consent receipt unavailable");
    }
  })();
  grantTask = task;
  try {
    await task;
  } finally {
    if (grantTask === task) grantTask = null;
  }
}

export function analyticsCaptureGeneration(): number {
  return captureGeneration;
}
export function pendingAnalyticsGrant(): Promise<void> | null {
  return grantTask;
}
export async function postAnalyticsCapture(clientId: string): Promise<void> {
  captureRequest = requestContext({ action: "capture", clientId });
  try {
    await captureRequest;
  } finally {
    captureRequest = null;
  }
}
