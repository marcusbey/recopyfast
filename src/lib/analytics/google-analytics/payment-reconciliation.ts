import { createServiceRoleClient } from "@/lib/supabase/service";
import { createPaymentReads } from "./payment-reads";
import { normalizeBillingConversionSource } from "./payment-source";
import { summarizePaymentHistory } from "./payment-conversions";
import { classifyAccountPaymentHistory } from "./payment-history";

/** Two sources: one new and one retry slot, each with a 10-second read-admission
 * deadline and bounded in-flight requests. This cron never contacts Google and
 * cannot reclaim a Google send. */
export async function reconcilePaymentAnalytics() {
  const counts = {
    disabled: false,
    claimed: 0,
    complete: 0,
    pending: 0,
    unknown: 0,
    suppressed: 0,
    history_incomplete: 0,
    finalize_failed: 0,
  };
  if (
    process.env.ANALYTICS_PAYMENT_NORMALIZATION_ENABLED !== "1" ||
    process.env.VERCEL_ENV !== "production"
  )
    return { ...counts, disabled: true };
  const db = createServiceRoleClient();
  const { data, error } = await db
    .rpc("claim_analytics_payment_sources", { p_limit: 2 })
    .abortSignal(AbortSignal.timeout(1500));
  if (error || !Array.isArray(data))
    throw new Error("payment source claim unavailable");
  for (const source of data) {
    counts.claimed++;
    const reads = createPaymentReads();
    const normalized = await normalizeBillingConversionSource(source, reads);
    const candidates: Record<string, unknown>[] = [];
    const historyCache = new Map<
      string,
      ReturnType<typeof classifyAccountPaymentHistory>
    >();
    for (const purchase of normalized.purchases) {
      if (purchase.mode !== "live") continue;
      let history: {
        complete: boolean;
        transactions: typeof normalized.purchases;
      } = { complete: false, transactions: [] };
      try {
        let cached = historyCache.get(purchase.accountId);
        if (!cached) {
          cached = classifyAccountPaymentHistory(purchase.accountId, reads);
          historyCache.set(purchase.accountId, cached);
        }
        history = await cached;
      } catch {
        /* Missing history never guesses new. */
      }
      const customerType = summarizePaymentHistory(
        purchase.sourceKey,
        purchase.occurredAt,
        history.transactions.filter((p) => p.acquisitionEligible !== false),
        history.complete,
      );
      if (!history.complete) counts.history_incomplete++;
      candidates.push({
        kind:
          purchase.acquisitionEligible === false
            ? "exclude_purchase"
            : "purchase",
        source_key: `purchase:${purchase.sourceKey}`,
        user_id: purchase.accountId,
        occurred_at: new Date(purchase.occurredAt * 1000).toISOString(),
        payload: {
          mode: "live",
          value_minor: Math.round(purchase.value * 100),
          tax_minor: purchase.taxMinor,
          item_id: purchase.itemId,
          quantity: purchase.quantity,
          ...(customerType ? { customer_type: customerType } : {}),
        },
      });
    }
    for (const refund of normalized.refunds) {
      if (refund.mode !== "live") continue;
      candidates.push({
        kind: "refund",
        only_existing_parent: refund.onlyExistingParent === true,
        source_key: `refund:${refund.sourceKey}`,
        parent_source_key: `purchase:${refund.parentSourceKey}`,
        user_id: refund.accountId,
        occurred_at: new Date(refund.occurredAt * 1000).toISOString(),
        payload: {
          mode: "live",
          value_minor: refund.amountMinor - (refund.taxMinor ?? 0),
          tax_minor: refund.taxMinor ?? 0,
          item_id: refund.itemId,
          quantity: refund.quantity,
        },
      });
    }
    const state =
      normalized.state === "normalized" ? "complete" : normalized.state;
    counts[state]++;
    try {
      const result = await db
        .rpc("finish_analytics_payment_source", {
          p_event_id: source.stripe_event_id,
          p_token: source.claim_token,
          p_state: state,
          p_reason:
            normalized.reason ??
            (normalized.purchases.some((p) => p.mode === "test")
              ? "test_mode"
              : "normalized"),
          p_candidates: candidates,
        })
        .abortSignal(AbortSignal.timeout(1500));
      if (result.error || result.data !== true) throw new Error("finish");
    } catch {
      counts.finalize_failed++;
      console.warn("[analytics/payment] normalization result unavailable");
    }
  }
  return counts;
}
