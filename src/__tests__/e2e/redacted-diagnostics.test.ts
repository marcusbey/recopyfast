import { redactDiagnostic } from "../../../e2e/support/redacted-diagnostics";

describe("redactDiagnostic payment-data handling", () => {
  it("removes card-shaped form values from provider failures", () => {
    const compactCard = "4242".repeat(4);
    const spacedCard = Array.from({ length: 4 }, () => "4242").join(" ");
    const output = redactDiagnostic(
      `Checkout failed cardNumber=${compactCard} Card number ${spacedCard} ` +
        "expiry=12/34 cardExpiry=1234 cvc=123",
    );

    expect(output).toContain("[REDACTED CARD]");
    expect(output).not.toContain(compactCard);
    expect(output).not.toContain(spacedCard);
    expect(output).not.toContain("12/34");
    expect(output).not.toContain("cardExpiry=1234");
    expect(output).not.toContain("cvc=123");
  });

  it("removes Checkout URLs, fragments, and Session secret shapes", () => {
    const output = redactDiagnostic(
      "failed at https://checkout.stripe.com/c/pay/cs_test_session_secret_token#fidkdWxOYHwnPyd1blpxYHZxWjA0TzJ8 " +
        "session=cs_test_session_secret_token",
    );

    expect(output).not.toContain("checkout.stripe.com");
    expect(output).not.toContain("cs_test_session_secret_token");
    expect(output).toContain("[REDACTED");
  });
});
