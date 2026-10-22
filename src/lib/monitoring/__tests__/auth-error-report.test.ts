/**
 * Signup and auth failures reach Sentry (they used to reach console.error
 * only, so a broken signup was invisible to operators) — without the
 * customer's email, which Supabase puts in some error messages.
 */

const captureException = jest.fn();

jest.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

import { reportAuthError } from "@/lib/monitoring/auth-error-report";

beforeEach(() => {
  captureException.mockClear();
});

function captured(): { error: Error; hint: { tags: Record<string, string> } } {
  expect(captureException).toHaveBeenCalledTimes(1);
  const [error, hint] = captureException.mock.calls[0];
  return { error, hint };
}

describe("reportAuthError", () => {
  it("captures one exception tagged area:auth with the failing step", () => {
    reportAuthError("verifyOtp", new Error("Token has expired"));

    const { error, hint } = captured();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("[auth] verifyOtp: Token has expired");
    expect(hint.tags).toEqual({ area: "auth", auth_step: "verifyOtp" });
  });

  it("carries Supabase's code and status as tags", () => {
    reportAuthError("exchangeCodeForSession", {
      message: "invalid flow state",
      code: "flow_state_not_found",
      status: 404,
    });

    const { error, hint } = captured();
    expect(error.message).toBe(
      "[auth] exchangeCodeForSession: invalid flow state",
    );
    expect(hint.tags).toEqual({
      area: "auth",
      auth_step: "exchangeCodeForSession",
      auth_code: "flow_state_not_found",
      auth_status: "404",
    });
  });

  it("adds caller tags, never extras", () => {
    reportAuthError(
      "verifyOtp",
      { message: "expired" },
      { otp_type: "signup" },
    );

    const { hint } = captured();
    expect(hint.tags.otp_type).toBe("signup");
    expect(Object.keys(hint)).toEqual(["tags"]);
  });

  it("redacts email addresses from the message", () => {
    reportAuthError(
      "signup magic link",
      new Error('Email address "jane.doe+x@example.com" is invalid'),
    );

    const { error } = captured();
    expect(error.message).toBe(
      '[auth] signup magic link: Email address "[email]" is invalid',
    );
    expect(error.message).not.toContain("example.com");
  });

  it("never sends the original error object (and its fields)", () => {
    const original = Object.assign(new Error("boom"), {
      email: "jane@example.com",
    });

    reportAuthError("signInWithMagicLink", original);

    const { error } = captured();
    expect(error).not.toBe(original);
    expect(JSON.stringify(captureException.mock.calls[0])).not.toContain(
      "jane@example.com",
    );
  });

  it("handles a non-error throw", () => {
    reportAuthError("signInWithMagicLink", "network down");

    expect(captured().error.message).toBe(
      "[auth] signInWithMagicLink: unknown error",
    );
  });

  it("never throws, even if Sentry does", () => {
    captureException.mockImplementationOnce(() => {
      throw new Error("sentry broke");
    });

    expect(() =>
      reportAuthError("verifyOtp", new Error("expired")),
    ).not.toThrow();
  });
});
