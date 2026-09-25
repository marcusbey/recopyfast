import { createServiceRoleClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe/config";
import type Stripe from "stripe";

export const FOUNDING_AGENCY_LIMIT = 50 as const;
export const FOUNDING_AGENCY_RECONCILIATION_GRACE_SECONDS = 10 * 60;
export const STRIPE_HISTORY_CLOCK_SKEW_SECONDS = 5 * 60;

export interface FoundingAgencyAvailability {
  remaining: number;
  soldOut: boolean;
  limit: typeof FOUNDING_AGENCY_LIMIT;
}

export interface OpenFoundingAgencyCheckout {
  sessionId: string;
  url: string;
}

export type FoundingAgencyReservation =
  | { outcome: "reserved"; reservationId: string; checkoutExpiresAt: number }
  | {
      outcome: "sold_out" | "capacity_busy" | "owned" | "refunded";
      reservationId: null;
      checkoutExpiresAt: null;
    };

interface AvailabilityRow {
  completed: number;
  remaining: number;
  sold_out: boolean;
}

interface ReservationRow {
  reservation_id: string | null;
  outcome: "reserved" | "sold_out" | "capacity_busy" | "owned" | "refunded";
  checkout_expires_at: number | null;
}

interface ExpiredBoundReservationRow {
  id: string;
  user_id: string | null;
  stripe_checkout_session_id: string | null;
  checkout_expires_at: number;
  created_at: string;
}

type ReconciliationReason =
  | "stripe_history_no_session"
  | "stripe_session_lookup_failed"
  | "stripe_session_state_unresolved";

function rpcError(operation: string, message: string): Error {
  return new Error(
    `Failed to ${operation} Founding Agency capacity: ${message}`,
  );
}

/** Public-safe aggregate: completed-sale availability only, never identities. */
export async function getFoundingAgencyAvailability(): Promise<FoundingAgencyAvailability> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc(
    "get_founding_agency_availability",
  );

  if (error) throw rpcError("read", error.message);
  const row = (data as AvailabilityRow[] | null)?.[0];
  if (!row) throw rpcError("read", "the aggregate RPC returned no row");

  return {
    remaining: row.remaining,
    soldOut: row.sold_out,
    limit: FOUNDING_AGENCY_LIMIT,
  };
}

/**
 * Return only a provider-confirmed resumable Checkout Session.
 *
 * The local reservation alone is insufficient: another isolate may observe a
 * newly inserted but still-unbound hold, and a bound session may have become
 * complete or expired since the database write. Checkout uses this read before
 * the new-session quota, so only an open Stripe session with the same account
 * identity and a usable URL bypasses that bucket.
 */
export async function getOpenFoundingAgencyCheckout(
  userId: string,
): Promise<OpenFoundingAgencyCheckout | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("founding_agency_reservations")
    .select("id, stripe_checkout_session_id, created_at")
    .eq("user_id", userId)
    .eq("product_id", "lifetime_agency")
    .eq("status", "reserved")
    .maybeSingle<{
      id: string;
      stripe_checkout_session_id: string | null;
      created_at: string;
    }>();

  if (error) throw rpcError("resume", error.message);
  if (!data) return null;

  let session: Stripe.Checkout.Session | undefined;
  if (data.stripe_checkout_session_id) {
    session = await stripe.checkout.sessions.retrieve(
      data.stripe_checkout_session_id,
    );
  } else {
    const { data: customer, error: customerError } = await supabase
      .from("billing_customers")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle<{ stripe_customer_id: string }>();
    if (customerError) throw rpcError("resume", customerError.message);

    let startingAfter: string | undefined;
    do {
      const sessions = await stripe.checkout.sessions.list({
        ...(customer?.stripe_customer_id
          ? { customer: customer.stripe_customer_id }
          : {}),
        created: {
          gte:
            Math.floor(Date.parse(data.created_at) / 1000) -
            STRIPE_HISTORY_CLOCK_SKEW_SECONDS,
        },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      session = sessions.data.find(
        (candidate) =>
          candidate.client_reference_id === userId &&
          candidate.metadata?.user_id === userId &&
          candidate.metadata?.product_id === "lifetime_agency" &&
          candidate.metadata?.founding_reservation_id === data.id &&
          candidate.status === "open" &&
          typeof candidate.url === "string" &&
          candidate.url.length > 0,
      );
      if (session || !sessions.has_more) break;
      startingAfter = sessions.data.at(-1)?.id;
      if (!startingAfter) break;
    } while (startingAfter);

    if (!session) return null;
    await bindFoundingAgencyCheckout(
      data.id,
      userId,
      session.id,
      session.expires_at,
    );
  }

  if (
    (data.stripe_checkout_session_id &&
      session.id !== data.stripe_checkout_session_id) ||
    session.status !== "open" ||
    session.client_reference_id !== userId ||
    typeof session.url !== "string" ||
    session.url.length === 0
  ) {
    return null;
  }

  return { sessionId: session.id, url: session.url };
}

export async function reserveFoundingAgencySpot(
  userId: string,
): Promise<FoundingAgencyReservation> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("reserve_founding_agency_spot", {
    p_user_id: userId,
  });

  if (error) throw rpcError("reserve", error.message);
  const row = (data as ReservationRow[] | null)?.[0];
  if (!row) throw rpcError("reserve", "the capacity RPC returned no row");

  if (
    row.outcome === "reserved" &&
    row.reservation_id &&
    typeof row.checkout_expires_at === "number"
  ) {
    return {
      outcome: "reserved",
      reservationId: row.reservation_id,
      checkoutExpiresAt: row.checkout_expires_at,
    };
  }
  if (
    row.outcome === "sold_out" ||
    row.outcome === "capacity_busy" ||
    row.outcome === "owned" ||
    row.outcome === "refunded"
  ) {
    return {
      outcome: row.outcome,
      reservationId: null,
      checkoutExpiresAt: null,
    };
  }
  throw rpcError("reserve", "the capacity RPC returned an invalid result");
}

