import { redactDiagnostic } from "../../../e2e/support/redacted-diagnostics";

describe("redactDiagnostic payment-data handling", () => {
  it("redacts every Stripe object ID family the provider lane can surface", () => {
    const providerIds = [
      "cs_test_checkout123456789",
      "cs_live_checkout987654321",
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
    const output = redactDiagnostic(
      providerIds.map((id) => `provider_id=${id}`).join(" "),
    );

    expect(output).toContain("[REDACTED STRIPE ID]");
    for (const providerId of providerIds) {
      expect(output).not.toContain(providerId);
    }
  });

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
