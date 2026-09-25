import { getFoundingAgencyAvailability } from "@/lib/billing/founding-agency";
import { getPlanCatalogue, isAgencyCheckoutEnabled } from "@/lib/stripe/plans";

export type ComparisonPricing =
  | { status: "disabled" }
  | { status: "unavailable" }
  | {
      status: "available";
      agency: { monthlyPrice: number; websites: number };
      founding: {
        price: number;
        availability: Awaited<
          ReturnType<typeof getFoundingAgencyAvailability>
        > | null;
      } | null;
    };

/**
 * Reads `plans.price_monthly` through the database catalogue plus the founding
 * capacity aggregate. The landing page's `/api/pricing` feed starts with that
 * catalogue but overlays Stripe `unit_amount` values, because Stripe is what
 * checkout charges. The live Stripe catalogue check is therefore the guard
 * against amount drift between these comparison pages and `/#pricing`.
 *
 * The first s37 version copied September prices into editorial content, so the
 * Agency kill switch, a sold-out founding offer, or a database catalogue price
 * change could leave an indexable page advertising a sale checkout would
 * refuse. Unknown data stays visibly unknown here; there is no marketing
 * fallback price.
 */
export async function loadComparisonPricing(): Promise<ComparisonPricing> {
  if (!isAgencyCheckoutEnabled()) {
    return { status: "disabled" };
  }

  try {
    const catalogue = await getPlanCatalogue();
    const agency = catalogue.subscriptions.find((plan) => plan.id === "agency");

    if (!agency) {
      return { status: "unavailable" };
    }

    const foundingProduct = catalogue.oneTimeProducts.find(
      (product) => product.id === "lifetime_agency",
    );
    let availability: Awaited<
      ReturnType<typeof getFoundingAgencyAvailability>
    > | null = null;

    if (foundingProduct) {
      try {
        availability = await getFoundingAgencyAvailability();
      } catch (error) {
        console.error(
          "Failed to read Founding Agency availability for comparison pages:",
          error,
        );
      }
    }

    return {
      status: "available",
      agency: {
        monthlyPrice: agency.price,
        websites: agency.limits.websites,
      },
      founding: foundingProduct
        ? { price: foundingProduct.price, availability }
        : null,
    };
  } catch (error) {
    console.error("Failed to read Agency pricing for comparison pages:", error);
    return { status: "unavailable" };
  }
}
