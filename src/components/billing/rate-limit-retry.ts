/**
 * When a rate-limited billing request may be tried again, in the words the
 * billing page uses for it.
 *
 * Split out of `useCheckout` (s82 review, finding 7) so the payment-methods
 * card tells a 429 the way checkout does — a sentence, then "Try again at
 * HH:MM." — instead of printing the limiter's machine `error` ("Rate limit
 * exceeded") and hiding the sentence written for the customer.
 */

/** "HH:MM" (24-hour) for an ISO instant, or null when it is not one. */
export function formatRetryTime(retryAt: unknown): string | null {
  if (typeof retryAt !== "string") {
    return null;
  }

  const retryDate = new Date(retryAt);
  if (Number.isNaN(retryDate.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(retryDate);
}

/**
 * When a 429's bucket reopens, from the headers `enforceRateLimit` sets
 * (`X-RateLimit-Reset`, else `Retry-After`), or null when neither says.
 */
export function rateLimitRetryAt(response: Response): string | null {
  const resetEpoch = Number(response.headers.get("X-RateLimit-Reset"));
  if (Number.isFinite(resetEpoch) && resetEpoch > 0) {
    return new Date(resetEpoch * 1000).toISOString();
  }

  const retryAfter = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return new Date(Date.now() + retryAfter * 1000).toISOString();
  }

  return null;
}

/** "Try again at HH:MM." for a 429, or null when the time is unknown. */
export function rateLimitRetrySentence(response: Response): string | null {
  const time = formatRetryTime(rateLimitRetryAt(response));
  return time ? `Try again at ${time}.` : null;
}
