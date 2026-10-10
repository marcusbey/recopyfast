import { getPlanCatalogue, isAgencyCheckoutEnabled } from "@/lib/stripe/plans";
import type { MonthlyOffer } from "./json-ld";

/**
 * Every Stripe price is created in USD (scripts/sync-stripe-catalogue.mjs), and
 * the pricing cards print `$`. The `plans` table stores no currency of its own.
 */
const CATALOGUE_CURRENCY = "USD";

/**
 * The subscription plans the homepage sells, as structured-data offers (s88).
 *
 * The rule is `/api/pricing`'s (`route.ts:199-206`), so the markup and the
 * pricing cards name the same plans: every active subscription plan except
 * `free` — the absence of a subscription, not something sold — and Agency only
 * while `AGENCY_CHECKOUT_ENABLED` allows it to be bought. One-time products
 * (Lifetime, Founding, credit packs) are not stated: they are capacity-limited
 * and come and go, and a crawler's copy can outlive their availability.
 *
 * Prices are `plans.price_monthly`, the source of truth (Non-negotiable 7), as
 * on the comparison pages; `npm run check:stripe` guards drift against what
 * Stripe charges. A failed read states nothing — there is no fallback price.
 */
export async function loadCatalogueOffers(
  siteUrl: string,
): Promise<MonthlyOffer[]> {
  try {
    const catalogue = await getPlanCatalogue();
    const isAgencyOnSale = isAgencyCheckoutEnabled();

    return catalogue.subscriptions
      .filter(
        (plan) =>
          plan.id !== "free" && (isAgencyOnSale || plan.id !== "agency"),
      )
      .map((plan) => ({
        name: plan.name,
        price: plan.price,
        currency: CATALOGUE_CURRENCY,
        url: `${siteUrl}/#pricing`,
      }));
  } catch (error) {
    console.error(
      "[json-ld] could not read the plan catalogue; stating no offers:",
      error,
    );
    return [];
  }
}
