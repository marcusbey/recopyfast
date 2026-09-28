import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import {
  LIVE_SUBSCRIPTION_STATUSES,
  readTrialGrant,
  resolveEntitlement,
} from "@/lib/billing/effective-plan";
import { isLegacyRefundGrant, readPurchasedCreditBalance } from "./spendable";
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
  windowStart: string; // Start of the allowance window usedThisMonth is summed over
}

/**
 * The receipt of a charge that landed: the `credit_usage` row `spend_credits`
 * wrote, whose wallet it was, and how much. A refund is keyed by this and by
 * nothing else — see `refundCharge`.
 */
export interface CreditCharge {
  usageId: string;
  userId: string;
  credits: number;
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
 * Get user's current credit balance.
 *
 * `client` — see the note on `consumeCredits`, which is where it matters.
 * Absent, this reads the signed-in caller's own wallet exactly as it always
 * has: the cookie client, and the plan from `getEffectivePlan`.
 */
export async function getUserCreditBalance(
  userId: string,
  client?: SupabaseClient,
): Promise<CreditBalance> {
  const supabase = client ?? (await createClient());

  // Resolved through the entitlement layer so a Lifetime Pro customer, who has
  // no billing_subscriptions row at all, still gets Pro's included credits.
  //
  // Only a plan includes credits. A credit-only holder has a wallet and no
  // allowance, which is the difference between the two kinds of entitlement.
  // This read is on the path the billing dashboard takes, so it must answer
  // rather than throw for someone who has not subscribed.
  //
  // With an explicit payer client the SAME computation runs against that
  // client: `getEffectivePlan` is only `resolveEntitlement` bound to the
  // cookie client, and the cookie belongs to whoever is calling, not to the
  // payer.
  const entitlement = client
    ? await resolveEntitlement(client, userId)
    : await getEffectivePlan(userId);
  const includedCredits =
    entitlement.kind === "plan" ? entitlement.plan.limits.monthlyCredits : 0;

  // NOTE: `plan` is the column name on billing_subscriptions, not `plan_id`.
  // Only the period boundary is needed here; the plan itself came from above.
  // Keep this status vocabulary shared with entitlement resolution. A
  // trialing or past-due customer still has the plan and its credits there, so
  // dropping either status here would reset their allowance against a
  // different calendar and could under- or over-serve the same entitlement.
  //
  // There can briefly be more than one live row while Stripe lifecycle events
  // settle. Entitlement resolution already treats the newest row as canonical;
  // using `maybeSingle()` without the same ordering made the billing dashboard
  // throw PGRST116, or made credits follow a different subscription than the
  // plan. Keep these reads deliberately identical.
  const subscription = assertRead(
    await supabase
      .from("billing_subscriptions")
      .select("current_period_start, current_period_end")
      .eq("user_id", userId)
      .in("status", [...LIVE_SUBSCRIPTION_STATUSES])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{
        current_period_start: string;
        current_period_end: string | null;
      }>(),
    "billing_subscriptions read",
  );

  // Shared with entitlement resolution, which asks the same question to decide
  // whether a wallet alone entitles its holder. Two totals computed two ways
  // would eventually disagree about which rows still count.
  const purchasedCredits = await readPurchasedCreditBalance(supabase, userId);

  // A trial's allowance runs in monthly windows anchored on its own grant.
  //
  // A trialling account resolves to `pro` and therefore inherits Pro's 500
  // included credits — nobody grants them, they fall out of the plan. But with
  // no subscription row the window below defaulted to the calendar month, so a
  // trial started on the 25th drew 500 credits and then 500 more on the 1st:
  // 1,000 credits of OpenAI spend on fourteen card-less days. Anchoring on the
  // trial's own `granted_at` closes that, which is the "a trial never grants
  // uncapped spend" half of AC 8.
  //
  // s47a (ADR 039) steps that anchor on each monthly anniversary, because the
  // founding offer is a 90-day trial row metered at 100 a MONTH: a single
  // window would give it 100 in total. A 14-day trial never reaches its first
  // anniversary — the shortest gap between two is 28 days — so for it this is
  // still one non-renewing window, exactly as before.
  //
  // Below the subscription deliberately: once someone converts, the thing being
  // billed owns the period again, and the lapsing trial grant must not hold the
  // window open behind it.
  const trial = await readTrialGrant(supabase, userId);

  const startOfPeriod =
    (subscription?.current_period_start
      ? spansMoreThanOneCalendarMonth(
          subscription.current_period_start,
          subscription.current_period_end,
        )
        ? startOfCurrentAllowanceWindow(subscription.current_period_start)
        : subscription.current_period_start
      : null) ||
    (trial?.isActive
      ? startOfCurrentAllowanceWindow(trial.grantedAt)
      : startOfCurrentMonth());

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
    windowStart: startOfPeriod,
  };
}

