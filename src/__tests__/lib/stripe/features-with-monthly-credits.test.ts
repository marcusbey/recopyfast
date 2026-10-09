/**
 * s82 (s45 review #2): which plan bullet states the monthly AI-credit
 * allowance, found from the plan's own `limits.monthlyCredits` rather than
 * from one spelling of the sentence.
 *
 * The card looked for the exact phrase "<n> AI credits". Agency's bullet
 * matched; Pro's live one — "AI rewrite suggestions, 500 credits a month"
 * (20260928130000_catalogue_copy_truth.sql) — never did, so a founding-offer
 * holder metered at 100 read 500, and any rewording of Agency's would have
 * brought "1,000" back for a 250 owner.
 */

import {
  featuresWithMonthlyCredits,
  type SubscriptionPlan,
} from "@/lib/stripe/plan-types";

function planWith(
  features: readonly string[],
  monthlyCredits: number,
): Pick<SubscriptionPlan, "features" | "limits"> {
  return {
    features,
    limits: {
      websites: 10,
      collaborators: -1,
      aiFeatures: true,
      translations: -1,
      abTesting: true,
      monthlyCredits,
    },
  };
}

/** Agency's bullets as 20260928130000 writes them. */
const AGENCY_FEATURES = [
  "10 client websites",
  "+$4 per additional website",
  "Unlimited invited editors",
  "Everything in Pro",
  "1,000 AI credits / month",
  "Email support",
];

/** Pro's bullets as 20260928130000 writes them. */
const PRO_FEATURES = [
  "Up to 5 websites",
  "+$5 per additional website",
  "Draft, then publish",
  "Click-to-edit interface",
  "Version snapshots and restore",
  "Email support",
  "AI rewrite suggestions, 500 credits a month",
];

describe("featuresWithMonthlyCredits", () => {
  it("restates Agency's bullet for a Founding Agency owner", () => {
    expect(
      featuresWithMonthlyCredits(planWith(AGENCY_FEATURES, 1000), 250),
    ).toEqual([
      "10 client websites",
      "+$4 per additional website",
      "Unlimited invited editors",
      "Everything in Pro",
      "250 AI credits / month",
      "Email support",
    ]);
  });

  it("restates Pro's real bullet, which the exact-phrase match never found", () => {
    const features = featuresWithMonthlyCredits(
      planWith(PRO_FEATURES, 500),
      100,
    );

    expect(features).toContain("AI rewrite suggestions, 100 credits a month");
    expect(features.join(" | ")).not.toMatch(/\b500\b/);
    expect(features).toHaveLength(PRO_FEATURES.length);
  });

  it("restates a reworded bullet that keeps the plan's number", () => {
    expect(
      featuresWithMonthlyCredits(
        planWith(["1000 AI credits every month", "Email support"], 1000),
        250,
      ),
    ).toEqual(["250 AI credits every month", "Email support"]);
  });

  it("writes the resolved number the catalogue's way", () => {
    expect(
      featuresWithMonthlyCredits(
        planWith(["500 AI credits / month"], 500),
        1500,
      ),
    ).toEqual(["1,500 AI credits / month"]);
  });

  it("leaves numbers that are not the allowance alone", () => {
    const features = [
      "10 client websites",
      "+$4 per additional website",
      // Mentions credits, but its number is not the plan's allowance.
      "Credit packs from $19",
    ];

    expect(featuresWithMonthlyCredits(planWith(features, 1000), 250)).toEqual(
      features,
    );
  });

  it("drops the allowance bullet when no resolved allowance is known", () => {
    expect(
      featuresWithMonthlyCredits(planWith(AGENCY_FEATURES, 1000), null),
    ).toEqual(AGENCY_FEATURES.filter((f) => f !== "1,000 AI credits / month"));
  });

  it("drops only the allowance bullet, never another one about credits", () => {
    expect(
      featuresWithMonthlyCredits(
        planWith(["1,000 AI credits / month", "Credit packs from $19"], 1000),
        null,
      ),
    ).toEqual(["Credit packs from $19"]);
  });

  it("returns the catalogue's list untouched when the numbers agree", () => {
    const plan = planWith(PRO_FEATURES, 500);

    expect(featuresWithMonthlyCredits(plan, 500)).toBe(plan.features);
  });
});
