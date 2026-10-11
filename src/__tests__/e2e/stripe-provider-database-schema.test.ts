import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AUTH_CASCADE_DATABASE_TABLES,
  CAPTURED_DATABASE_IDENTITIES,
} from "../../../e2e/support/stripe-provider-fixture";

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

  it("tracks checkout intents through their owned Auth cascade without relying on a direct service-role delete", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20260924020000_checkout_pending_intents.sql",
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /user_id\s+uuid\s+NOT NULL\s+REFERENCES auth\.users \(id\) ON DELETE CASCADE/i,
    );
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON TABLE public\.checkout_pending_intents TO service_role/i,
    );
    expect(CAPTURED_DATABASE_IDENTITIES.checkout_pending_intents).toBe("id");
    expect(AUTH_CASCADE_DATABASE_TABLES).toContain("checkout_pending_intents");
  });
});