/**
 * Without a subscription there is no billing period, so the included allowance
 * resets on the calendar month. Using "now" instead would count zero usage and
 * hand out the monthly allowance again on every call.
 *
 * The last resort, not the only rule: a live subscription's `current_period_start`
 * and an active trial's `granted_at` both take precedence — see the caller. This
 * is what a lifetime-grant holder, a lapsed trial and a credit-only wallet fall
 * back to.
 */
function startOfCurrentMonth(): string {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/**
 * Monthly subscriptions already carry the exact allowance window Stripe chose.
 * Re-stepping a clamped start such as Feb 28 in a Feb 28 -> Mar 31 period would
 * invent a Mar 28 reset and hand out a second allowance before renewal. Only a
 * multi-month billing term needs the catalogue's monthly allowance subdivided.
 */
function spansMoreThanOneCalendarMonth(
  periodStart: string,
  periodEnd: string | null,
): boolean {
  if (!periodEnd) return false;

  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return false;
  }

  const calendarMonthSpan =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());

  return calendarMonthSpan > 1;
}

/**
 * Find the monthly allowance window inside a subscription's billing term.
 *
 * Annual Stripe periods keep `current_period_start` fixed for a year, while
 * the catalogue promises a monthly credit allowance. Advancing the previously
 * clamped date would turn Jan 31 into Feb 28 and then Mar 28, permanently
 * moving the customer's reset earlier. Every candidate is therefore derived
 * from the original UTC anchor: Jan 31 becomes Feb 28/29 and then Mar 31 again.
 * UTC also keeps the preserved time-of-day independent of local DST changes.
 */
