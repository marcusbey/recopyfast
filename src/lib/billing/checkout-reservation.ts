import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How long an abandoned Checkout Session blocks a second subscription
 * checkout. Stripe sessions expire in ~24h; 30 minutes is long enough to
 * finish payment and short enough that a closed tab is not a permanent lock.
 */
export const SUBSCRIPTION_CHECKOUT_TTL_MS = 30 * 60 * 1000;

/**
 * Claim the single open subscription-checkout slot for this user.
 *
 * Returns false when a reservation is already live. The unique constraint on
 * `checkout_reservations.user_id` is the cross-isolate backstop; a lost race
 * surfaces as 23505 and is treated the same as a found row.
 */
export async function claimSubscriptionReservation(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data: existing, error: readError } = await supabase
    .from("checkout_reservations")
    .select("user_id, created_at")
    .eq("user_id", userId)
    .eq("intent", "subscription")
    .maybeSingle();

  if (readError) {
    throw new Error(
      `Failed to read checkout reservation: ${readError.message}`,
    );
  }

  if (existing) {
    const createdAt = existing.created_at
      ? new Date(String(existing.created_at)).getTime()
      : Number.NaN;
    const expired =
      Number.isFinite(createdAt) &&
      Date.now() - createdAt >= SUBSCRIPTION_CHECKOUT_TTL_MS;

    if (!expired) {
      return false;
    }

    const { error: refreshError } = await supabase
      .from("checkout_reservations")
      .update({ created_at: new Date().toISOString() })
      .eq("user_id", userId);

    if (refreshError) {
      throw new Error(
        `Failed to refresh checkout reservation: ${refreshError.message}`,
      );
    }
    return true;
  }

  const { error: insertError } = await supabase
    .from("checkout_reservations")
    .insert({
      user_id: userId,
      intent: "subscription",
      created_at: new Date().toISOString(),
    });

  if (insertError) {
    if (insertError.code === "23505") {
      return false;
    }
    throw new Error(`Failed to reserve checkout: ${insertError.message}`);
  }

  return true;
}
