import { createServiceRoleClient } from "@/lib/supabase/service";
import { createPaymentReads } from "./payment-reads";
import { classifyAccountPaymentHistory } from "./payment-history";
import { aggregatePaymentEvidence } from "./payment-metrics";

/** Operator-only bounded readout. Reads existing billing evidence and provider
 * objects; it never claims sources, enqueues GA or changes subscriptions. */
export async function readPaymentEvidenceAudit(limit = 10) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid account bound");
  const db = createServiceRoleClient();
  const customers = await db
    .from("billing_customers")
    .select("user_id")
    .order("user_id")
    .limit(limit + 1)
    .abortSignal(AbortSignal.timeout(1500));
  if (customers.error || !customers.data)
    throw new Error("Billing evidence unavailable");
  const histories = [];
  for (const customer of customers.data.slice(0, limit))
    histories.push(
      await classifyAccountPaymentHistory(
        customer.user_id,
        createPaymentReads(),
      ),
    );
  const diagnostics = await db
    .rpc("analytics_payment_diagnostics")
    .abortSignal(AbortSignal.timeout(1500));
  if (diagnostics.error) throw new Error("Payment completeness unavailable");
  return {
    scope: "stored_billing_accounts" as const,
    ...aggregatePaymentEvidence(histories, {
      accountScanComplete: customers.data.length <= limit,
    }),
    scanned_accounts: histories.length,
    account_scan_complete: customers.data.length <= limit,
    payer_count_is_lower_bound:
      customers.data.length > limit || histories.some((h) => !h.complete),
    diagnostics: diagnostics.data,
  };
}
