/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET } from "../route";
const authorized = jest.fn(),
  reconcile = jest.fn();
jest.mock("@/lib/security/cron-auth", () => ({
  isAuthorizedCronRequest: () => authorized(),
}));
jest.mock("@/lib/analytics/google-analytics/payment-reconciliation", () => ({
  reconcilePaymentAnalytics: () => reconcile(),
}));
beforeEach(() => {
  jest.clearAllMocks();
  authorized.mockReturnValue(true);
});
test("rejects unauthenticated traffic before billing or provider access", async () => {
  authorized.mockReturnValue(false);
  expect(
    (
      await GET(
        new NextRequest("https://example.invalid/api/cron/analytics-payments"),
      )
    ).status,
  ).toBe(401);
  expect(reconcile).not.toHaveBeenCalled();
});
test("returns only sanitized counts", async () => {
  reconcile.mockResolvedValue({ claimed: 1, unknown: 1 });
  const response = await GET(
    new NextRequest("https://example.invalid/api/cron/analytics-payments"),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ claimed: 1, unknown: 1 });
});
test("does not expose provider exception or customer data", async () => {
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  reconcile.mockRejectedValue(new Error("private-key"));
  const response = await GET(
    new NextRequest("https://example.invalid/api/cron/analytics-payments"),
  );
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("private-key");
  error.mockRestore();
});
