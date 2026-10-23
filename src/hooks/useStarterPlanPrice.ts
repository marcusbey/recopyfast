"use client";

import { useCallback, useEffect, useState } from "react";

/** The Starter plan's price as `/api/pricing` returns it (the `plans` table). */
export interface StarterPlanPrice {
  monthlyPrice: number;
  currency: string;
  /**
   * `limits.websites` from the catalogue: a positive count, -1 for unlimited,
   * or null when the payload has no usable value (the page then names no
   * count rather than guessing one).
   */
  websites: number | null;
}

/** The catalogue's "unlimited" sentinel (src/lib/feature-gating). */
const UNLIMITED = -1;

function parseWebsitesLimit(limits: unknown): number | null {
  if (!limits || typeof limits !== "object") return null;
  const websites = (limits as { websites?: unknown }).websites;
  if (websites === UNLIMITED) return UNLIMITED;
  return typeof websites === "number" &&
    Number.isInteger(websites) &&
    websites > 0
    ? websites
    : null;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Strict read of `/api/pricing`'s body: a proxy's 200 error page or a reshaped
 * payload must not put a number on the owner page. No price is ever typed
 * into the page itself (AGENTS.md non-negotiable 7).
 */
export function parseStarterPlanPrice(body: unknown): StarterPlanPrice | null {
  if (!body || typeof body !== "object") return null;
  const plans = (body as { plans?: unknown }).plans;
  if (!Array.isArray(plans)) return null;
  const starter = plans.find(
    (plan): plan is Record<string, unknown> =>
      typeof plan === "object" && plan !== null && plan.id === "starter",
  );
  if (!starter || !isPositiveNumber(starter.monthlyPrice)) return null;
  const currency =
    typeof starter.currency === "string" && /^[a-z]{3}$/i.test(starter.currency)
      ? starter.currency.toUpperCase()
      : "USD";
  return {
    monthlyPrice: starter.monthlyPrice,
    currency,
    websites: parseWebsitesLimit(starter.limits),
  };
}

/**
 * Server state as a custom hook (ADR 005): `{ data, loading, error, refetch }`.
 * A failed or malformed read is an error state, never a made-up price.
 */
export function useStarterPlanPrice() {
  const [data, setData] = useState<StarterPlanPrice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/pricing", { signal });
      if (!response.ok) {
        throw new Error(`Pricing request failed with ${response.status}`);
      }
      const price = parseStarterPlanPrice(await response.json());
      if (!price) throw new Error("Pricing response had no Starter price");
      setData(price);
    } catch (caught) {
      if (signal?.aborted) return;
      setData(null);
      setError(caught instanceof Error ? caught.message : "Pricing failed");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refetch(controller.signal);
    return () => controller.abort();
  }, [refetch]);

  return { data, loading, error, refetch };
}
