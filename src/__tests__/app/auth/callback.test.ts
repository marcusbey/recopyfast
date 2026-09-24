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

jest.mock("@/app/auth/public-origin", () => ({
  resolvePublicOrigin: () => "https://recopyfast.test",
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

function location(response: Response): string {
  return response.headers.get("location") ?? "";
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
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(destination(response)).toBe("/auth/error");
  });

  it("attempts nothing when there is no code at all", async () => {
    // The shared fixture is authenticated by default. This case specifically
    // proves that an absent code and an absent established session still fail.
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(request(`${ORIGIN}/auth/callback`));

    expect(ensureTrialStarted).not.toHaveBeenCalled();
    expect(destination(response)).toBe("/auth/error");
  });

  it("continues an already-established magic-link session without a PKCE code", async () => {
    const response = await GET(request(`${ORIGIN}/auth/callback`));

    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(ensureTrialStarted).not.toHaveBeenCalled();
    expect(destination(response)).toBe("/dashboard");
  });

  it("preserves next for an already-established magic-link session", async () => {
    const response = await GET(
      request(`${ORIGIN}/auth/callback?next=%2Fdashboard%2Fsites`),
    );

    expect(ensureTrialStarted).not.toHaveBeenCalled();
    expect(destination(response)).toBe("/dashboard/sites");
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example/steal",
  ])("refuses an unsafe no-code next value: %s", async (unsafeNext) => {
    const response = await GET(
      request(`${ORIGIN}/auth/callback?next=${encodeURIComponent(unsafeNext)}`),
    );

    expect(location(response)).toBe(`${ORIGIN}/dashboard`);
  });

  it("rejects a no-code request when reading the session returns an error", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: { message: "session invalid" },
    });

    const response = await GET(request(`${ORIGIN}/auth/callback`));

    expect(destination(response)).toBe("/auth/error");
  });

  it("rejects a no-code request when reading the session throws", async () => {
    mockGetUser.mockRejectedValue(new Error("supabase unavailable"));

    const response = await GET(request(`${ORIGIN}/auth/callback`));

    expect(destination(response)).toBe("/auth/error");
  });

  it.each([
    "error=access_denied",
    "error=access_denied&code=abc",
    "error=&code=abc",
  ])("gives an explicit auth error precedence for %s", async (query) => {
    const response = await GET(request(`${ORIGIN}/auth/callback?${query}`));

    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockGetUser).not.toHaveBeenCalled();
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
