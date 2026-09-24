import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendProviderCleanupFailureEvidence,
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
      failedStage: "checkout:hosted-form",
      error: new Error("postal code incomplete"),
    });

    expect(statSync(outputFile).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(outputFile, "utf8"))).toEqual({
      mode: "test",
      runIndex: 1,
      failedStage: "checkout:hosted-form",
      diagnostic: "postal code incomplete",
    });
  });

  it("preserves fixed cleanup labels beside an existing primary failure", () => {
    const outputFile = join(
      mkdtempSync(join(tmpdir(), "rcf-provider-failure-")),
      "failure.json",
    );
    writeProviderFailureEvidence(outputFile, {
      runIndex: 1,
      failedStage: "checkout:hosted-form",
      error: new Error("Test timeout of 300000ms exceeded"),
    });

    appendProviderCleanupFailureEvidence(
      outputFile,
      new Error(
        "Stripe provider fixture cleanup failed in 2 steps: " +
          "expire_checkout, delete_customer.",
      ),
    );

    const evidence = JSON.parse(readFileSync(outputFile, "utf8"));
    expect(evidence.failedStage).toBe("checkout:hosted-form");
    expect(evidence.diagnostic).toContain("Test timeout");
    expect(evidence.diagnostic).toContain(
      "cleanup: Stripe provider fixture cleanup failed in 2 steps: " +
        "expire_checkout, delete_customer.",
    );
    expect(Object.keys(evidence).sort()).toEqual([
      "diagnostic",
      "failedStage",
      "mode",
      "runIndex",
    ]);
  });
});
