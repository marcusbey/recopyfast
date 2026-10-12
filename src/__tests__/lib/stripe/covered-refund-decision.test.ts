/**
 * s82, Devin Review round on 8744bed (comments 4244837497, 4244837575,
 * 4244837615, 4244837673, 4244837719): which invoices of an ENDED subscription
 * bought after a lifetime grant may be refunded automatically.
 *
 * `decideInvoiceRefund` is pure: lines in, a decision out. It maps each line to
 * a plan through its Stripe PRODUCT (a retired price keeps its product), reads
 * EVERY line before deciding (no early return), and refunds automatically only
 * when every billable line bills a plan the customer's grants covered. Anything
 * mixed, ambiguous or unresolvable goes to a person.
 */

import {
  decideInvoiceRefund,
  planOfProducts,
  type InvoiceLineCharge,
  type ProductPlanLookup,
} from "@/lib/stripe/covered-refund-decision";
import type { PaidPlanId } from "@/lib/stripe/plans";

/** Products as the catalogue's configured prices resolve them in Stripe. */
const PRODUCTS: Record<string, PaidPlanId[]> = {
  prod_starter: ["starter"],
  prod_pro: ["pro"],
  prod_agency: ["agency"],
  // One product configured for two plans: a misconfiguration.
  prod_shared: ["starter", "pro"],
};

const productIndex: ProductPlanLookup = {
  plansOfProduct: (productId) => PRODUCTS[productId] ?? [],
};

function line(
  productId: string | null,
  amount = 1900,
  lineId = `il_${productId}_${amount}`,
): InvoiceLineCharge {
  return { lineId, amount, productId };
}

const LIFETIME_PRO = { grantPlanIds: ["pro"] };

describe("decideInvoiceRefund", () => {
  it("refunds an invoice whose every billable line bills a covered plan", () => {
    expect(
      decideInvoiceRefund([line("prod_pro")], LIFETIME_PRO, productIndex),
    ).toEqual({ kind: "refund" });
  });

  it("refunds lower plans the grant covers too (Starter beside Lifetime Pro)", () => {
    expect(
      decideInvoiceRefund(
        [line("prod_pro"), line("prod_starter", 900)],
        LIFETIME_PRO,
        productIndex,
      ),
    ).toEqual({ kind: "refund" });
  });

  it("skips an invoice none of whose lines bills a covered plan", () => {
    expect(
      decideInvoiceRefund(
        [line("prod_agency", 4900)],
        LIFETIME_PRO,
        productIndex,
      ),
    ).toEqual({ kind: "skip", reason: "uncovered" });
  });

  it("sends a mixed invoice (Pro and Agency on one payment) to a person, never refunding it", () => {
    expect(
      decideInvoiceRefund(
        [line("prod_pro"), line("prod_agency", 4900)],
        LIFETIME_PRO,
        productIndex,
      ),
    ).toEqual({ kind: "manual", reason: "mixed" });
  });

  it("reads past a covered line: an ambiguous one after it still decides", () => {
    // Devin 4244837719: `some` stopped at the covered line.
    expect(
      decideInvoiceRefund(
        [line("prod_pro"), line("prod_shared")],
        LIFETIME_PRO,
        productIndex,
      ),
    ).toEqual({ kind: "manual", reason: "ambiguous" });
  });

  it("sends a line whose product maps to no plan to a person, after a covered line too", () => {
    expect(
      decideInvoiceRefund(
        [line("prod_pro"), line("prod_retired_elsewhere")],
        LIFETIME_PRO,
        productIndex,
      ),
    ).toEqual({ kind: "manual", reason: "unresolvable" });
  });

  it("sends a billable line with no product at all to a person", () => {
    expect(
      decideInvoiceRefund([line(null)], LIFETIME_PRO, productIndex),
    ).toEqual({ kind: "manual", reason: "unresolvable" });
  });

  it("refunds a line on a retired price of a covered product: the product decides", () => {
    // Devin 4244837615: `price_pro_v1` is no longer configured, but it is a
    // price of the Pro product, which the line carries.
    const retired: InvoiceLineCharge = {
      lineId: "il_v1",
      amount: 1900,
      productId: "prod_pro",
    };

    expect(decideInvoiceRefund([retired], LIFETIME_PRO, productIndex)).toEqual({
      kind: "refund",
    });
  });

  it("counts every grant that predates the subscription: Pro then Agency cover an Agency invoice", () => {
    // Devin 4244837673: only the earliest grant (Pro) was considered.
    expect(
      decideInvoiceRefund(
        [line("prod_agency", 4900)],
        { grantPlanIds: ["pro", "agency"] },
        productIndex,
      ),
    ).toEqual({ kind: "refund" });
    expect(
      decideInvoiceRefund(
        [line("prod_pro"), line("prod_agency", 4900)],
        { grantPlanIds: ["pro", "agency"] },
        productIndex,
      ),
    ).toEqual({ kind: "refund" });
  });

  it("ignores zero-amount and credit (negative) lines when deciding", () => {
    // A proration credit for the unused Agency time, a $0 line: neither is a
    // charge, so neither makes the Pro charge "mixed".
    expect(
      decideInvoiceRefund(
        [line("prod_pro"), line("prod_agency", -3000), line("prod_agency", 0)],
        LIFETIME_PRO,
        productIndex,
      ),
    ).toEqual({ kind: "refund" });
    // Nor does an ambiguous or unresolvable credit.
    expect(
      decideInvoiceRefund(
        [line("prod_pro"), line("prod_shared", -500), line(null, 0)],
        LIFETIME_PRO,
        productIndex,
      ),
    ).toEqual({ kind: "refund" });
  });

  it("skips an invoice that has only credit and zero lines: nothing was charged", () => {
    expect(
      decideInvoiceRefund(
        [line("prod_pro", -1900), line("prod_pro", 0)],
        LIFETIME_PRO,
        productIndex,
      ),
    ).toEqual({ kind: "skip", reason: "nothing_charged" });
    expect(decideInvoiceRefund([], LIFETIME_PRO, productIndex)).toEqual({
      kind: "skip",
      reason: "nothing_charged",
    });
  });

  it("covers nothing without a grant", () => {
    expect(
      decideInvoiceRefund(
        [line("prod_pro")],
        { grantPlanIds: [] },
        productIndex,
      ),
    ).toEqual({ kind: "skip", reason: "uncovered" });
  });

  it("names ambiguity before a missing product, and both before a mix", () => {
    expect(
      decideInvoiceRefund(
        [
          line("prod_agency", 4900),
          line(null),
          line("prod_shared"),
          line("prod_pro"),
        ],
        LIFETIME_PRO,
        productIndex,
      ),
    ).toEqual({ kind: "manual", reason: "ambiguous" });
    expect(
      decideInvoiceRefund(
        [line("prod_agency", 4900), line(null), line("prod_pro")],
        LIFETIME_PRO,
        productIndex,
      ),
    ).toEqual({ kind: "manual", reason: "unresolvable" });
  });
});

