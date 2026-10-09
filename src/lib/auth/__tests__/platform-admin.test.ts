/**
 * @jest-environment node
 */

/**
 * s89 — who may publish the blog (ADR 057).
 *
 * A platform admin is a signed-in user whose email is in ADMIN_EMAILS, or whose
 * server-managed `app_metadata.role` is "admin". `user_metadata` is writable by
 * the user themself (PATCH /api/auth/profile, `auth.updateUser`), so a role
 * there grants nothing.
 *
 * The guard's order is the point: the per-IP limiter runs before
 * `getUser()` (authentication costs a GoTrue round trip a flood would like to
 * cause), the per-user limiter before the admin check, and both fail closed —
 * what they protect runs with RLS bypassed. The limiter is the shipped one over
 * its in-memory store; only `checkLimit` is spied on to refuse or fail.
 */

import { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  MemoryRateLimiter,
  rateLimiter,
  type RateLimitConfig,
} from "@/lib/security/rate-limiter";
import {
  authorizePlatformAdmin,
  isPlatformAdmin,
} from "@/lib/auth/platform-admin";

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));

const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;
const store = rateLimiter as MemoryRateLimiter;
const getUser = jest.fn();

const OWNER = "owner@example.com";

function user(overrides: Partial<User> = {}): User {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "someone@example.com",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-10-09T00:00:00Z",
    ...overrides,
  } as User;
}

function request() {
  return new NextRequest("https://www.recopyfa.st/api/admin/blog/posts", {
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
}

function signedIn(value: User | null) {
  getUser.mockResolvedValue({ data: { user: value }, error: null });
}

function refuse(predicate: (config: RateLimitConfig) => boolean) {
  const realCheck = store.checkLimit.bind(store);
  jest.spyOn(store, "checkLimit").mockImplementation((config) =>
    predicate(config)
      ? Promise.resolve({
          allowed: false,
          remaining: 0,
          resetTime: Date.now() + 60_000,
          totalRequests: config.maxRequests + 1,
        })
      : realCheck(config),
  );
}

function storeFails(predicate: (config: RateLimitConfig) => boolean) {
  const realCheck = store.checkLimit.bind(store);
  jest
    .spyOn(store, "checkLimit")
    .mockImplementation((config) =>
      predicate(config)
        ? Promise.reject(new Error("Redis unreachable"))
        : realCheck(config),
    );
}

const isIpBucket = (config: RateLimitConfig) => config.identifierType === "ip";
const isUserBucket = (config: RateLimitConfig) =>
  config.identifierType === "user";

const savedAdminEmails = process.env.ADMIN_EMAILS;

beforeEach(async () => {
  await store.clearAll();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  process.env.ADMIN_EMAILS = ` Owner@Example.com , ops@example.com `;
  getUser.mockReset();
  mockCreateClient.mockResolvedValue({
    auth: { getUser },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env.ADMIN_EMAILS = savedAdminEmails;
});

describe("isPlatformAdmin", () => {
  it("accepts an allow-listed email whatever its case or spacing", () => {
    expect(isPlatformAdmin(user({ email: "OWNER@example.COM" }))).toBe(true);
    expect(isPlatformAdmin(user({ email: "ops@example.com" }))).toBe(true);
  });

  it("accepts the server-managed app_metadata role", () => {
    expect(isPlatformAdmin(user({ app_metadata: { role: "admin" } }))).toBe(
      true,
    );
  });

  it("refuses a role the user wrote into user_metadata", () => {
    expect(isPlatformAdmin(user({ user_metadata: { role: "admin" } }))).toBe(
      false,
    );
  });

  it("refuses everyone else, and matches nobody when the list is empty", () => {
    expect(isPlatformAdmin(user())).toBe(false);
    expect(isPlatformAdmin(user({ email: undefined }))).toBe(false);

    process.env.ADMIN_EMAILS = " , ,";
    expect(isPlatformAdmin(user({ email: "" }))).toBe(false);
    expect(isPlatformAdmin(user({ email: OWNER }))).toBe(false);
  });
});

describe("authorizePlatformAdmin", () => {
  const options = { endpoint: "test-admin", userLimit: "API_UPLOAD" } as const;

  it("lets an admin through with their id", async () => {
    signedIn(user({ email: OWNER }));

    const result = await authorizePlatformAdmin(request(), options);

    expect(result).toEqual({
      ok: true,
      userId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("answers 401 when nobody is signed in", async () => {
    signedIn(null);

    const result = await authorizePlatformAdmin(request(), options);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("answers 401 when the session cannot be read", async () => {
    getUser.mockRejectedValue(new Error("GoTrue down"));

    const result = await authorizePlatformAdmin(request(), options);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("answers 403 to a signed-in user who is not an admin", async () => {
    signedIn(user({ user_metadata: { role: "admin" } }));

    const result = await authorizePlatformAdmin(request(), options);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("limits by IP before reading the session", async () => {
    refuse(isIpBucket);
    signedIn(user({ email: OWNER }));

    const result = await authorizePlatformAdmin(request(), options);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(429);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("fails closed when the store is down", async () => {
    storeFails(isIpBucket);
    signedIn(user({ email: OWNER }));

    const result = await authorizePlatformAdmin(request(), options);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("limits the signed-in user before the admin check", async () => {
    refuse(isUserBucket);
    signedIn(user());

    const result = await authorizePlatformAdmin(request(), options);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(429);
  });

  it("fails closed when the per-user store is down", async () => {
    storeFails(isUserBucket);
    signedIn(user({ email: OWNER }));

    const result = await authorizePlatformAdmin(request(), options);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
  });
});
