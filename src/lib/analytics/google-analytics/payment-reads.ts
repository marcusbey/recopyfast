import { stripe } from "@/lib/stripe/config";
import { getCreditPackConfig } from "@/lib/stripe/plans";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  PaymentEvidenceUnavailable,
  PaymentReadBudgetExceeded,
  readPaymentCatalogue,
  type PaymentReads,
} from "./payment-conversions";

/** Only call after the cron's fail-closed bearer check. All provider methods are
 * retrieve/list, use the pinned application client, and disable SDK retries so a
 * source attempt cannot silently exceed the separate normalization deadline. */
export function createPaymentReads(): PaymentReads {
  const db = createServiceRoleClient();
  const options = { timeout: 1500, maxNetworkRetries: 0 };
  const deadline = Date.now() + 10000;
  let reads = 0;
  const check = () => {
    if (++reads > 60 || Date.now() > deadline)
      throw new PaymentReadBudgetExceeded();
  };
  return {
    historyBudget: () => {
      check();
      return AbortSignal.timeout(
        Math.max(1, Math.min(1500, deadline - Date.now())),
      );
    },
    event: async (id) => {
      check();
      try {
        return await stripe.events.retrieve(id, {}, options);
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "type" in error &&
          error.type === "StripeInvalidRequestError" &&
          "code" in error &&
          error.code === "resource_missing"
        )
          throw new PaymentEvidenceUnavailable();
        throw error;
      }
    },
    intent: (id) => {
      check();
      return stripe.paymentIntents.retrieve(id, {}, options);
    },
    charge: (id) => {
      check();
      return stripe.charges.retrieve(id, {}, options);
    },
    invoice: (id) => {
      check();
      return stripe.invoices.retrieve(id, {}, options);
    },
    session: (id) => {
      check();
      return stripe.checkout.sessions.retrieve(id, {}, options);
    },
    allocations: (params) => {
      check();
      return stripe.invoicePayments.list(params, options);
    },
    refunds: (params) => {
      check();
      return stripe.refunds.list(params, options);
    },
    disputes: (params) => {
      check();
      return stripe.disputes.list(params, options);
    },
    async account(customerId) {
      check();
      const { data, error } = await db
        .from("billing_customers")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .abortSignal(AbortSignal.timeout(1500))
        .maybeSingle();
      if (error) throw new Error("billing account unavailable");
      return data?.user_id ?? null;
    },
    async reconciledInvoice(invoiceId, accountId) {
      check();
      const { data, error } = await db
        .from("billing_invoices")
        .select("id,billing_customers!inner(user_id)")
        .eq("stripe_invoice_id", invoiceId)
        .eq("billing_customers.user_id", accountId)
        .abortSignal(AbortSignal.timeout(1500))
        .maybeSingle();
      if (error) throw new Error("billing invoice unavailable");
      return !!data;
    },
    async reconciledOneOff(intentId, accountId) {
      check();
      const credit = await db
        .from("credit_purchases")
        .select("credits_purchased")
        .eq("stripe_payment_intent_id", intentId)
        .eq("user_id", accountId)
        .abortSignal(AbortSignal.timeout(1500))
        .maybeSingle();
      if (credit.error) throw new Error("credit evidence unavailable");
      if (credit.data) {
        check();
        const pack = await readPaymentCatalogue(getCreditPackConfig());
        const quantity = credit.data.credits_purchased / pack.creditsPerPack;
        return Number.isSafeInteger(quantity) && quantity > 0
          ? { productId: "credits", quantity }
          : null;
      }
      // Do not filter revoked_at, expires_at, remaining credits or current plan.
      // Those answer current entitlement, not whether the original sale occurred.
      check();
      const grant = await db
        .from("plan_entitlements")
        .select("plan_id,source")
        .eq("stripe_payment_intent_id", intentId)
        .eq("user_id", accountId)
        .abortSignal(AbortSignal.timeout(1500))
        .maybeSingle();
      if (grant.error) throw new Error("grant evidence unavailable");
      if (grant.data?.source !== "lifetime_purchase") return null;
      return grant.data.plan_id === "pro"
        ? { productId: "lifetime_pro", quantity: 1 }
        : grant.data.plan_id === "agency"
          ? { productId: "lifetime_agency", quantity: 1 }
          : null;
    },
    async successfulPaymentEvent(intentId) {
      check();
      const { data, error } = await db
        .from("billing_events")
        .select("stripe_event_id")
        .eq("processed", true)
        .eq("event_type", "payment_intent.succeeded")
        .eq("data->object->>id", intentId)
        .order("created_at", { ascending: true })
        .limit(1)
        .abortSignal(AbortSignal.timeout(1500))
        .maybeSingle();
      if (error) throw new Error("payment settlement unavailable");
      return data?.stripe_event_id ?? null;
    },
  };
}
