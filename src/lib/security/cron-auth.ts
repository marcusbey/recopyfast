/**
 * The one gate for Vercel cron and server-to-server calls:
 * `Authorization: Bearer <CRON_SECRET>`.
 *
 * s77 (s69 L4). Every route that took this header compared it with `!==` or
 * `===` — `cron/ab-test-lifecycle`, `cron/generate-blog-post`,
 * `cron/webhook-dispatch` and `blog/generate`. A string comparison returns at
 * the first differing byte, so how long a refusal takes says how much of the
 * guess was right. Every other secret here goes through `timingSafeEqual`; this
 * was the one that did not, copied route to route. One helper now, so the next
 * cron route cannot copy the old line.
 *
 * `timingSafeEqualString` digests both sides to 32 bytes first:
 * `crypto.timingSafeEqual` THROWS on unequal lengths, and a throw on a short
 * guess would leak the length through the exception path instead.
 *
 * FAILS CLOSED when `CRON_SECRET` is unset or empty. An empty secret would
 * otherwise make `Bearer ` (with nothing after it) a valid credential for
 * endpoints that make our infrastructure call customer URLs and spend OpenAI.
 */

import { timingSafeEqualString } from "@/lib/auth/editor-crypto";

export function isAuthorizedCronRequest(
  request: Pick<Request, "headers">,
): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const presented = request.headers.get("authorization") ?? "";
  return timingSafeEqualString(presented, `Bearer ${secret}`);
}
