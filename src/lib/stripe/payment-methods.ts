import { stripe } from "./config";
import type { PaymentMethod } from "@/types/billing";

/**
 * Payment-method reads/writes against Stripe.
 *
 * Stripe is the source of truth: cards are attached by Checkout (subscription
 * or setup mode) and the "default" flag lives on the Stripe customer's
 * `invoice_settings.default_payment_method`, which is what actually gets
 * charged at renewal.
 */

/**
 * List the customer's saved cards, newest first, with the Stripe default
 * flagged.
 *
 * `customerId` is our `billing_customers.id`, carried through only so the
 * result satisfies the `PaymentMethod` shape the billing UI consumes.
 */
export async function listPaymentMethods(
  customerId: string,
  stripeCustomerId: string,
): Promise<PaymentMethod[]> {
  const [customer, paymentMethods] = await Promise.all([
    stripe.customers.retrieve(stripeCustomerId),
    stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card" }),
  ]);

  const defaultPaymentMethod = customer.deleted
    ? null
    : customer.invoice_settings?.default_payment_method;
  const defaultId =
    typeof defaultPaymentMethod === "string"
      ? defaultPaymentMethod
      : (defaultPaymentMethod?.id ?? null);

  // A lone card is charged at renewal whether or not it is flagged default,
  // so present it as such.
  const onlyCardId =
    paymentMethods.data.length === 1 ? paymentMethods.data[0].id : null;

  return paymentMethods.data.map((pm) => ({
    id: pm.id,
    customer_id: customerId,
    stripe_payment_method_id: pm.id,
    type: pm.type,
    brand: pm.card?.brand,
    last4: pm.card?.last4,
    exp_month: pm.card?.exp_month,
    exp_year: pm.card?.exp_year,
    is_default: pm.id === (defaultId ?? onlyCardId),
    created_at: new Date(pm.created * 1000).toISOString(),
    updated_at: new Date(pm.created * 1000).toISOString(),
  }));
}

/**
 * Make a card the default for future invoices, and for the customer's live
 * subscription if they have one. Without the second step an existing
 * subscription keeps charging the card it was created with.
 */
export async function setDefaultPaymentMethod(
  stripeCustomerId: string,
  paymentMethodId: string,
): Promise<void> {
  await stripe.customers.update(stripeCustomerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  const subscriptions = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: "all",
    limit: 10,
  });

  const liveSubscriptions = subscriptions.data.filter((subscription) =>
    ["active", "trialing", "past_due", "unpaid"].includes(subscription.status),
  );

  await Promise.all(
    liveSubscriptions.map((subscription) =>
      stripe.subscriptions.update(subscription.id, {
        default_payment_method: paymentMethodId,
      }),
    ),
  );
}
