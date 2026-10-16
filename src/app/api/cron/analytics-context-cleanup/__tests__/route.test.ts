/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET } from "../route";
const rpc = jest.fn();
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({ rpc }),
}));
beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  rpc.mockReset();
});
it("requires credential before touching storage", async () => {
  expect(
    (
      await GET(
        new NextRequest(
          "https://example.test/api/cron/analytics-context-cleanup",
        ),
      )
    ).status,
  ).toBe(401);
  expect(rpc).not.toHaveBeenCalled();
});
it("sweeps without a dispatcher and exposes only aggregate overdue count", async () => {
  rpc.mockResolvedValue({ data: [{ deleted: 3, overdue: 2 }], error: null });
  const response = await GET(
    new NextRequest("https://example.test/api/cron/analytics-context-cleanup", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  expect(await response.json()).toEqual({
    success: true,
    deleted: 3,
    overdue: 2,
  });
  expect(rpc).toHaveBeenCalledWith("cleanup_analytics_contexts", {
    p_limit: 1000,
  });
});