/**
 * Reconcile clock-expired holds before another capacity claim.
 *
 * A missing local session id does not prove Stripe rejected the request: the
 * create response or bind write may have been lost. Provider history is
 * therefore checked for unbound rows too. Provider-confirmed expired/unpaid
 * sessions release immediately. Missing or unresolved sessions stay held
 * through expiry plus ten minutes; known paid/completed sessions retain their
 * capacity. A provider-specific row failure is isolated; once its grace ends a
 * service-only RPC releases and flags it for operators. Local database failures
 * still throw and fail the new reservation closed.
 */
export async function reconcileExpiredFoundingAgencyCheckouts(): Promise<number> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("founding_agency_reservations")
    .select(
      "id, user_id, stripe_checkout_session_id, checkout_expires_at, created_at",
    )
    .eq("product_id", "lifetime_agency")
    .eq("status", "reserved")
    .lte("checkout_expires_at", Math.floor(Date.now() / 1000))
    .limit(FOUNDING_AGENCY_LIMIT);

  if (error) throw rpcError("reconcile", error.message);

  let released = 0;
  for (const row of (data ?? []) as ExpiredBoundReservationRow[]) {
    let session;
    let unresolvedReason: ReconciliationReason | null = null;
    if (row.stripe_checkout_session_id) {
      try {
        session = await stripe.checkout.sessions.retrieve(
          row.stripe_checkout_session_id,
        );
      } catch {
        unresolvedReason = "stripe_session_lookup_failed";
      }
    } else {
      let stripeCustomerId: string | undefined;
      if (row.user_id) {
        const { data: customer, error: customerError } = await supabase
          .from("billing_customers")
          .select("stripe_customer_id")
          .eq("user_id", row.user_id)
          .maybeSingle<{ stripe_customer_id: string }>();
        if (customerError) throw rpcError("reconcile", customerError.message);
        stripeCustomerId = customer?.stripe_customer_id;
      }

      try {
        let startingAfter: string | undefined;
        do {
          const sessions = await stripe.checkout.sessions.list({
            ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
            created: {
              gte:
                Math.floor(Date.parse(row.created_at) / 1000) -
                STRIPE_HISTORY_CLOCK_SKEW_SECONDS,
            },
            limit: 100,
            ...(startingAfter ? { starting_after: startingAfter } : {}),
          });
          session = sessions.data.find(
            (candidate) =>
              candidate.metadata?.founding_reservation_id === row.id &&
              (!row.user_id || candidate.client_reference_id === row.user_id),
          );
          if (session || !sessions.has_more) break;
          startingAfter = sessions.data.at(-1)?.id;
          if (!startingAfter) {
            unresolvedReason = "stripe_session_lookup_failed";
            break;
          }
        } while (startingAfter);
      } catch {
        unresolvedReason = "stripe_session_lookup_failed";
      }

      if (!session) {
        unresolvedReason ??= "stripe_history_no_session";
      }
    }

    if (session?.payment_status === "paid" || session?.status === "complete") {
      continue;
    }

    if (session?.status === "expired" && session.payment_status === "unpaid") {
      if (
        await releaseFoundingAgencyCheckout(row.id, row.user_id, session.id)
      ) {
        released += 1;
      }
      continue;
    }

    if (session) {
      unresolvedReason = "stripe_session_state_unresolved";
    }

    if (unresolvedReason) {
      const providerExpiresAt = session?.expires_at;
      // Sessions created by this app receive the frozen reservation deadline
      // as their explicit Stripe expires_at, so these values normally match.
      // max() is defensive for a provider/history anomaly within this call; a
      // later lookup failure deliberately falls back to the durable local
      // deadline rather than trusting provider state we could not re-read.
      const graceStartsAt =
        typeof providerExpiresAt === "number" &&
        Number.isFinite(providerExpiresAt)
          ? Math.max(row.checkout_expires_at, providerExpiresAt)
          : row.checkout_expires_at;
      const isPastGrace =
        Math.floor(Date.now() / 1000) >=
        graceStartsAt + FOUNDING_AGENCY_RECONCILIATION_GRACE_SECONDS;
      if (!isPastGrace) continue;

      // Never print provider errors here. They can contain request data. The
      // bounded reason and reservation id give operators enough to reconcile
      // through the service-only query without putting Stripe detail in logs.
      console.warn(
        `[billing] releasing unresolved Founding Agency hold ${row.id} after grace (${unresolvedReason})`,
      );
      if (
        await releaseUnresolvedFoundingAgencyCheckout(row.id, unresolvedReason)
      ) {
        released += 1;
      }
      continue;
    }
  }
  return released;
}

