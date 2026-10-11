import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProviderFailureEvidence,
  writeProviderFailureEvidence,
} from "../../../e2e/support/stripe-provider-failure";

describe("Stripe provider safe failure evidence", () => {
  it("retains only stage context and a bounded redacted diagnostic", () => {
    const cardNumber = "4242".repeat(4);
    const evidence = buildProviderFailureEvidence({
      runIndex: 2,
      failedStage: "checkout:inspect-open",
      error: new Error(
        `failed for s25-fixture@recopyfast.invalid cardNumber=${cardNumber} ` +
          "cardExpiry=1234 cardCvc=123 STRIPE_SECRET_KEY=sk_test_private",
      ),
    });

    expect(evidence).toEqual({
      mode: "test",
      runIndex: 2,
      failedStage: "checkout:inspect-open",
      diagnostic: expect.any(String),
    });
    expect(Object.keys(evidence).sort()).toEqual([
      "diagnostic",
      "failedStage",
      "mode",
      "runIndex",
    ]);
    expect(evidence.diagnostic.length).toBeLessThanOrEqual(800);
    expect(evidence.diagnostic).toContain("[REDACTED");
    for (const sensitive of [
      "s25-fixture@recopyfast.invalid",
      cardNumber,
      "1234",
      "cardCvc=123",
      "sk_test_private",
    ]) {
      expect(evidence.diagnostic).not.toContain(sensitive);
    }
  });

  it("writes the safe JSON file with owner-only permissions", () => {
    const outputFile = join(
      mkdtempSync(join(tmpdir(), "rcf-provider-failure-")),
      "failure.json",
    );

    writeProviderFailureEvidence(outputFile, {
      runIndex: 1,
      failedStage: "checkout:human-completion",
      error: new Error("Human Checkout completion timed out"),
    });

    expect(statSync(outputFile).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(outputFile, "utf8"))).toEqual({
      mode: "test",
      runIndex: 1,
      failedStage: "checkout:human-completion",
      diagnostic: "Human Checkout completion timed out",
    });
  });

  it("redacts provider object IDs inside the four-field diagnostic", () => {
    const providerIds = [
      "cs_test_checkout123456789",
      "cus_customer123456789",
      "sub_subscription123456789",
      "evt_event123456789",
      "price_price123456789",
      "prod_product123456789",
      "in_invoice123456789",
      "pi_paymentintent123456789",
      "pm_paymentmethod123456789",
      "ch_charge123456789",
      "seti_setupintent123456789",
      "req_request123456789",
    ];
    const evidence = buildProviderFailureEvidence({
      runIndex: 1,
      failedStage: "checkout:human-completion",
      error: new Error(`provider failure ${providerIds.join(" ")}`),
    });

    expect(Object.keys(evidence).sort()).toEqual([
      "diagnostic",
      "failedStage",
      "mode",
      "runIndex",
    ]);
    expect(evidence.diagnostic).toContain("[REDACTED STRIPE ID]");
    for (const providerId of providerIds) {
      expect(evidence.diagnostic).not.toContain(providerId);
    }
  });
});
