"use client";

import Link from "next/link";
import { useStarterPlanPrice } from "@/hooks/useStarterPlanPrice";

function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

/**
 * The cost answer on /for/owners, with the price read from the catalogue at
 * view time. Loading and failure say so in words; neither shows a number.
 */
export function OwnerStarterPrice() {
  const { data, loading, error } = useStarterPlanPrice();

  if (data) {
    return (
      <p data-testid="owner-starter-price">
        The Starter plan is{" "}
        <strong>{formatPrice(data.monthlyPrice, data.currency)} a month</strong>{" "}
        for one website that you edit yourself. That is usually less than a
        single paid change.
      </p>
    );
  }

  if (loading && !error) {
    return (
      <p aria-busy="true" data-testid="owner-starter-price">
        Loading the current Starter price…
      </p>
    );
  }

  return (
    <p data-testid="owner-starter-price">
      We couldn&apos;t load the current price just now.{" "}
      <Link href="/#pricing">See the plans and prices</Link>.
    </p>
  );
}
