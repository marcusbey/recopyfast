/**
 * DataFast's first-party cookies, read server-side (ADR 074).
 *
 * DataFast's script sets `datafast_visitor_id` (a UUID) and
 * `datafast_session_id` on our own domain, so every request from the browser
 * carries them. They are the only link between a checkout or a server goal
 * and the visit that produced it.
 *
 * They are also attacker-controlled request input. A value is accepted only if
 * it is a short `[A-Za-z0-9_-]` token: that keeps it far inside Stripe's
 * 500-character metadata limit and DataFast's 255, and means nothing a caller
 * forges can carry markup, a separator or a second key. Anything else is
 * dropped — attribution is lost, nothing else is.
 */

export const DATAFAST_VISITOR_COOKIE = "datafast_visitor_id";
export const DATAFAST_SESSION_COOKIE = "datafast_session_id";

const DATAFAST_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isDataFastId(value: unknown): value is string {
  return typeof value === "string" && DATAFAST_ID.test(value);
}

/** What both `req.cookies` and `await cookies()` expose. */
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

export interface DataFastAttribution {
  datafast_visitor_id?: string;
  datafast_session_id?: string;
}

function validCookie(cookies: CookieReader, name: string): string | undefined {
  try {
    const value = cookies.get(name)?.value;
    return isDataFastId(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The Stripe Checkout metadata DataFast's Stripe connection reads to attribute
 * revenue (docs: /docs/stripe-checkout-api). Empty when neither cookie is a
 * valid id, so a caller can spread it unconditionally.
 */
export function readDataFastAttribution(
  cookies: CookieReader,
): DataFastAttribution {
  const visitorId = validCookie(cookies, DATAFAST_VISITOR_COOKIE);
  const sessionId = validCookie(cookies, DATAFAST_SESSION_COOKIE);
  return {
    ...(visitorId ? { datafast_visitor_id: visitorId } : {}),
    ...(sessionId ? { datafast_session_id: sessionId } : {}),
  };
}

/** The visitor id from a raw `Cookie` header (route handlers given a `Request`). */
export function readDataFastVisitorId(
  cookieHeader: string | null,
): string | null {
  for (const item of (cookieHeader ?? "").split(";")) {
    const at = item.indexOf("=");
    if (at < 0 || item.slice(0, at).trim() !== DATAFAST_VISITOR_COOKIE)
      continue;
    const value = item.slice(at + 1).trim();
    return isDataFastId(value) ? value : null;
  }
  return null;
}
