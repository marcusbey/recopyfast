import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { readPurchasedCreditBalance, spendableFilter } from "./spendable";
import type { CreditTransaction, CreditWallet } from "@/types/billing";

/**
 * Credits — one currency, one store.
 *
 * There used to be two. Stripe purchases credited `tickets`, while every
 * balance check and every spend read `credit_purchases`/`credit_usage`, so a
 * customer could buy 1,000 credits and be told they had none. `credit_purchases`
 * is now the single store; see migration 20260802020000 for the collapse and
 * for why that side won.
 *
 * A balance has two parts:
 *   included  — granted by the plan each billing period, does not roll over
 *   purchased — bought as a credit pack, spent only once `included` is used up
 *
 * How many credits a plan includes is a plan limit, so it comes from the
 * `plans` table rather than a constant here.
 */

// Credit costs for different AI operations
export const CREDIT_COSTS = {
  AI_SUGGESTION: 1, // 1 credit per AI suggestion
  AI_TRANSLATION: 5, // 5 credits per translation (more expensive)
  BULK_AI_OPERATION: 10, // 10 credits for bulk operations
  AB_TEST_GENERATION: 3, // 3 credits per A/B test generation
} as const;

export interface CreditBalance {
  included: number; // Monthly included credits from the plan
  purchased: number; // Purchased credits, which do not expire
  total: number; // Total available credits
  usedThisMonth: number; // Credits used in the current billing period
}

/**
 * PostgREST resolves on failure rather than rejecting, so a `{ data }`-only
 * destructure turns a query error into "no rows" — which for a balance read
 * means silently reporting zero credits to a paying customer. That is exactly
 * how selecting a non-existent `plan_id` column went unnoticed. Every read in
 * this module goes through here.
 */
function assertRead<T>(
  result: { data: T; error: { message: string } | null },
  operation: string,
): T {
  if (result.error) {
    throw new Error(`${operation} failed: ${result.error.message}`);
  }
  return result.data;
}

/** PostgreSQL SQLSTATEs, referred to by name rather than by digits. */
const NOT_NULL_VIOLATION = "23502";
const UNIQUE_VIOLATION = "23505";

/**
 * Stand-in for "never expires" when the database still forbids NULL.
 *
 * Migration 20260802020000 drops `credit_purchases.expires_at`'s NOT NULL, but
 * code and schema deploy separately and the code can arrive first. Until the
 * migration lands, inserting NULL raises 23502; the webhook turns that into a
 * 500, Stripe retries forever, and the customer is charged for credits that
 * never appear — the same shape as the Starter defect.
 *
 * A date this distant is spendable under `spendableFilter()`'s
 * `expires_at.gt.<now>` arm, so a grant written before the migration behaves
 * exactly like one written after it. Credits are never lost, only labelled
 * differently.
 */
const NEVER_EXPIRES = "9999-12-31T23:59:59.999Z";

/**
 * Insert a grant that does not expire, under either schema.
 *
 * NULL is attempted first so that once the migration has run every row records
 * "never expires" the way the migration intends, and the fallback quietly stops
 * being used. Nothing is written by a failed insert, so the retry cannot
 * double-credit.
 */
async function insertNonExpiringGrant(
  supabase: ReturnType<typeof createServiceRoleClient>,
  row: Record<string, unknown>,
): Promise<{ error: { code?: string; message: string } | null }> {
  const attempt = await supabase
    .from("credit_purchases")
    .insert({ ...row, expires_at: null });

  if (attempt.error?.code !== NOT_NULL_VIOLATION) {
    return attempt;
  }

  console.warn(
    "credit_purchases.expires_at is still NOT NULL — migration 20260802020000 " +
      "has not been applied to this database. Granting with a far-future " +
      "expiry so the credits are not lost; run the migration to restore NULL.",
  );

  return supabase
    .from("credit_purchases")
    .insert({ ...row, expires_at: NEVER_EXPIRES });
}

/**
 * Get user's current credit balance
 */
