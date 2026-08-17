/**
 * GET /auth/callback — the PKCE code exchange, and where the trial starts.
 *
 * There is no signup route in this product: sign-up is passwordless
 * `signInWithOtp`, so the first time the server ever sees a new account is this
 * route or its cross-device sibling `/auth/confirm`. Both fire on every
 * sign-in, which is why the grant behind `ensureTrialStarted` is idempotent
 * rather than one-shot.
 *
 * The rule these tests exist to hold: handing out a free trial must never be
 * able to break signing in. The redirect is the product; the trial is a bonus
 * on top of it.
 */

const mockGetUser = jest.fn();
const mockExchangeCodeForSession = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: {
        exchangeCodeForSession: mockExchangeCodeForSession,
        getUser: mockGetUser,
      },
    }),
  ),
}));

jest.mock("@/lib/billing/trial", () => ({
  ensureTrialStarted: jest.fn(),
}));

import { GET } from "@/app/auth/callback/route";
import { ensureTrialStarted } from "@/lib/billing/trial";

const asMock = (fn: unknown) => fn as jest.Mock;

const ORIGIN = "https://recopyfast.test";

function request(url: string): Request {
  return new Request(url, { headers: { host: "recopyfast.test" } });
}

/**
 * Where a redirect actually points, as a path.
 *
 * The origin is resolved separately (see ../public-origin) and depends on
 * environment this story does not touch; the destination is what these tests
 * are about.
 */
function destination(response: Response): string {
  const location = response.headers.get("location");
  return location === null ? "" : new URL(location).pathname;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockExchangeCodeForSession.mockResolvedValue({ error: null });
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
  asMock(ensureTrialStarted).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /auth/callback", () => {
  it("starts a trial for the account that just signed in", async () => {
    const response = await GET(request(`${ORIGIN}/auth/callback?code=abc`));

    expect(ensureTrialStarted).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
    );
    expect(response.status).toBe(307);
    expect(destination(response)).toBe("/dashboard");
  });

  it("does not change where the user lands", async () => {
    const response = await GET(
      request(`${ORIGIN}/auth/callback?code=abc&next=%2Fdashboard%2Fbilling`),
    );

    expect(destination(response)).toBe("/dashboard/billing");
  });

  it("signs the user in anyway when the trial grant throws", async () => {
    asMock(ensureTrialStarted).mockRejectedValue(new Error("supabase down"));

    const response = await GET(request(`${ORIGIN}/auth/callback?code=abc`));

    expect(destination(response)).toBe("/dashboard");
  });

  it("attempts nothing when the code exchange failed", async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      error: { message: "expired" },
    });

    const response = await GET(request(`${ORIGIN}/auth/callback?code=abc`));

    expect(ensureTrialStarted).not.toHaveBeenCalled();
    expect(destination(response)).toBe("/auth/error");
  });

  it("attempts nothing when there is no code at all", async () => {
    const response = await GET(request(`${ORIGIN}/auth/callback`));

    expect(ensureTrialStarted).not.toHaveBeenCalled();
    expect(destination(response)).toBe("/auth/error");
  });

  it("still redirects when the established user cannot be read back", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(request(`${ORIGIN}/auth/callback?code=abc`));

    expect(ensureTrialStarted).not.toHaveBeenCalled();
    expect(destination(response)).toBe("/dashboard");
  });
});
