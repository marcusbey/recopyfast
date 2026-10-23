/**
 * DataFast at session establishment (ADR 074): /auth/callback and /auth/confirm
 * read the visitor cookie, hand the trial outcome to `recordDataFastSession`
 * in `after()`, and never let any of it touch the redirect.
 */

const mockGetUser = jest.fn();
const mockVerifyOtp = jest.fn();
const mockExchange = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: {
        verifyOtp: mockVerifyOtp,
        exchangeCodeForSession: mockExchange,
        getUser: mockGetUser,
      },
    }),
  ),
}));
jest.mock("@/lib/billing/trial", () => ({ ensureTrialStarted: jest.fn() }));
jest.mock("@/lib/monitoring/auth-error-report", () => ({
  reportAuthError: jest.fn(),
}));
jest.mock("@/lib/analytics/google-analytics/conversions", () => ({
  freezeVerifiedSignup: jest.fn().mockResolvedValue({ state: "pending" }),
}));
jest.mock("@/lib/analytics/google-analytics/context-server", () => ({
  bindAnalyticsContext: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/analytics/datafast-server", () => ({
  recordDataFastSession: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/app/auth/public-origin", () => ({
  resolvePublicOrigin: () => "https://recopyfast.test",
}));

import { after, type NextRequest } from "next/server";
import { GET as callback } from "@/app/auth/callback/route";
import { GET as confirm } from "@/app/auth/confirm/route";
import { ensureTrialStarted } from "@/lib/billing/trial";
import { recordDataFastSession } from "@/lib/analytics/datafast-server";

const ORIGIN = "https://recopyfast.test";
const VISITOR = "a3ab2331-989f-4cfa-91c6-2461c9e3c6bd";
const asMock = (fn: unknown) => fn as jest.Mock;

function request(url: string, cookie?: string): NextRequest {
  return new Request(url, {
    headers: { host: "recopyfast.test", ...(cookie ? { cookie } : {}) },
  }) as unknown as NextRequest;
}

async function runDeferred() {
  for (const [task] of asMock(after).mock.calls) await task();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockExchange.mockResolvedValue({ error: null });
  mockVerifyOtp.mockResolvedValue({ error: null });
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
  asMock(ensureTrialStarted).mockResolvedValue("standard");
  asMock(recordDataFastSession).mockResolvedValue(undefined);
  asMock(after).mockReset();
});

afterEach(() => jest.restoreAllMocks());

describe.each([
  ["/auth/callback", () => callback, `${ORIGIN}/auth/callback?code=abc`],
  [
    "/auth/confirm",
    () => confirm,
    `${ORIGIN}/auth/confirm?token_hash=h&type=magiclink`,
  ],
])("%s", (_name, handler, url) => {
  it("hands the visitor and the trial it started to DataFast, after the redirect", async () => {
    const response = await handler()(
      request(url, `datafast_visitor_id=${VISITOR}`),
    );
    expect(new URL(response.headers.get("location")!).pathname).toBe(
      "/dashboard",
    );
    expect(recordDataFastSession).not.toHaveBeenCalled();

    await runDeferred();
    expect(recordDataFastSession).toHaveBeenCalledWith({
      userId: "user-1",
      visitorId: VISITOR,
      trial: "standard",
    });
  });

  it("schedules nothing without a valid visitor cookie", async () => {
    await handler()(request(url, "datafast_visitor_id=a@b.c"));
    await handler()(request(url));
    expect(after).not.toHaveBeenCalled();
  });

  it("still redirects when DataFast throws", async () => {
    asMock(recordDataFastSession).mockRejectedValue(new Error("boom"));
    asMock(after).mockImplementation(() => {
      throw new Error("after outside request scope");
    });
    const response = await handler()(
      request(url, `datafast_visitor_id=${VISITOR}`),
    );
    expect(new URL(response.headers.get("location")!).pathname).toBe(
      "/dashboard",
    );
  });
});

it("/auth/callback without a code refreshes the visitor but starts no trial goal", async () => {
  await callback(
    request(`${ORIGIN}/auth/callback`, `datafast_visitor_id=${VISITOR}`),
  );
  await runDeferred();
  expect(ensureTrialStarted).not.toHaveBeenCalled();
  expect(recordDataFastSession).toHaveBeenCalledWith({
    userId: "user-1",
    visitorId: VISITOR,
    trial: null,
  });
});
