import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  readEffectivePlanId,
  readGrantedPlanIds,
  resolveEntitlement,
} from "./effective-plan";
import type { Entitlement } from "./effective-plan";

export {
  UNENTITLED,
  hasAnyEntitlement,
  resolveEntitlement,
} from "./effective-plan";
export type { Entitlement } from "./effective-plan";

/**
 * Which plan's entitlements a user actually has — or that they have none.
 *
 * There is no free plan. An account that has never paid is *unentitled*, which
 * is a state of its own and not a plan whose limits happen to be zero. Every
 * feature gate resolves through here rather than reading
 * `billing_subscriptions.plan` directly, because a lifetime customer has no
 * subscription row at all and reading only that table would strand them the
 * moment they finished paying $199.
 */

/**
 * The raw plan id recorded for a user, or `null` when there is none.
 *
 * The query lives in ./effective-plan so `src/middleware.ts` can ask the same
 * question with its own request-scoped client.
 */
export async function getEffectivePlanId(
  userId: string,
): Promise<string | null> {
  return readEffectivePlanId(await createClient(), userId);
}

/**
 * Plans this user holds a permanent grant for — see `readGrantedPlanIds` for
 * why this is deliberately NOT the effective plan.
 */
export async function getGrantedPlanIds(userId: string): Promise<string[]> {
  return readGrantedPlanIds(await createClient(), userId);
}

/**
 * What the signed-in user is entitled to: a plan, spendable credits, or
 * nothing.
 *
 * A thin binding of `resolveEntitlement` to the cookie-scoped client. The
 * computation itself is shared with `src/middleware.ts`, which passes its own
 * client to the same function — see ./effective-plan for why that matters.
 */
export async function getEffectivePlan(userId: string): Promise<Entitlement> {
  return resolveEntitlement(await createClient(), userId);
}

export interface GrantEntitlementResult {
  granted: boolean;
  /** True when this payment had already been granted (redelivered webhook). */
  duplicate: boolean;
}

/**
 * Default `source` for a grant bought through Checkout, and what a reversed
 * revocation restores. `revokeEntitlementForPayment` overwrites `source` with
 * `revoked:<reason>`, so the original value is gone by then — this is the only
 * thing it can go back to, and the only value the webhook ever writes.
 */
const LIFETIME_PURCHASE_SOURCE = "lifetime_purchase";

/**
 * `source` recorded when a payment's entitlement is taken away, which is also
 * the record of WHY. Only a chargeback revocation is reversible, so the value
 * has to be produced in one place and matched in another — hence a function
 * rather than two template literals that could drift apart.
 */
function revocationSource(reason: string): string {
  return `revoked:${reason}`;
}

const DISPUTE_REVOCATION_SOURCE = revocationSource("dispute");

/**
 * Record a permanent plan grant.
 *
 * Called from the Stripe webhook with the service-role client, because
 * `plan_entitlements` deliberately has no INSERT policy for authenticated
 * users — the row is worth $199.
 *
 * `stripe_payment_intent_id` is UNIQUE, so a redelivered event collides instead
 * of granting twice. That collision is the expected path, not an error, and is
 * reported as `duplicate` rather than thrown so the webhook can answer 200 and
 * stop Stripe retrying.
 */
export async function grantPlanEntitlement(
  userId: string,
  planId: string,
  stripePaymentIntentId: string,
  source: string = LIFETIME_PURCHASE_SOURCE,
): Promise<GrantEntitlementResult> {
  const supabase = createServiceRoleClient();

  const { error } = await supabase.from("plan_entitlements").insert({
    user_id: userId,
    plan_id: planId,
    source,
    stripe_payment_intent_id: stripePaymentIntentId,
  });

  if (error) {
    if (error.code === "23505") {
      return { granted: false, duplicate: true };
    }
    throw new Error(
      `Failed to grant "${planId}" entitlement to ${userId}: ${error.message}`,
    );
  }

  return { granted: true, duplicate: false };
}

/**
 * Revoke the entitlement a payment granted, after a refund or a chargeback.
 *
 * Soft-revoked (`revoked_at` set) rather than deleted so the audit trail
 * survives: "this user had lifetime and lost it on this date" is a question
 * support will ask, and a deleted row cannot answer it.
 */
export async function revokeEntitlementForPayment(
  stripePaymentIntentId: string,
  reason: string,
): Promise<{ revoked: boolean }> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("plan_entitlements")
    .update({
      revoked_at: new Date().toISOString(),
      source: revocationSource(reason),
    })
    .eq("stripe_payment_intent_id", stripePaymentIntentId)
    .is("revoked_at", null)
    .select("id");

  if (error) {
    throw new Error(
      `Failed to revoke entitlement for ${stripePaymentIntentId}: ${error.message}`,
    );
  }

  return { revoked: (data?.length ?? 0) > 0 };
}

/**
 * Put back an entitlement a chargeback took away, once the dispute closes in
 * our favour.
 *
 * The inverse of `revokeEntitlementForPayment`, and the only thing that ever
 * un-revokes: revocation fires on dispute *creation*, which is provisional,
 * while winning has no other compensating path — there is no admin surface and
 * a lifetime grant has no renewal to re-grant it.
 *
 * Reads before writing rather than filtering on "still revoked" in the predicate
 * so that an entitlement which was never revoked is left exactly as it is:
 * restoring one would overwrite whatever `source` it carries with the default.
 *
 * Only a revocation whose `source` says CHARGEBACK is reversible, and that is
 * the whole reason `source` is read here. A refund is final — the customer has
 * the money — and the two revocations are indistinguishable by `revoked_at`
 * alone. Without this check, settling an early-fraud warning the standard way
 * (refund the charge, Stripe then closes the dispute as `warning_closed`) handed
 * the customer their money back AND their lifetime access.
 */
export async function restoreEntitlementForPayment(
  stripePaymentIntentId: string,
): Promise<{ restored: boolean }> {
  const supabase = createServiceRoleClient();

  const { data: entitlement, error: readError } = await supabase
    .from("plan_entitlements")
    .select("id, revoked_at, source")
    .eq("stripe_payment_intent_id", stripePaymentIntentId)
    .maybeSingle<{ id: string; revoked_at: string | null; source: string }>();

  if (readError) {
    throw new Error(
      `Failed to read the entitlement for ${stripePaymentIntentId}: ${readError.message}`,
    );
  }

  if (!entitlement || entitlement.revoked_at === null) {
    return { restored: false };
  }

  if (entitlement.source !== DISPUTE_REVOCATION_SOURCE) {
    console.error(
      `Refusing to restore the entitlement for ${stripePaymentIntentId}: it was ` +
        `revoked as "${entitlement.source}", not by a chargeback. Only a ` +
        `chargeback revocation is reversible.`,
    );
    return { restored: false };
  }

  const { data, error } = await supabase
    .from("plan_entitlements")
    .update({ revoked_at: null, source: LIFETIME_PURCHASE_SOURCE })
    .eq("id", entitlement.id)
    .select("id");

  if (error) {
    throw new Error(
      `Failed to restore entitlement for ${stripePaymentIntentId}: ${error.message}`,
    );
  }

  return { restored: (data?.length ?? 0) > 0 };
}
