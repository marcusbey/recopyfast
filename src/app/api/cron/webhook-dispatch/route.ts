/**
 * GET /api/cron/webhook-dispatch — phase 2 of ADR 010.
 *
 * Two independent sweeps share one tick:
 *   - sweepDueDispatches: coalescing windows that have elapsed (AC 4);
 *   - sweepDueRetries:    delivery attempts whose backoff has elapsed (AC 3).
 *
 * Nothing else fires them. `after()` on the publish path only writes a marker,
 * and a failed delivery only writes a `next_retry_at`; both are inert until
 * this route runs. The mechanism this replaces was
 * `setTimeout(() => retry(), delay)` inside the request that failed, with
 * delays up to five minutes — on Vercel that timer never fired, so in
 * production every retry was silently dropped.
 *
 * Registered in vercel.json. `CRON_SECRET`-gated exactly like
 * /api/cron/ab-test-lifecycle, and fail-closed when the secret is unset: this
 * endpoint makes our infrastructure send HTTP requests to customer-configured
 * URLs, so an unauthenticated caller could drive that at will.
 */

import { NextRequest, NextResponse } from "next/server";
import { webhookManager } from "@/lib/webhooks/manager";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Settled, not awaited in sequence with a shared failure path: the two sweeps
  // are unrelated, and one throwing must not strand the other. A stranded retry
  // sweep means every failed delivery stops retrying — the exact production
  // failure this story exists to fix.
  const [dispatchResult, retryResult] = await Promise.allSettled([
    webhookManager.sweepDueDispatches(),
    webhookManager.sweepDueRetries(),
  ]);

  const failures: string[] = [];

  if (dispatchResult.status === "rejected") {
    console.error(
      "Cron webhook-dispatch: sweep failed:",
      dispatchResult.reason,
    );
    failures.push("dispatch");
  }
  if (retryResult.status === "rejected") {
    console.error(
      "Cron webhook-dispatch: retry sweep failed:",
      retryResult.reason,
    );
    failures.push("retry");
  }

  const body = {
    dispatched:
      dispatchResult.status === "fulfilled"
        ? dispatchResult.value.dispatched
        : 0,
    retried: retryResult.status === "fulfilled" ? retryResult.value.retried : 0,
  };

  if (failures.length > 0) {
    return NextResponse.json(
      { ...body, error: `Sweep failed: ${failures.join(", ")}` },
      { status: 500 },
    );
  }

  return NextResponse.json(body);
}
