/**
 * Shared fixtures for the s89 blog route suites (generate, admin list/publish).
 *
 * `rlsRefusingClient` stands in for the cookie-bound server client. It answers
 * `auth.getUser()` and refuses every `blog_posts` query with 42501, which is
 * what production does to an owner who is admin only through ADMIN_EMAILS
 * (the write policy keys on `app_metadata.role`, research fact 3). A route that
 * wrote through it would fail, so a passing suite means the write went through
 * the service role, after the route's own checks — not that the mock was
 * generous (the s42 lesson, src/__tests__/api/api-keys/writes.test.ts).
 *
 * This is a helper, not a suite: jest's `testMatch` only collects `*.test.*`.
 */

import type { User } from "@supabase/supabase-js";

export const APP_ORIGIN = "https://www.recopyfa.st";
export const ADMIN_EMAIL = "owner@example.com";
export const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

const RLS_DENIED = {
  code: "42501",
  message: 'permission denied for table "blog_posts"',
  details: null,
  hint: null,
};

type Chain = Record<string, unknown>;

function refusingBuilder(): Chain {
  const result = { data: null, error: RLS_DENIED };
  const builder: Chain = {};
  for (const method of [
    "select",
    "insert",
    "update",
    "upsert",
    "delete",
    "eq",
    "in",
    "order",
    "limit",
  ]) {
    builder[method] = () => builder;
  }
  builder.single = async () => result;
  builder.maybeSingle = async () => result;
  builder.then = (
    resolve: (value: typeof result) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

export function rlsRefusingClient(getUser: jest.Mock) {
  return {
    auth: { getUser },
    from: jest.fn(() => refusingBuilder()),
  };
}

export function blogUser(overrides: Partial<User> = {}): User {
  return {
    id: ADMIN_ID,
    email: "someone@example.com",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-10-09T00:00:00Z",
    ...overrides,
  } as User;
}

type FakeTimersConfig = NonNullable<Parameters<typeof jest.useFakeTimers>[0]>;

/** Pins the clock at `now`; every timer and tick stays real. */
export function onlyDateFaked(now: Date): FakeTimersConfig {
  return {
    now,
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  };
}
