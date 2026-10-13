/** @jest-environment node */
import { aggregatePaymentEvidence } from "../payment-metrics";
const payment = {
  sourceKey: "live:invoice:in_1",
  accountId: "u",
  mode: "live" as const,
  occurredAt: 100,
  currency: "USD" as const,
  cashMinor: 1900,
  value: 19,
  taxMinor: 0,
  discountMinor: 0,
  itemId: "pro",
  quantity: 1,
  paymentIntentIds: ["pi_1"],
  netRetainedMinor: 0,
  financialState: "resolved" as const,
};
test("unique historical paying accounts survive refunds; renewals are transactions, not new accounts", () => {
  expect(
    aggregatePaymentEvidence([
      {
        complete: true,
        transactions: [
          payment,
          {
            ...payment,
            sourceKey: "live:invoice:in_2",
            occurredAt: 200,
            netRetainedMinor: 1900,
          },
          payment,
        ],
      },
    ]),
  ).toMatchObject({
    verified_live_paying_accounts: 1,
    verified_live_transactions: 2,
    proven_first_payments: 1,
    returning_payments: 1,
    gross_collected_minor: 3800,
    net_retained_minor: 1900,
    history_incomplete_accounts: 0,
  });
});
test("TEST and unknown history never become live/new or exact net revenue", () => {
  expect(
    aggregatePaymentEvidence([
      {
        complete: false,
        transactions: [
          { ...payment, netRetainedMinor: null, financialState: "unknown" },
          {
            ...payment,
            accountId: "test",
            sourceKey: "test:invoice:in_test",
            mode: "test",
          },
        ],
      },
    ]),
  ).toMatchObject({
    verified_live_paying_accounts: 1,
    verified_live_transactions: 1,
    proven_first_payments: 0,
    history_incomplete_accounts: 1,
    net_retained_minor: null,
    net_unknown_transactions: 1,
  });
});

test("incomplete history never reports exact total net, including an empty observed subset", () => {
  expect(
    aggregatePaymentEvidence([{ complete: false, transactions: [] }])
      .net_retained_minor,
  ).toBeNull();
  expect(
    aggregatePaymentEvidence([{ complete: false, transactions: [payment] }])
      .net_retained_minor,
  ).toBeNull();
  expect(
    aggregatePaymentEvidence([{ complete: true, transactions: [payment] }], {
      accountScanComplete: false,
    }).net_retained_minor,
  ).toBeNull();
});
test("subscription renewals, successful refunds and paid access have distinct readouts", () => {
  expect(
    aggregatePaymentEvidence([
      {
        complete: true,
        currentPaidEntitlement: true,
        transactions: [
          { ...payment, isRenewal: false, successfulRefundMinor: 1900 },
          {
            ...payment,
            sourceKey: "live:invoice:in_2",
            isRenewal: true,
            netRetainedMinor: 1900,
            successfulRefundMinor: 0,
          },
        ],
      },
    ]),
  ).toMatchObject({
    verified_subscription_renewals: 1,
    successful_refund_minor: 1900,
    current_paid_entitlement_accounts: 1,
  });
});

test("automatic returns remain visible in cash/refund totals without becoming payers", () => {
  expect(
    aggregatePaymentEvidence([
      {
        complete: true,
        currentPaidEntitlement: false,
        transactions: [
          {
            ...payment,
            acquisitionEligible: false,
            successfulRefundMinor: 1900,
            netRetainedMinor: 0,
          },
        ],
      },
    ]),
  ).toMatchObject({
    verified_live_paying_accounts: 0,
    verified_live_transactions: 0,
    verified_live_cash_transactions: 1,
    automatic_return_transactions: 1,
    gross_collected_minor: 1900,
    successful_refund_minor: 1900,
    net_retained_minor: 0,
  });
});
