"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import {
  findOneTimeProduct,
  type OneTimeProduct,
  type PlanCatalogue,
} from "@/lib/stripe/plan-types";
import { useCheckout } from "./useCheckout";

/**
 * Lifetime Pro — the one-time purchase that grants a plan permanently.
 *
 * Name, price, description and feature bullets all come from the `plans` table
 * by way of the catalogue the dashboard already ships to the client. Nothing
 * about the product is written here: the landing page advertising "$199" and a
 * billing page charging something else is exactly the drift the catalogue
 * exists to prevent.
 */

/**
 * Whether a permanent (never-renewing) plan grant is already in force.
 *
 * Resolved server-side in src/app/dashboard/billing/page.tsx, because
 * `plan_entitlements` is the only place the answer lives and nothing the client
 * already holds can distinguish "Pro by lifetime grant" from "Pro by monthly
 * subscription" — `effectivePlanId` reads `pro` for both.
 *
 * `unknown` is a real third state, not a stand-in for `none`. A read that
 * failed must hide the offer rather than show it: a missing upsell costs us a
 * sale we can still make tomorrow, whereas selling someone a second $199 grant
 * for something they already own costs a refund and their trust.
 */
export type LifetimeGrantStatus =
  | { kind: "none" }
  | { kind: "granted"; planIds: readonly string[] }
  | { kind: "unknown" };

/**
 * The lifetime product to offer this account, or `null` when it must not be
 * offered at all.
 *
 * Resolved in one place so the dashboard card and the plan dialog cannot end up
 * disagreeing about who is allowed to see it.
 *
 * A grant of some *other* plan is not a reason to withhold the offer — a
 * support-issued Starter grant is not the Pro this buys. Only a grant of the
 * very plan the product confers means the customer already owns it.
 */
export function resolveLifetimeOffer(
  catalogue: PlanCatalogue,
  grant: LifetimeGrantStatus,
): OneTimeProduct | null {
  if (grant.kind === "unknown") {
    return null;
  }

  const product = findOneTimeProduct(catalogue, "lifetime_pro");

  // No active row, or a row that grants nothing: there is no permanent plan to
  // sell. `createCheckoutSession` throws on the same condition rather than
  // taking money for an empty promise, so refusing to draw the button keeps the
  // UI and the server telling the same story.
  if (!product?.grantsPlanId) {
    return null;
  }

  // Membership, not equality: an account can hold several live grants, and
  // holding the one this product confers is what disqualifies the offer —
  // regardless of which was granted most recently.
  if (
    grant.kind === "granted" &&
    grant.planIds.includes(product.grantsPlanId)
  ) {
    return null;
  }

  return product;
}

interface LifetimeOfferCardProps {
  /** Resolved by `resolveLifetimeOffer`; the card never decides for itself. */
  product: OneTimeProduct;
  /**
   * A recurring subscription is live and will keep charging after this
   * purchase. Buying lifetime does not cancel it — Stripe has no idea the two
   * are related — so the card has to say so.
   */
  hasLiveSubscription: boolean;
}

export function LifetimeOfferCard({
  product,
  hasLiveSubscription,
}: LifetimeOfferCardProps) {
  const { startCheckout, isRedirecting, error } = useCheckout();

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-xl font-semibold">{product.name}</h3>
        <p className="text-muted-foreground mt-1">{product.description}</p>
      </div>

      {error && (
        <Alert className="mb-4 border-tone-danger-border bg-tone-danger-surface">
          <p className="text-tone-danger-text">{error}</p>
        </Alert>
      )}

      <div className="space-y-4">
        <div className="rounded-lg bg-tone-accent-surface p-4 text-center">
          <div className="text-3xl font-semibold text-primary tabular">
            ${product.price}
          </div>
          <div className="text-sm text-muted-foreground">
            Charged once. No renewal, no recurring billing.
          </div>
        </div>

        <ul className="space-y-2">
          {product.features.map((feature) => (
            <li key={feature} className="flex items-center text-sm">
              <svg
                className="w-4 h-4 text-tone-success-text mr-2 shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              {feature}
            </li>
          ))}
        </ul>

        {hasLiveSubscription && (
          <Alert className="border-tone-warning-border bg-tone-warning-surface">
            <p className="text-tone-warning-text">
              This does not cancel your current subscription. Cancel it yourself
              once the purchase lands, or you will keep paying every month for a
              plan you already own.
            </p>
          </Alert>
        )}

        <Button
          onClick={() => startCheckout({ intent: "lifetime" })}
          disabled={isRedirecting}
          className="w-full"
        >
          {isRedirecting
            ? "Redirecting to Stripe…"
            : `Buy once — $${product.price}`}
        </Button>

        <p className="text-xs text-muted-foreground">
          Payment is completed on Stripe&apos;s secure checkout page.
        </p>
      </div>
    </Card>
  );
}
