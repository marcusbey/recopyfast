import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  normalizePaymentSource,
  type BillingSource,
  type NormalizedPurchase,
  type PaymentReads,
} from "./payment-conversions";

/** Complete means every retained account billing reference and bounded relevant
 * source was proved. The earliest event we happened to fetch is not first payer
 * evidence. No GA outbox row participates in this accounting classification. */
export async function classifyAccountPaymentHistory(
  accountId: string,
  reads: PaymentReads,
): Promise<{
  complete: boolean;
  transactions: NormalizedPurchase[];
  currentPaidEntitlement?: boolean | null;
}> {
  const signal = reads.historyBudget?.() ?? AbortSignal.timeout(1500);
  const { data, error } = await createServiceRoleClient()
    .rpc("analytics_payment_history", { p_user_id: accountId, p_limit: 25 })
    .abortSignal(signal);
  if (
    error ||
    !data ||
    !Array.isArray(data.sources) ||
    !Array.isArray(data.expected_keys)
  )
    return { complete: false, transactions: [] };
  let complete = data.complete === true;
  const provedReferences = new Set<string>();
  const transactions = new Map<string, NormalizedPurchase>();
  for (const source of data.sources as BillingSource[]) {
    const result = await normalizePaymentSource(source, reads, {
      includeAutomaticReturns: true,
    });
    if (
      result.state !== "normalized" &&
      !(
        result.state === "suppressed" &&
        [
          "no_positive_collection",
          "automatically_returned",
          "unpaid_or_setup",
        ].includes(result.reason ?? "")
      )
    )
      complete = false;
    if (
      result.state === "suppressed" &&
      result.reason === "automatically_returned" &&
      source.data &&
      typeof source.data === "object" &&
      "object" in source.data
    ) {
      const object = source.data.object;
      if (
        object &&
        typeof object === "object" &&
        "id" in object &&
        typeof object.id === "string"
      ) {
        if (source.event_type === "invoice.payment_succeeded")
          provedReferences.add(`invoice:${object.id}`);
        if (source.event_type === "payment_intent.succeeded")
          provedReferences.add(`payment_intent:${object.id}`);
      }
    }
    for (const purchase of result.purchases)
      if (purchase.accountId === accountId)
        transactions.set(purchase.sourceKey, purchase);
  }
  for (const key of data.expected_keys)
    if (
      typeof key !== "string" ||
      (!provedReferences.has(key) &&
        ![...transactions.values()].some(
          (t) => t.sourceKey === `live:${key}` || t.sourceKey === `test:${key}`,
        ))
    )
      complete = false;
  const current = data.current_paid_reference_keys;
  let currentPaidEntitlement: boolean | null = null;
  if (
    Array.isArray(current) &&
    data.current_paid_references_complete === true
  ) {
    const known = current.every(
      (key) =>
        typeof key === "string" &&
        (provedReferences.has(key) ||
          [...transactions.values()].some(
            (t) =>
              t.sourceKey === `live:${key}` || t.sourceKey === `test:${key}`,
          )),
    );
    if (known)
      currentPaidEntitlement = current.some((key) =>
        [...transactions.values()].some(
          (t) =>
            t.sourceKey === `live:${key}` && t.acquisitionEligible !== false,
        ),
      );
  }
  return {
    complete,
    transactions: [...transactions.values()],
    currentPaidEntitlement,
  };
}