export function startOfCurrentAllowanceWindow(
  periodStart: string,
  now: Date = new Date(),
): string {
  const anchor = new Date(periodStart);
  if (Number.isNaN(anchor.getTime()) || Number.isNaN(now.getTime())) {
    return periodStart;
  }

  const anchorYear = anchor.getUTCFullYear();
  const anchorMonth = anchor.getUTCMonth();
  const anchorDay = anchor.getUTCDate();

  const candidateForOffset = (offset: number): Date => {
    const absoluteMonth = anchorYear * 12 + anchorMonth + offset;
    const targetYear = Math.floor(absoluteMonth / 12);
    const targetMonth = ((absoluteMonth % 12) + 12) % 12;
    const lastDayOfTargetMonth = new Date(
      Date.UTC(targetYear, targetMonth + 1, 0),
    ).getUTCDate();

    return new Date(
      Date.UTC(
        targetYear,
        targetMonth,
        Math.min(anchorDay, lastDayOfTargetMonth),
        anchor.getUTCHours(),
        anchor.getUTCMinutes(),
        anchor.getUTCSeconds(),
        anchor.getUTCMilliseconds(),
      ),
    );
  };

  let monthOffset = Math.max(
    0,
    (now.getUTCFullYear() - anchorYear) * 12 +
      (now.getUTCMonth() - anchorMonth),
  );
  let candidate = candidateForOffset(monthOffset);

  // The matching calendar month may not have reached the anchored day and
  // timestamp yet. The previous window remains current until that instant;
  // `gte` in the caller makes the exact boundary inclusive.
  if (candidate.getTime() > now.getTime() && monthOffset > 0) {
    monthOffset -= 1;
    candidate = candidateForOffset(monthOffset);
  }

  return candidate.toISOString();
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

/** One row of `spend_credits` (migration 20260928110000). */
interface SpendCreditsRow {
  outcome: string;
  usage_id: string | null;
  from_allowance: number;
  from_purchased: number;
  remaining: number;
}

/**
 * Spend `credits` from `userId`'s wallet, and return the receipt a refund needs.
 *
 * The whole charge is one call to `spend_credits` (migration 20260928110000,
 * ADR 040): under a per-user lock it draws the allowance first, then purchase
 * rows oldest first, and records the usage row with the rows it debited — or
 * refuses without writing anything. It replaced a TypeScript compare-and-swap
 * loop that, on a collision, restarted with the full amount without undoing
 * the rows it had already decremented: twelve concurrent charges lost 2–9
 * credits per round and refused requests the wallet covered (probe P4), and
 * two concurrent charges could both draw the same allowance. Do not move any
 * part of the spend back out of the function.
 *
 * TypeScript keeps one half: `getUserCreditBalance` decides how much is
 * included and since when, and both are passed in. No plan or window rule
 * lives in SQL.
 *
 * `client` exists for s40, and it is the one place in this module that can
 * move somebody else's money. `POST /api/ai/suggest` is called by the widget on
 * a customer's origin: there is no cookie session there, so the cookie client
 * resolved every payer to "no plan" and every suggestion was refused, even for
 * an editor the route had just authorised. The route now passes a service-role
 * client for the SITE OWNER, and every read of this call — balance,
 * entitlement — and the `spend_credits` call itself go through it.
 *
 * Only a route that has already authorised an editor for the site AND resolved
 * the owner from `site_permissions` may pass a service-role client here. The
 * client bypasses RLS, so `userId` is the only thing deciding whose wallet is
 * read and spent; handing one to a route that took `userId` from the request
 * would let any caller spend any account's credits.
 *
 * Absent, nothing changes: the cookie client and `getEffectivePlan`, in that
 * order, for the signed-in caller's own wallet.
 */
export async function consumeCredits(
  userId: string,
  credits: number,
  operation: string,
  metadata?: Record<string, unknown>,
  client?: SupabaseClient,
): Promise<{
  success: boolean;
  error?: string;
  remainingCredits?: number;
  charge?: CreditCharge;
}> {
  const supabase = client ?? (await createClient());
  const balance = await getUserCreditBalance(userId, client);

  // The allowance and its window are the TypeScript half; the arithmetic and
  // the exclusion are the database's. No plan or window rule enters SQL.
  const { data, error } = await supabase.rpc("spend_credits", {
    p_user_id: userId,
    p_credits: credits,
    p_included: balance.included,
    p_window_start: balance.windowStart,
    p_operation: operation,
    p_metadata: metadata ?? {},
  });

  const row = error ? null : (data as SpendCreditsRow[] | null)?.[0];

  if (row?.outcome === "charged" && typeof row.usage_id === "string") {
    return {
      success: true,
      remainingCredits: row.remaining,
      charge: { usageId: row.usage_id, userId, credits },
    };
  }

  if (row?.outcome === "insufficient") {
    return {
      success: false,
      error: `Insufficient credits. You need ${credits} credits but only have ${row.remaining}.`,
    };
  }

  console.error(
    `spend_credits did not charge ${userId} for ${operation}:`,
    error ?? row ?? "no row returned",
  );
  return { success: false, error: "Failed to charge credits" };
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
 * Give back all or part of a charge, to where it came from.
 *
 * Keyed by the receipt `consumeCredits` returned in the same request, and by
 * nothing else: never an id from a request body, never a bare user id. The
 * refund it replaced took `(userId, credits)`, could not know where a charge
 * came from, and so minted a new never-expiring "purchased" row every time —
 * even for a charge the monthly allowance had paid, which then stayed counted
 * as used (probe P2). That row alone let a lapsed, never-paying trial through
 * the paywall (probe P3). `refund_credit_usage` instead returns purchased
 * credits first, into the exact rows the charge debited, then the allowance by
 * lowering the charge's net `credits_used` — so the wallet ends as if only the
 * kept share had been charged, and no row is ever created.
 *
 * Service role only: raising `credits_remaining` is refused by the
 * monotonicity trigger for everyone else, and `authenticated` cannot execute
 * the function at all. The database caps the amount at what the charge still
 * holds, so refunding a receipt twice (a provider failure, then the catch)
 * never returns more than was taken.
 *
 * Never throws: it runs on the way out of a failure. Returns what was actually
 * given back.
 */
export async function refundCharge(
  charge: CreditCharge,
  credits: number = charge.credits,
): Promise<{ success: boolean; refunded: number }> {
  if (!Number.isInteger(credits) || credits <= 0 || credits > charge.credits) {
    console.error(
      `refundCharge refused ${credits} credits for usage ${charge.usageId}, which charged ${charge.credits}`,
    );
    return { success: false, refunded: 0 };
  }

  try {
    const { data, error } = await createServiceRoleClient().rpc(
      "refund_credit_usage",
      {
        p_usage_id: charge.usageId,
        p_user_id: charge.userId,
        p_credits: credits,
      },
    );
    const row = error
      ? null
      : (data as Array<{ refunded: number }> | null)?.[0];

    if (!row || typeof row.refunded !== "number") {
      console.error(
        `refund_credit_usage failed for usage ${charge.usageId}:`,
        error ?? "no row returned",
      );
      return { success: false, refunded: 0 };
    }

    return { success: true, refunded: row.refunded };
  } catch (refundError) {
    console.error(
      `refund_credit_usage threw for usage ${charge.usageId}:`,
      refundError,
    );
    return { success: false, refunded: 0 };
  }
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
      .select("credits_purchased, stripe_payment_intent_id")
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
    // Paid credits only: a legacy `refund_` row was minted by the old refund,
    // not bought — see `isLegacyRefundGrant` (s48).
    totalPurchased:
      purchases
        ?.filter((p) => !isLegacyRefundGrant(p.stripe_payment_intent_id))
        .reduce((sum, p) => sum + (p.credits_purchased || 0), 0) || 0,
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
    // `credits_used` is the net charge (s48): a fully refunded request is a
    // row at 0, which is not a consumption the customer should see.
    supabase
      .from("credit_usage")
      .select("id, credits_used, operation, created_at")
      .eq("user_id", userId)
      .gt("credits_used", 0)
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
