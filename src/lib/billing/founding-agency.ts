import { createServiceRoleClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe/config";

export const FOUNDING_AGENCY_LIMIT = 50 as const;

export interface FoundingAgencyAvailability {
  remaining: number;
  soldOut: boolean;
  limit: typeof FOUNDING_AGENCY_LIMIT;
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
  created_at: string;
}

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
 * therefore checked for unbound rows too. A delayed paid/completed session
 * keeps its capacity after the deadline; only provider-confirmed expiry or an
 * exhaustive no-session result releases it. Any Stripe/read failure throws and
 * fails the new reservation closed.
 */
export async function reconcileExpiredFoundingAgencyCheckouts(): Promise<number> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("founding_agency_reservations")
    .select("id, user_id, stripe_checkout_session_id, created_at")
    .eq("product_id", "lifetime_agency")
    .eq("status", "reserved")
    .lte("checkout_expires_at", Math.floor(Date.now() / 1000))
    .limit(FOUNDING_AGENCY_LIMIT);

  if (error) throw rpcError("reconcile", error.message);

  let released = 0;
  for (const row of (data ?? []) as ExpiredBoundReservationRow[]) {
    let session;
    if (row.stripe_checkout_session_id) {
      session = await stripe.checkout.sessions.retrieve(
        row.stripe_checkout_session_id,
      );
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

      let startingAfter: string | undefined;
      do {
        const sessions = await stripe.checkout.sessions.list({
          ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
          created: { gte: Math.floor(Date.parse(row.created_at) / 1000) },
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
          throw rpcError(
            "reconcile",
            "Stripe returned an empty Checkout page with has_more=true",
          );
        }
      } while (startingAfter);

      if (!session) {
        if (await releaseFoundingAgencyCheckout(row.id, row.user_id, null)) {
          released += 1;
        }
        continue;
      }

      if (typeof session.expires_at !== "number") {
        throw rpcError(
          "reconcile",
          `Stripe session ${session.id} has no expiry`,
        );
      }
      await bindFoundingAgencyCheckout(
        row.id,
        row.user_id,
        session.id,
        session.expires_at,
      );
    }
    if (session.status !== "expired" || session.payment_status !== "unpaid") {
      continue;
    }
    if (await releaseFoundingAgencyCheckout(row.id, row.user_id, session.id)) {
      released += 1;
    }
  }
  return released;
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
): Promise<{ granted: boolean; duplicate: boolean }> {
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
  throw rpcError("complete", "the completion RPC returned an invalid result");
}
