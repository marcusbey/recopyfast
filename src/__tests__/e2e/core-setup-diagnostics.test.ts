import { withCoreSetupDiagnostic } from "../../../e2e/support/core-setup-diagnostics";

describe("withCoreSetupDiagnostic", () => {
  it("emits one bounded actionable line, redacts fixture credentials, and rethrows", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const originalError = {
      message:
        "insert rejected for site 123e4567-e89b-12d3-a456-426614174000 " +
        "at http://127.0.0.1:4173/?rcf_token=secret-staging-token&code=424242 " +
        "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature " +
        "siteToken=123e4567-e89b-12d3-a456-426614174000.1789900000." +
        "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd " +
        "api_key=e2e_key_secret SUPABASE_SERVICE_ROLE_KEY=qa-secret " +
        "STRIPE_SECRET_KEY=sk_test_secret raw token=raw-token e2e@example.test " +
        "x".repeat(3000),
      code: "23514",
      details: "verification_code=424242 for e2e@example.test",
      hint: "Use access_type='invite' with token=another-secret",
    };

    await expect(
      withCoreSetupDiagnostic("seed staging access", async () => {
        throw originalError;
      }),
    ).rejects.toBe(originalError);

    expect(consoleError).toHaveBeenCalledTimes(1);
    const output = String(consoleError.mock.calls[0][0]);
    expect(output).toContain("[core-e2e setup] seed staging access:");
    expect(output).toContain("insert rejected");
    expect(output).toContain("code=23514");
    expect(output).toContain("hint=Use access_type='invite'");
    expect(output.length).toBeLessThanOrEqual(1600);
    expect(output).toContain("[REDACTED]");

    for (const secret of [
      "123e4567-e89b-12d3-a456-426614174000",
      "secret-staging-token",
      "424242",
      "eyJhbGciOiJIUzI1NiJ9",
      "abcdefabcdefabcdefabcdefabcdefabcdef",
      "e2e_key_secret",
      "qa-secret",
      "sk_test_secret",
      "raw-token",
      "another-secret",
      "e2e@example.test",
    ]) {
      expect(output).not.toContain(secret);
    }

    consoleError.mockRestore();
  });
});