/*
 * Review of 67c6caf (minors): a grant paid after the subscription but before
 * the invoice, and an invoice paid without money (credit balance, coupon).
 */
describe("decideInvoiceRefund: review of 67c6caf", () => {
  it("sends a line covered only by a grant paid after the subscription, before the invoice, to a person", () => {
    // Uncovered when the subscription was bought (Lifetime Pro only); covered
    // by a Founding Agency paid before this invoice was: never a silent skip.
    expect(
      decideInvoiceRefund(
        [line("prod_agency", 4900)],
        { grantPlanIds: ["pro"], laterGrantPlanIds: ["agency"] },
        productIndex,
      ),
    ).toEqual({ kind: "manual", reason: "covered_later" });
    expect(
      decideInvoiceRefund(
        [line("prod_pro"), line("prod_agency", 4900)],
        { grantPlanIds: ["pro"], laterGrantPlanIds: ["agency"] },
        productIndex,
      ),
    ).toEqual({ kind: "manual", reason: "covered_later" });
  });

  it("still skips a line no grant ever covered, later grants or not", () => {
    expect(
      decideInvoiceRefund(
        [line("prod_agency", 4900)],
        { grantPlanIds: ["pro"], laterGrantPlanIds: ["starter"] },
        productIndex,
      ),
    ).toEqual({ kind: "skip", reason: "uncovered" });
  });

  it("sends a covered invoice paid without money (credit balance, 100% coupon) to a person", () => {
    expect(
      decideInvoiceRefund([line("prod_pro")], LIFETIME_PRO, productIndex, 0),
    ).toEqual({ kind: "manual", reason: "paid_by_credit" });
  });

  it("refunds a covered invoice paid with money, or not yet paid", () => {
    expect(
      decideInvoiceRefund([line("prod_pro")], LIFETIME_PRO, productIndex, 1900),
    ).toEqual({ kind: "refund" });
    expect(
      decideInvoiceRefund([line("prod_pro")], LIFETIME_PRO, productIndex, null),
    ).toEqual({ kind: "refund" });
  });

  it("never turns a skip into a manual review because nothing was paid", () => {
    expect(
      decideInvoiceRefund(
        [line("prod_agency", 4900)],
        LIFETIME_PRO,
        productIndex,
        0,
      ),
    ).toEqual({ kind: "skip", reason: "uncovered" });
  });
});

describe("planOfProducts", () => {
  it("answers the one plan a subscription's products bill", () => {
    expect(planOfProducts(["prod_pro"], productIndex)).toBe("pro");
    expect(planOfProducts(["prod_pro", "prod_pro"], productIndex)).toBe("pro");
  });

  it("answers null only when no product maps to a plan", () => {
    expect(planOfProducts(["prod_unknown"], productIndex)).toBeNull();
    expect(planOfProducts([], productIndex)).toBeNull();
  });

  it("throws on a product configured for two plans", () => {
    expect(() => planOfProducts(["prod_shared"], productIndex)).toThrow(
      /more than one plan/,
    );
  });

  it("settles two plans with the declared one, and throws otherwise", () => {
    expect(
      planOfProducts(["prod_pro", "prod_agency"], productIndex, "agency"),
    ).toBe("agency");
    expect(() =>
      planOfProducts(["prod_pro", "prod_agency"], productIndex),
    ).toThrow(/2 plans/);
  });
});
