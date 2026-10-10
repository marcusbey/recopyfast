/**
 * Migration 20260928130000 — s50, the plans catalogue says only what the
 * product does (operator decision 2026-09-28).
 *
 * The pricing cards, the billing screens and the Stripe products all render
 * `plans.description` and `plans.features`, and those rows advertised A/B
 * testing, translations, "copy testing", a version history split by plan, a
 * community, priority support, an onboarding call and every future Pro
 * feature. None of it had a customer surface or a channel behind it.
 *
 * Read from the migration text for the same reason as the seed tests in
 * plan-seed.test.ts: the copy is a commitment that lives in the row and
 * nowhere in the code, and every way of getting this wrong — a price or a
 * limit touched, a row inserted, the Founding Agency row rewritten — is
 * visible in the SQL.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260928130000_catalogue_copy_truth.sql",
);

/** Statements only: the header's prose must not satisfy or trip anything. */
const statements = () => readFileSync(MIGRATION, "utf8").replace(/--.*$/gm, "");

const updates = () => [
  ...statements().matchAll(
    /UPDATE public\.plans\s+SET([\s\S]*?)WHERE id = '(\w+)';/g,
  ),
];

/** The SET clause of the one UPDATE that targets `id`. */
function setClause(id: string): string {
  const matches = updates().filter((match) => match[2] === id);
  expect(matches).toHaveLength(1);
  return matches[0][1];
}

/** The description `id` is set to, or undefined when the row's is not written. */
function descriptionOf(id: string): string | undefined {
  return setClause(id).match(/\bdescription = '([^']*)'/)?.[1];
}

/** The bullets `id` is set to, or undefined when the row's are not written. */
function featuresOf(id: string): string[] | undefined {
  const match = setClause(id).match(/\bfeatures = '([^']*)'::jsonb/);
  return match ? (JSON.parse(match[1]) as string[]) : undefined;
}

const EXPECTED: Record<string, { description?: string; features?: string[] }> =
  {
    starter: {
      description: "1 website, click-to-edit, draft and publish",
      features: [
        "1 website",
        "Draft, then publish",
        "Click-to-edit interface",
        "Version snapshots and restore",
        "Email support",
      ],
    },
    pro: {
      // The description ("Up to 5 websites, all features, +$5 per additional
      // website") is true once the bullets are, so it is not written.
      features: [
        "Up to 5 websites",
        "+$5 per additional website",
        "Draft, then publish",
        "Click-to-edit interface",
        "Version snapshots and restore",
        "Email support",
        "AI rewrite suggestions, 500 credits a month",
      ],
    },
    agency: {
      description:
        "10 client websites, unlimited invited editors, email support",
      features: [
        "10 client websites",
        "+$4 per additional website",
        "Unlimited invited editors",
        "Everything in Pro",
        "1,000 AI credits / month",
        "Email support",
      ],
    },
    credits: {
      // "Works on any plan" and "never expire" stay: both are true.
      description: "1,000 AI credits for AI rewrite suggestions",
    },
    lifetime_pro: {
      description:
        "Pay once, keep every Pro feature forever — 5 websites and AI features. No recurring billing.",
      features: ["Everything in Pro", "One payment, no renewal"],
    },
  };

describe("catalogue copy truth migration", () => {
  it("updates starter, pro, agency, credits and lifetime_pro, and nothing else", () => {
    const sql = statements();

    expect(sql.match(/\bUPDATE\b/gi)).toHaveLength(5);
    expect(
      updates()
        .map((match) => match[2])
        .sort(),
    ).toEqual(["agency", "credits", "lifetime_pro", "pro", "starter"]);
    expect(sql).not.toMatch(/\b(INSERT|DELETE|ALTER)\b/i);
    expect(sql).not.toMatch(/\bFUNCTION\b/i);
    // Free has no copy to fix, and the Founding Agency row was rewritten by
    // s45 with copy that is already true.
    expect(sql).not.toContain("'free'");
    expect(sql).not.toContain("'lifetime_agency'");
  });

  it("sets each row's copy exactly", () => {
    for (const [id, copy] of Object.entries(EXPECTED)) {
      expect(descriptionOf(id)).toEqual(copy.description);
      expect(featuresOf(id)).toEqual(copy.features);
      expect(setClause(id)).toMatch(/\bupdated_at = NOW\(\)/);
    }
  });

  it("says Email support on every subscription plan", () => {
    for (const id of ["starter", "pro", "agency"]) {
      expect(featuresOf(id)).toContain("Email support");
    }

    const everyValue = Object.keys(EXPECTED).flatMap((id) => [
      descriptionOf(id) ?? "",
      ...(featuresOf(id) ?? []),
    ]);
    for (const value of everyValue) {
      expect(value).not.toMatch(/priority|onboarding|community support/i);
    }
  });

  it("drops the future-features promise from Lifetime Pro", () => {
    const features = featuresOf("lifetime_pro") ?? [];
    const description = descriptionOf("lifetime_pro") ?? "";

    expect(features.length).toBeGreaterThan(0);
    expect(features.filter((bullet) => /future/i.test(bullet))).toEqual([]);
    expect(description).not.toMatch(/future/i);
    // "Forever" stays: it means the features Pro has today.
    expect(description).toContain("every Pro feature forever");
  });

  it("never touches price, limits, grant, listing, Stripe ids, name or kind", () => {
    expect(statements()).not.toMatch(
      /\b(price_monthly|price_yearly_\w+|grants_plan_id|is_active|sort_order|stripe_\w+|name|kind|limits)\s*=/,
    );
  });

  it("leaves the applied seeds as they were", () => {
    // Forward-only: 20260802000000 is applied in production, so the change has
    // to arrive in a new file rather than by editing that one.
    const seed = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260802000000_plans_catalog.sql",
      ),
      "utf8",
    );
    const start = seed.indexOf("'pro', 'subscription'");
    const row = seed.slice(start, seed.indexOf("\n  )", start));

    expect(row).toContain('"Priority support"');
  });
});
