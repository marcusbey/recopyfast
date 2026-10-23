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

/** How many sites the plan covers, from `limits.websites`; never a guess. */
function websitesPhrase(websites: number | null): string {
  if (websites === null) return "and you edit your site yourself";
  if (websites === -1) return "for unlimited websites that you edit yourself";
  if (websites === 1) return "for one website that you edit yourself";
  return `for up to ${websites} websites that you edit yourself`;
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
        {websitesPhrase(data.websites)}. That is usually less than a single paid
        change.
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
