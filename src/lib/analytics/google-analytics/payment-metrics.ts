import {
  summarizePaymentHistory,
  type NormalizedPurchase,
} from "./payment-conversions";
/** Existing verified billing evidence, never GA delivery rows. Observed subset
 * amounts are explicitly named; unresolved history is not an exact total. */
export function aggregatePaymentEvidence(
  histories: readonly {
    complete: boolean;
    transactions: NormalizedPurchase[];
    currentPaidEntitlement?: boolean | null;
  }[],
  options: { accountScanComplete?: boolean } = {},
) {
  const transactions = new Map<string, NormalizedPurchase>();
  const completeness = new Map<string, boolean>();
  for (const history of histories)
    for (const payment of history.transactions) {
      if (payment.mode !== "live") continue;
      transactions.set(payment.sourceKey, payment);
      completeness.set(
        payment.accountId,
        (completeness.get(payment.accountId) ?? true) && history.complete,
      );
    }
  const cashRows = [...transactions.values()];
  const rows = cashRows.filter((p) => p.acquisitionEligible !== false),
    accounts = new Set(rows.map((p) => p.accountId));
  let first = 0,
    returning = 0;
  for (const payment of rows) {
    const type = summarizePaymentHistory(
      payment.sourceKey,
      payment.occurredAt,
      rows.filter((p) => p.accountId === payment.accountId),
      completeness.get(payment.accountId) === true,
    );
    if (type === "new") first++;
    if (type === "returning") returning++;
  }
  const unknown = cashRows.filter((p) => p.netRetainedMinor == null).length;
  const refundUnknown = cashRows.filter(
    (p) => p.successfulRefundMinor == null,
  ).length;
  const complete =
    options.accountScanComplete !== false && histories.every((h) => h.complete);
  const observedGross = cashRows.reduce((sum, p) => sum + p.cashMinor, 0);
  const observedNet = unknown
    ? null
    : cashRows.reduce((sum, p) => sum + (p.netRetainedMinor ?? 0), 0);
  const observedRefund = cashRows.reduce(
    (sum, p) => sum + (p.successfulRefundMinor ?? 0),
    0,
  );
  const entitlementUnknown = histories.filter(
    (h) => typeof h.currentPaidEntitlement !== "boolean",
  ).length;
  const verifiedEntitlement = histories.filter(
    (h) => h.currentPaidEntitlement === true,
  ).length;
  return {
    verified_live_paying_accounts: accounts.size,
    verified_live_transactions: rows.length,
    verified_live_cash_transactions: cashRows.length,
    automatic_return_transactions: cashRows.length - rows.length,
    proven_first_payments: first,
    returning_payments: returning,
    verified_subscription_renewals: rows.filter((p) => p.isRenewal === true)
      .length,
    renewal_classification_unknown_transactions: rows.filter(
      (p) => p.isRenewal === undefined,
    ).length,
    gross_collected_minor: complete ? observedGross : null,
    observed_gross_collected_minor: observedGross,
    net_retained_minor: complete ? observedNet : null,
    observed_net_retained_minor: observedNet,
    net_unknown_transactions: unknown,
    successful_refund_minor:
      complete && refundUnknown === 0 ? observedRefund : null,
    observed_successful_refund_minor: observedRefund,
    refund_allocation_unknown_transactions: refundUnknown,
    current_paid_entitlement_accounts:
      options.accountScanComplete !== false && entitlementUnknown === 0
        ? verifiedEntitlement
        : null,
    verified_current_paid_entitlement_accounts: verifiedEntitlement,
    current_paid_entitlement_unknown_accounts: entitlementUnknown,
    history_incomplete_accounts: histories.filter((h) => !h.complete).length,
    currency: "USD",
    payer_count_is_lower_bound: !complete,
  };
}
