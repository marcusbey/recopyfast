import type { PaidPlanId } from "./plans";
import { isPlanCoveredByGrants } from "./plan-types";

/**
 * s82, Devin Review round on 8744bed (comments 4244837497, 4244837575,
 * 4244837615, 4244837673, 4244837719): which invoices of an ENDED subscription
 * bought after a lifetime grant may be refunded automatically, decided without
 * I/O so both the refusal and the late-settlement path apply one rule.
 *
 * Lines map to plans by Stripe PRODUCT, not price: a retired price keeps its
 * product (4244837615). Every line is read before deciding, no early return
 * (4244837719). The coverage is every live grant the customer had paid for
 * when the subscription was bought, not only the earliest (4244837673). An
 * invoice is refunded in full only when every charge on it bills a covered
 * plan (4244837575); anything mixed, ambiguous or unresolvable goes to a
 * person, never to an automatic refund.
 */

/** One invoice line, reduced to what the decision reads. */
export interface InvoiceLineCharge {
  readonly lineId: string;
  /**
   * In the smallest currency unit. Zero and negative lines (a $0 line, a
   * proration credit) are not charges and never decide anything.
   */
  readonly amount: number;
  /** The Stripe product the line bills; null when it names none. */
  readonly productId: string | null;
}

/** Which paid plans a Stripe product's configured prices belong to. */
export interface ProductPlanLookup {
  /** None when no plan sells it; several is a misconfiguration. */
  plansOfProduct(productId: string): readonly PaidPlanId[];
}

/** The plans the customer's grants covered when the subscription was bought. */
export interface InvoiceCoverage {
  /** The plan of every live, undated grant paid at or before that moment. */
  readonly grantPlanIds: readonly string[];
}

/** Why an invoice needs a person rather than an automatic refund. */
export type ManualReviewReason = "mixed" | "ambiguous" | "unresolvable";

export type InvoiceRefundDecision =
  /** Every charge bills a covered plan: refund the invoice's payments in full. */
  | { kind: "refund" }
  /** No charge bills a covered plan (or nothing was charged): leave it. */
  | { kind: "skip" }
  /** Covered and uncovered charges, or one whose plan cannot be told. */
  | { kind: "manual"; reason: ManualReviewReason };

/**
 * Decide one invoice from all of its lines.
 *
 * A charge whose product no plan sells is unresolvable, not "uncovered": an
 * old price moved to a new product must reach a person, never be skipped
 * silently. A product configured for two plans is ambiguous.
 */
export function decideInvoiceRefund(
  lines: readonly InvoiceLineCharge[],
  coverage: InvoiceCoverage,
  productIndex: ProductPlanLookup,
): InvoiceRefundDecision {
  let covered = 0;
  let uncovered = 0;
  let ambiguous = 0;
  let unresolvable = 0;

  for (const line of lines) {
    if (line.amount <= 0) continue;
    if (!line.productId) {
      unresolvable += 1;
      continue;
    }
    const plans = productIndex.plansOfProduct(line.productId);
    if (plans.length > 1) {
      ambiguous += 1;
    } else if (plans.length === 0) {
      unresolvable += 1;
    } else if (isPlanCoveredByGrants(plans[0], coverage.grantPlanIds)) {
      covered += 1;
    } else {
      uncovered += 1;
    }
  }

  if (ambiguous > 0) return { kind: "manual", reason: "ambiguous" };
  if (unresolvable > 0) return { kind: "manual", reason: "unresolvable" };
  if (covered === 0) return { kind: "skip" };
  if (uncovered > 0) return { kind: "manual", reason: "mixed" };
  return { kind: "refund" };
}

/**
 * The one paid plan a subscription's products bill: null only when no product
 * maps to a plan of a catalogue that loaded (s82 review, N1), so a skip is
 * never decided on a read failure. Throws when it cannot be decided: a product
 * configured for two plans, or products of two plans that `declared` (its
 * `metadata.plan_id`) does not settle.
 */
export function planOfProducts(
  productIds: readonly string[],
  productIndex: ProductPlanLookup,
  declared?: string,
): PaidPlanId | null {
  const claimants = productIds.map((productId) =>
    productIndex.plansOfProduct(productId),
  );
  const ambiguous = productIds.filter(
    (_, index) => claimants[index].length > 1,
  );
  if (ambiguous.length > 0) {
    throw new Error(
      `product(s) [${ambiguous.join(", ")}] are configured for more than ` +
        `one plan`,
    );
  }

  const plans = [...new Set(claimants.flat())];
  if (plans.length === 0) return null;
  if (plans.length === 1) return plans[0];
  const settled = plans.find((plan) => plan === declared);
  if (settled) return settled;
  throw new Error(
    `products [${productIds.join(", ")}] bill ${plans.length} plans ` +
      `(${plans.join(", ")})`,
  );
}