export async function getUserCreditBalance(
  userId: string,
): Promise<CreditBalance> {
  const supabase = await createClient();

  // Resolved through the entitlement layer so a Lifetime Pro customer, who has
  // no billing_subscriptions row at all, still gets Pro's included credits.
  //
  // Only a plan includes credits. A credit-only holder has a wallet and no
  // allowance, which is the difference between the two kinds of entitlement.
  // This read is on the path the billing dashboard takes, so it must answer
  // rather than throw for someone who has not subscribed.
  const entitlement = await getEffectivePlan(userId);
  const includedCredits =
    entitlement.kind === "plan" ? entitlement.plan.limits.monthlyCredits : 0;

  // NOTE: `plan` is the column name on billing_subscriptions, not `plan_id`.
  // Only the period boundary is needed here; the plan itself came from above.
  const subscription = assertRead(
    await supabase
      .from("billing_subscriptions")
      .select("current_period_start")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle<{ current_period_start: string }>(),
    "billing_subscriptions read",
  );

  // Shared with entitlement resolution, which asks the same question to decide
  // whether a wallet alone entitles its holder. Two totals computed two ways
  // would eventually disagree about which rows still count.
  const purchasedCredits = await readPurchasedCreditBalance(supabase, userId);

  const startOfPeriod =
    subscription?.current_period_start || startOfCurrentMonth();

  const usage = assertRead(
    await supabase
      .from("credit_usage")
      .select("credits_used")
      .eq("user_id", userId)
      .gte("created_at", startOfPeriod),
    "credit_usage read",
  );

  const usedThisMonth = usage?.reduce((sum, u) => sum + u.credits_used, 0) || 0;

  return {
    included: includedCredits,
    purchased: purchasedCredits,
    total: Math.max(0, includedCredits - usedThisMonth) + purchasedCredits,
    usedThisMonth,
  };
}

/**
 * Without a subscription there is no billing period, so the included allowance
 * resets on the calendar month. Using "now" instead would count zero usage and
 * hand out the monthly allowance again on every call.
 */