async function releaseUnresolvedFoundingAgencyCheckout(
  reservationId: string,
  reason: ReconciliationReason,
): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc(
    "release_unresolved_founding_agency_checkout",
    {
      p_reservation_id: reservationId,
      p_reconciliation_reason: reason,
    },
  );

  if (error) throw rpcError("reconcile", error.message);
  return data === true;
}

export async function bindFoundingAgencyCheckout(
  reservationId: string,
  userId: string | null,
  stripeCheckoutSessionId: string,
  stripeCheckoutExpiresAt?: number,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("bind_founding_agency_checkout", {
    p_reservation_id: reservationId,
    p_user_id: userId,
    p_stripe_checkout_session_id: stripeCheckoutSessionId,
    ...(stripeCheckoutExpiresAt === undefined
      ? {}
      : { p_stripe_checkout_expires_at: stripeCheckoutExpiresAt }),
  });

  if (error) throw rpcError("bind", error.message);
  if (data !== true) {
    throw rpcError("bind", "the reservation could not be bound to Checkout");
  }
}

export async function releaseFoundingAgencyCheckout(
  reservationId: string,
  userId: string | null,
  stripeCheckoutSessionId: string | null,
): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc(
    "release_founding_agency_checkout",
    {
      p_reservation_id: reservationId,
      p_user_id: userId,
      p_stripe_checkout_session_id: stripeCheckoutSessionId,
    },
  );

  if (error) throw rpcError("release", error.message);
  return data === true;
}

export async function completeFoundingAgencyPurchase(
  reservationId: string,
  userId: string,
  stripePaymentIntentId: string,
): Promise<
  | { granted: true; duplicate: false }
  | { granted: false; duplicate: true }
  | {
      granted: false;
      duplicate: false;
      refundRequired: true;
    }
  | { granted: false; duplicate: false; refunded: true }
> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc(
    "complete_founding_agency_purchase",
    {
      p_reservation_id: reservationId,
      p_user_id: userId,
      p_stripe_payment_intent_id: stripePaymentIntentId,
    },
  );

  if (error) throw rpcError("complete", error.message);
  if (data === "granted") return { granted: true, duplicate: false };
  if (data === "duplicate") return { granted: false, duplicate: true };
  if (data === "refunded") {
    return { granted: false, duplicate: false, refunded: true };
  }
  if (data === "refund_required") {
    return {
      granted: false,
      duplicate: false,
      refundRequired: true,
    };
  }
  throw rpcError("complete", "the completion RPC returned an invalid result");
}

export async function bindFoundingAgencyDuplicateRefundSession(
  reservationId: string,
  userId: string,
  stripePaymentIntentId: string,
  stripeCheckoutSessionId: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc(
    "bind_founding_agency_duplicate_refund_session",
    {
      p_reservation_id: reservationId,
      p_user_id: userId,
      p_stripe_payment_intent_id: stripePaymentIntentId,
      p_stripe_checkout_session_id: stripeCheckoutSessionId,
    },
  );

  if (error) throw rpcError("bind duplicate refund session for", error.message);
  if (data !== true) {
    throw rpcError(
      "bind duplicate refund session for",
      "the reservation no longer matches the duplicate payment",
    );
  }
}

export async function markFoundingAgencyDuplicateRefunded(
  reservationId: string,
  userId: string,
  stripePaymentIntentId: string,
  stripeRefundId: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc(
    "mark_founding_agency_duplicate_refunded",
    {
      p_reservation_id: reservationId,
      p_user_id: userId,
      p_stripe_payment_intent_id: stripePaymentIntentId,
      p_stripe_refund_id: stripeRefundId,
    },
  );

  if (error) throw rpcError("record duplicate refund for", error.message);
  if (data !== true) {
    throw rpcError(
      "record duplicate refund for",
      "the reservation no longer matches the duplicate payment",
    );
  }
}
