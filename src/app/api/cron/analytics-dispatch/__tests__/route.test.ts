/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET } from "../route";
const dispatch = jest.fn();
jest.mock("@/lib/analytics/google-analytics/delivery", () => ({
  dispatchAnalytics: () => dispatch(),
}));
beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = "dummy";
  dispatch.mockResolvedValue({ disabled: false, claimed: 1, accepted_http: 1 });
});
test.each([undefined, "Bearer ", "Bearer wrong"])(
  "unauthorized cron cannot drive sending %p",
  async (authorization) => {
    const result = await GET(
      new NextRequest("https://www.recopyfa.st/api/cron/analytics-dispatch", {
        headers: authorization ? { authorization } : {},
      }),
    );
    expect(result.status).toBe(401);
    expect(dispatch).not.toHaveBeenCalled();
  },
);
test("authorized cron ignores arbitrary event query parameters", async () => {
  const result = await GET(
    new NextRequest(
      "https://www.recopyfa.st/api/cron/analytics-dispatch?event=purchase",
      { headers: { authorization: "Bearer dummy" } },
    ),
  );
  expect(result.status).toBe(200);
  expect(dispatch).toHaveBeenCalledWith();
});
test("failure is sanitized", async () => {
  dispatch.mockRejectedValue(new Error("sensitive internal source"));
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  const result = await GET(
    new NextRequest("https://www.recopyfa.st/api/cron/analytics-dispatch", {
      headers: { authorization: "Bearer dummy" },
    }),
  );
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({
    error: "Analytics dispatch unavailable",
  });
  expect(spy).toHaveBeenCalledWith("[analytics/delivery] dispatch unavailable");
  spy.mockRestore();
});
