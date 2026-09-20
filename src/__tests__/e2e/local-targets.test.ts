import {
  assertLocalMutationTargets,
  assertMutatingRunEnabled,
} from "../../../e2e/support/local-targets";

const LOCAL_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3000",
  NEXT_PUBLIC_WS_URL: "http://127.0.0.1:4001",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
};

describe("assertLocalMutationTargets", () => {
  it("accepts only the deterministic local E2E ports", () => {
    expect(assertLocalMutationTargets(LOCAL_ENV)).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      appUrl: "http://127.0.0.1:3000",
      webSocketUrl: "http://127.0.0.1:4001",
    });
  });

  it.each([
    [
      "hosted Supabase",
      { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" },
    ],
    [
      "wrong Supabase port",
      { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54322" },
    ],
    ["wrong app port", { PLAYWRIGHT_BASE_URL: "http://localhost:3001" }],
    ["wrong WebSocket port", { NEXT_PUBLIC_WS_URL: "http://[::1]:4002" }],
    [
      "non-loopback alias",
      { PLAYWRIGHT_BASE_URL: "http://local.example:3000" },
    ],
    ["bind-all address", { NEXT_PUBLIC_WS_URL: "http://0.0.0.0:4001" }],
    [
      "URL credentials",
      { NEXT_PUBLIC_SUPABASE_URL: "http://user:pass@127.0.0.1:54321" },
    ],
    ["URL path", { PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3000/not-local" }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      assertLocalMutationTargets({ ...LOCAL_ENV, ...override }),
    ).toThrow(/refusing mutating e2e/i);
  });

  it("rejects the production project reference even behind a loopback URL", () => {
    const productionPayload = Buffer.from(
      JSON.stringify({ ref: "uexwowziiigweobgpmtk", role: "service_role" }),
    ).toString("base64url");

    expect(() =>
      assertLocalMutationTargets({
        ...LOCAL_ENV,
        SUPABASE_SERVICE_ROLE_KEY: `header.${productionPayload}.signature`,
      }),
    ).toThrow(/production project/i);
  });

  it.each([
    "NEXT_PUBLIC_SUPABASE_URL",
    "PLAYWRIGHT_BASE_URL",
    "NEXT_PUBLIC_WS_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const)("rejects a missing %s", (name) => {
    expect(() =>
      assertLocalMutationTargets({ ...LOCAL_ENV, [name]: undefined }),
    ).toThrow(/refusing mutating e2e/i);
  });
});

describe("assertMutatingRunEnabled", () => {
  it("accepts an explicit opt-in", () => {
    expect(() =>
      assertMutatingRunEnabled("RUN_RECOPYFAST_CORE_E2E", {
        RUN_RECOPYFAST_CORE_E2E: "1",
      }),
    ).not.toThrow();
  });

  it("fails instead of converting a missing opt-in into a skip", () => {
    expect(() => assertMutatingRunEnabled("RUN_RECOPYFAST_PARITY", {})).toThrow(
      /must equal 1.*tests are never skipped/i,
    );
  });
});
