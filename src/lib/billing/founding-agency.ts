import { createServiceRoleClient } from "@/lib/supabase/service";

export const FOUNDING_AGENCY_LIMIT = 50 as const;

export interface FoundingAgencyAvailability {
  remaining: number;
  soldOut: boolean;
  limit: typeof FOUNDING_AGENCY_LIMIT;
}

export type FoundingAgencyReservation =
  | { outcome: "reserved"; reservationId: string; checkoutExpiresAt: number }
  | {
      outcome: "sold_out" | "capacity_busy" | "owned";
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
  outcome: "reserved" | "sold_out" | "capacity_busy" | "owned";
  checkout_expires_at: number | null;
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
    row.outcome === "owned"
  ) {
    return {
      outcome: row.outcome,
      reservationId: null,
      checkoutExpiresAt: null,
    };
  }
  throw rpcError("reserve", "the capacity RPC returned an invalid result");
}

export async function bindFoundingAgencyCheckout(
  reservationId: string,
  userId: string,
  stripeCheckoutSessionId: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("bind_founding_agency_checkout", {
    p_reservation_id: reservationId,
    p_user_id: userId,
    p_stripe_checkout_session_id: stripeCheckoutSessionId,
  });

  if (error) throw rpcError("bind", error.message);
  if (data !== true) {
    throw rpcError("bind", "the reservation could not be bound to Checkout");
  }
}

export async function releaseFoundingAgencyCheckout(
  reservationId: string,
  userId: string,
  stripeCheckoutSessionId: string,
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
