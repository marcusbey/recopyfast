/** @jest-environment node */
import { dispatchAnalytics } from "../delivery";
const rpc = jest.fn(),
  send = jest.fn();
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({ rpc }),
}));
jest.mock("../measurement-protocol", () => ({
  sendSignupMeasurement: (...a: unknown[]) => send(...a),
}));
beforeEach(() => {
  jest.clearAllMocks();
  process.env.GA4_MP_ENABLED = "1";
  process.env.VERCEL_ENV = "production";
  process.env.GA4_MP_MEASUREMENT_ID = "G-DQ00NEM3WE";
  process.env.GA4_MP_API_SECRET = "dummy";
  rpc.mockImplementation((name: string) => ({
    abortSignal: async () =>
      name === "claim_analytics_delivery"
        ? { data: [], error: null }
        : { data: [{ changed: 0 }], error: null },
  }));
});
test("disabled dispatch never claims or consumes pending events", async () => {
  process.env.GA4_MP_ENABLED = "0";
  expect(await dispatchAnalytics()).toMatchObject({
    disabled: true,
    claimed: 0,
  });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("reconcile_analytics_delivery", {
    p_limit: 100,
  });
});
test("missing secret never claims", async () => {
  delete process.env.GA4_MP_API_SECRET;
  await dispatchAnalytics();
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("reconcile_analytics_delivery", {
    p_limit: 100,
  });
});
test("reconciles only durable candidates, sends a bounded claimed event once and records HTTP acceptance", async () => {
  let claimed = false;
  rpc.mockImplementation((name: string) => ({
    abortSignal: async () => ({
      data:
        name === "claim_analytics_delivery"
          ? claimed
            ? []
            : ((claimed = true),
              [
                {
                  id: "id",
                  claim_token: "token",
                  client_id: "123.456",
                  occurred_at: "2026-10-12T12:00:00Z",
                },
              ])
          : true,
      error: null,
    }),
  }));
  send.mockResolvedValue({ state: "accepted_http", code: "http_2xx" });
  expect(await dispatchAnalytics()).toMatchObject({
    claimed: 1,
    accepted_http: 1,
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("finalize_analytics_delivery", {
    p_id: "id",
    p_token: "token",
    p_state: "accepted_http",
    p_code: "http_2xx",
  });
});
test("lost finalization acknowledgement never retries the Google request", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  let claimed = false;
  rpc.mockImplementation((name: string) => ({
    abortSignal: async () => ({
      data:
        name === "claim_analytics_delivery"
          ? claimed
            ? []
            : ((claimed = true),
              [
                {
                  id: "id",
                  claim_token: "token",
                  client_id: "123.456",
                  occurred_at: "2026-10-12T12:00:00Z",
                },
              ])
          : null,
      error:
        name === "finalize_analytics_delivery" ? new Error("private") : null,
    }),
  }));
  send.mockResolvedValue({ state: "accepted_http", code: "http_2xx" });
  expect(await dispatchAnalytics()).toMatchObject({
    claimed: 1,
    finalize_failed: 1,
  });
  expect(send).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});