function startOfCurrentMonth(): string {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/**
 * Check if user has enough credits for an operation
 */
export async function hasEnoughCredits(
  userId: string,
  creditsRequired: number,
): Promise<boolean> {
  const balance = await getUserCreditBalance(userId);
  return balance.total >= creditsRequired;
}

/**
 * Consume credits for an AI operation
 */
export async function consumeCredits(
  userId: string,
  credits: number,
  operation: string,
  metadata?: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; remainingCredits?: number }> {
  const supabase = await createClient();
  const balance = await getUserCreditBalance(userId);

  if (balance.total < credits) {
    return {
      success: false,
      error: `Insufficient credits. You need ${credits} credits but only have ${balance.total}.`,
    };
  }

  const { error: usageError } = await supabase.from("credit_usage").insert({
    user_id: userId,
    credits_used: credits,
    operation,
    metadata,
  });

  if (usageError) {
    console.error("Error recording credit usage:", usageError);
    return { success: false, error: "Failed to record credit usage" };
  }

  // Purchased credits are only touched once the included allowance is spent.
  const includedRemaining = Math.max(
    0,
    balance.included - balance.usedThisMonth,
  );
  const creditsToDeductFromPurchased = credits - includedRemaining;

  if (creditsToDeductFromPurchased > 0) {
    const { data: purchases, error: purchasesError } = await supabase
      .from("credit_purchases")
      .select("id, credits_remaining")
      .eq("user_id", userId)
      .gt("credits_remaining", 0)
      .or(spendableFilter())
      .order("created_at", { ascending: true });

    if (purchasesError) {
      // The usage row is already written, so the credits are spent either way.
      // Surfacing this stops a silent drift between usage and remaining.
      console.error("Error loading credit purchases:", purchasesError);
      return { success: false, error: "Failed to deduct purchased credits" };
    }

    let remainingToDeduct = creditsToDeductFromPurchased;

    for (const purchase of purchases || []) {
      if (remainingToDeduct <= 0) break;

      const toDeduct = Math.min(remainingToDeduct, purchase.credits_remaining);

      const { error: deductError } = await supabase
        .from("credit_purchases")
        .update({ credits_remaining: purchase.credits_remaining - toDeduct })
        .eq("id", purchase.id);

      if (deductError) {
        console.error("Error deducting purchased credits:", deductError);
        return { success: false, error: "Failed to deduct purchased credits" };
      }

      remainingToDeduct -= toDeduct;
    }
  }

  const newBalance = await getUserCreditBalance(userId);

  return { success: true, remainingCredits: newBalance.total };
}

/**
 * Credit a completed purchase.
 *
 * Called from the Stripe webhook, so it uses the service-role client: there is
 * no authenticated session, and `credit_purchases` has no INSERT policy for
 * `authenticated` precisely because a balance must never be self-granted.
 *
 * `stripe_payment_intent_id` is UNIQUE, so a redelivered webhook collides
 * instead of crediting twice. That collision is the idempotency guard working,
 * and is reported as `duplicate` rather than thrown.
 *
 * Purchased credits do not expire, which is what the pricing page promises.
 * That is recorded as a NULL `expires_at`, falling back to a far-future one on
 * a database that has not had migration 20260802020000 applied yet — see
 * `insertNonExpiringGrant`.
 */
export async function addPurchasedCredits(
  userId: string,
  credits: number,
  stripePaymentIntentId: string,
  priceCents?: number,
): Promise<{ success: boolean; duplicate: boolean; error?: string }> {
  if (!Number.isInteger(credits) || credits <= 0) {
    return {
      success: false,
      duplicate: false,
      error: `Refusing to credit a non-positive amount: ${credits}`,
    };
  }

  const supabase = createServiceRoleClient();

  const { error } = await insertNonExpiringGrant(supabase, {
    user_id: userId,
    credits_purchased: credits,
    credits_remaining: credits,
    price_cents: priceCents ?? null,
    stripe_payment_intent_id: stripePaymentIntentId,
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { success: false, duplicate: true };
    }
    // Thrown, not logged: the caller is the webhook, and a 500 there makes
    // Stripe retry. Returning success would lose credits the customer paid for.
    throw new Error(
      `Failed to credit ${credits} credits to ${userId}: ${error.message}`,
    );
  }

  return { success: true, duplicate: false };
}

/**
 * Refund credits from a failed operation.
 *
 * Adds a fresh non-expiring grant rather than trying to restore the exact rows
 * that were decremented: the monotonicity trigger on `credit_purchases`
 * deliberately forbids increasing `credits_remaining`, and reversing that for
 * refunds would reopen the hole it exists to close.
 */
export async function refundCredits(
  userId: string,
  credits: number,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  if (!Number.isInteger(credits) || credits <= 0) {
    return {
      success: false,
      error: "Refund amount must be a positive integer",
    };
  }

  const supabase = createServiceRoleClient();

  const { error } = await insertNonExpiringGrant(supabase, {
    user_id: userId,
    credits_purchased: credits,
    credits_remaining: credits,
    price_cents: 0,
    stripe_payment_intent_id: `refund_${reason}_${userId}_${Date.now()}`,
  });

  if (error) {
    console.error("Error refunding credits:", error);
    return { success: false, error: "Failed to refund credits" };
  }

  return { success: true };
}

/** The `credit_purchases` grant a single Stripe payment created. */
export interface PurchasedCreditGrant {
  id: string;
  user_id: string;
  credits_purchased: number;
  credits_remaining: number;
}

async function readGrantForPayment(
  supabase: ReturnType<typeof createServiceRoleClient>,
  stripePaymentIntentId: string,
): Promise<PurchasedCreditGrant | null> {
  const { data, error } = await supabase
    .from("credit_purchases")
    .select("id, user_id, credits_purchased, credits_remaining")
    .eq("stripe_payment_intent_id", stripePaymentIntentId)
    .maybeSingle<PurchasedCreditGrant>();

  if (error) {
    throw new Error(`Failed to look up credit purchase: ${error.message}`);
  }

  return data;
}

/**
 * The wallet a payment created, before anything is done to it.
 *
 * Exists because a clawback is not reversible from the row it leaves behind:
 * once `credits_remaining` is 0 the grant cannot say how much of it was revoked
 * rather than spent. The dispute path reads the balance through here and records
 * it *before* revoking — see `src/lib/billing/credit-revocations.ts`.
 */
export async function getPurchasedCreditGrant(
  stripePaymentIntentId: string,
): Promise<PurchasedCreditGrant | null> {
  return readGrantForPayment(createServiceRoleClient(), stripePaymentIntentId);
}

/**
 * Revoke outstanding purchased credits from a refunded or disputed payment.
 *
 * Only the credits still unspent are clawed back — a customer who already used
 * them is not driven negative, which would block them from ever spending again.
 */
export async function revokePurchasedCredits(
  stripePaymentIntentId: string,
): Promise<{ revoked: number }> {
  const supabase = createServiceRoleClient();
  const purchase = await readGrantForPayment(supabase, stripePaymentIntentId);

  if (!purchase || purchase.credits_remaining <= 0) {
    return { revoked: 0 };
  }

  const { error: revokeError } = await supabase
    .from("credit_purchases")
    .update({ credits_remaining: 0 })
    .eq("id", purchase.id);

  if (revokeError) {
    throw new Error(`Failed to revoke credits: ${revokeError.message}`);
  }

  return { revoked: purchase.credits_remaining };
}

/**
 * Give back credits a chargeback clawed back, once the dispute closes in our
 * favour.
 *
 * Restored in place rather than granted afresh, so the wallet ends up as it was
 * rather than gaining a second row that inflates `totalPurchased` and the
 * transaction history. Raising `credits_remaining` is allowed here and nowhere
 * else: `enforce_credit_purchase_monotonicity`
 * (20260731003000_missing_tables_billing_credits.sql:109-124) refuses an
 * increase for every role EXCEPT service_role, precisely so that a customer
 * cannot refill their own wallet while a webhook can reverse a clawback.
 *
 * `credits` is the balance to return TO, not an amount to add — revocation
 * zeroes the row, so the balance that was taken away and the balance to end up
 * with are the same number. Applying it as a floor rather than a delta is what
 * makes a replayed `charge.dispute.closed` a no-op instead of a second helping;
 * were revocation ever to become partial, this would have to become additive and
 * grow a way to mark the record spent.
 *
 * Never lowers the balance, and never exceeds what the pack originally held.
 */
export async function restorePurchasedCredits(
  stripePaymentIntentId: string,
  credits: number,
): Promise<{ restored: number }> {
  if (!Number.isInteger(credits) || credits <= 0) {
    return { restored: 0 };
  }

  const supabase = createServiceRoleClient();
  const purchase = await readGrantForPayment(supabase, stripePaymentIntentId);

  if (!purchase) {
    return { restored: 0 };
  }

  const target = Math.min(
    purchase.credits_purchased,
    Math.max(purchase.credits_remaining, credits),
  );

  if (target <= purchase.credits_remaining) {
    return { restored: 0 };
  }

  const { error: restoreError } = await supabase
    .from("credit_purchases")
    .update({ credits_remaining: target })
    .eq("id", purchase.id);

  if (restoreError) {
    throw new Error(`Failed to restore credits: ${restoreError.message}`);
  }

  return { restored: target - purchase.credits_remaining };
}

/**
 * Wallet summary for the billing dashboard.
 */
export async function getCreditWallet(userId: string): Promise<CreditWallet> {
  const supabase = await createClient();
  const balance = await getUserCreditBalance(userId);

  const purchases = assertRead(
    await supabase
      .from("credit_purchases")
      .select("credits_purchased")
      .eq("user_id", userId),
    "credit_purchases totals read",
  );

  const usage = assertRead(
    await supabase
      .from("credit_usage")
      .select("credits_used")
      .eq("user_id", userId),
    "credit_usage totals read",
  );

  return {
    balance: balance.total,
    included: balance.included,
    purchased: balance.purchased,
    usedThisMonth: balance.usedThisMonth,
    totalPurchased:
      purchases?.reduce((sum, p) => sum + (p.credits_purchased || 0), 0) || 0,
    totalConsumed:
      usage?.reduce((sum, u) => sum + (u.credits_used || 0), 0) || 0,
  };
}

/**
 * Unified transaction history.
 *
 * Purchases and usage live in separate tables, so they are merged here rather
 * than in the UI — the dashboard should not have to know the storage split.
 */
export async function getCreditTransactions(
  userId: string,
  limit: number = 50,
): Promise<CreditTransaction[]> {
  const supabase = await createClient();

  const [purchases, usage] = await Promise.all([
    supabase
      .from("credit_purchases")
      .select("id, credits_purchased, created_at, price_cents")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("credit_usage")
      .select("id, credits_used, operation, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  const purchaseRows = assertRead(purchases, "credit_purchases history read");
  const usageRows = assertRead(usage, "credit_usage history read");

  const transactions: CreditTransaction[] = [
    ...(purchaseRows || []).map((row) => ({
      id: row.id,
      type: (row.price_cents === 0 ? "refund" : "purchase") as
        | "refund"
        | "purchase",
      amount: row.credits_purchased,
      description:
        row.price_cents === 0 ? "Credits granted" : "Credit pack purchased",
      created_at: row.created_at,
    })),
    ...(usageRows || []).map((row) => ({
      id: row.id,
      type: "consumption" as const,
      amount: row.credits_used,
      description: row.operation,
      created_at: row.created_at,
    })),
  ];

  return transactions
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

/**
 * Get user's credit usage history
 */
export async function getCreditUsageHistory(
  userId: string,
  limit: number = 50,
): Promise<
  Array<{
    id: string;
    credits_used: number;
    operation: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }>
> {
  const supabase = await createClient();

  const data = assertRead(
    await supabase
      .from("credit_usage")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    "credit_usage history read",
  );

  return data || [];
}
