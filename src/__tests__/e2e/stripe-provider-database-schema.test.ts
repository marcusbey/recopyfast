import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CAPTURED_DATABASE_IDENTITIES } from "../../../e2e/support/stripe-provider-fixture";

describe("Stripe provider captured-table schema contract", () => {
  it("tracks the checkout reservation primary key declared by the applied migration", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20260813130000_checkout_reservations.sql",
      ),
      "utf8",
    );

    expect(migration).toMatch(/user_id\s+uuid\s+PRIMARY KEY/i);
    expect(migration).not.toMatch(/\bid\s+uuid\s+PRIMARY KEY/i);
    expect(CAPTURED_DATABASE_IDENTITIES.checkout_reservations).toBe("user_id");
  });
});
