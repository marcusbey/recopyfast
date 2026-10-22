/**
 * `logAuthError` is what the signup and login forms call when Supabase
 * refuses them. It must reach Sentry, not only the browser console.
 */

jest.mock("@/lib/monitoring/auth-error-report", () => ({
  reportAuthError: jest.fn(),
}));

import { logAuthError } from "@/components/auth/auth-errors";
import { reportAuthError } from "@/lib/monitoring/auth-error-report";

describe("logAuthError", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports the failure to Sentry and still logs it", () => {
    const error = new Error("Signups not allowed");

    logAuthError("signup magic link", error);

    expect(reportAuthError).toHaveBeenCalledWith("signup magic link", error);
    expect(console.error).toHaveBeenCalledWith(
      "[auth] signup magic link",
      error,
    );
  });
});
