"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// Type only. The module's values reach the service-role client, which must
// never be bundled into the landing page.
import type { FoundingOfferAvailability } from "@/lib/billing/founding-offer";

/**
 * The founding-offer count as the landing page may show it (s47b).
 *
 * `closed` is sold out OR unknown, deliberately one state: the 14-day trial
 * line is never wrong, and a count the page could not read must not render any
 * differently from a count of zero. `loading` promises neither the offer nor
 * the trial, so the page never paints one promise and then swaps it for the
 * other.
 */
export type FoundingOfferView =
  | { status: "loading" }
  | { status: "open"; remaining: number; limit: number }
  | { status: "closed" };

interface FoundingOfferState {
  data: FoundingOfferAvailability | null;
  loading: boolean;
  error: string | null;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * At least as strict as the server's own read (`getFoundingOfferAvailability`).
 * Anything between the route and this page — a proxy's 200 error page, a
 * truncated body — could otherwise put a number on a scarcity claim.
 */
export function parseFoundingOfferAvailability(
  body: unknown,
): FoundingOfferAvailability | null {
  if (!body || typeof body !== "object") return null;
  const { limit, remaining, soldOut } = body as Record<string, unknown>;
  if (
    !isInteger(limit) ||
    limit < 1 ||
    !isInteger(remaining) ||
    remaining < 0 ||
    remaining > limit ||
    typeof soldOut !== "boolean" ||
    soldOut !== (remaining === 0)
  ) {
    return null;
  }
  return { limit, remaining, soldOut };
}

export function toFoundingOfferView({
  data,
  loading,
  error,
}: FoundingOfferState): FoundingOfferView {
  if (data && !data.soldOut) {
    return { status: "open", remaining: data.remaining, limit: data.limit };
  }
  if (loading && !error) return { status: "loading" };
  return { status: "closed" };
}

/**
 * Read once per page load, uncached: the route is uncached precisely so the
 * count is right the moment a spot goes (s47a). No polling and no client-side
 * memo — the offer card's fine print covers a count that goes stale while the
 * page stays open.
 */
export function useFoundingOffer() {
  const [data, setData] = useState<FoundingOfferAvailability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    const requestNumber = ++requestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const isCurrent = () =>
      !controller.signal.aborted && requestRef.current === requestNumber;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/offers/founding", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `Founding offer request failed with ${response.status}`,
        );
      }
      const availability = parseFoundingOfferAvailability(
        await response.json(),
      );
      if (!availability) {
        throw new Error("Founding offer response was out of bounds");
      }
      if (!isCurrent()) return;
      setData(availability);
    } catch (caught) {
      if (!isCurrent()) return;
      console.error("Failed to load the founding offer count:", caught);
      setData(null);
      setError("Could not load the founding offer count");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
    return () => abortRef.current?.abort();
  }, [refetch]);

  return { data, loading, error, refetch };
}
