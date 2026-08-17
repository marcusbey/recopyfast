/**
 * M-1 — which store the shared limiter picks, and why it may never be decided
 * by NODE_ENV alone.
 *
 * `src/lib/security/rate-limiter.ts` used to end with
 * `RateLimiterFactory.getLimiter(process.env.NODE_ENV === "production")`. When
 * that boolean is false the app gets `MemoryRateLimiter`, whose `checkLimit`
 * never throws — so every `onStoreFailure: "deny"` in the codebase, including
 * the eleven service-role handlers ADR 002 rule 4 requires them on, becomes
 * dead code. The counters also go per-isolate, which on a serverless platform
 * is no limit at all.
 *
 * One unset or misspelled NODE_ENV therefore downgraded every fail-closed
 * limiter in the app, with no log and no failure. `server/index.js`'s
 * `assertProductionEnvironment()` refuses to boot for exactly this; a
 * serverless app cannot refuse to boot, so the equivalent is: never hand a
 * production-like deployment the memory store, and say so loudly when the
 * store it does hand it has nowhere to connect.
 *
 * Every case loads the module fresh — the limiter is a module-scope singleton
 * built at import time, so mutating `process.env` afterwards proves nothing.
 */

export {};

/**
 * A client that behaves like node-redis pointed at a host with nothing on it.
 * Whether this is reached at all is the assertion: a deployment with no
 * REDIS_URL must be told to set REDIS_URL, not left to discover ECONNREFUSED
 * against a localhost that does not exist on Vercel.
 */
const mockCreateRedisClient = jest.fn(() => ({
  isOpen: false,
  connect: jest.fn(() =>
    Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:6379")),
  ),
  destroy: jest.fn(),
  on: jest.fn(),
}));

jest.mock("redis", () => ({ createClient: () => mockCreateRedisClient() }));

const ORIGINAL_ENV = process.env;

/** Any config; none of these cases depends on the window or the limit. */
const SOME_CHECK = {
  windowMs: 60_000,
  maxRequests: 10,
  identifier: "site-1",
  identifierType: "api_key" as const,
  endpoint: "content/site",
};

async function loadLimiter(env: Record<string, string | undefined>) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  // Installed before the import: the warning fires at module scope, which is
  // the closest thing a serverless app has to a startup gate.
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  const mod = await import("@/lib/security/rate-limiter");
  return { mod, errorSpy };
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
  mockCreateRedisClient.mockClear();
  jest.restoreAllMocks();
  jest.resetModules();
});

describe("which store the shared rate limiter resolves to", () => {
  it("uses Redis on a production deployment that has a store", async () => {
    const { mod, errorSpy } = await loadLimiter({
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      REDIS_URL: "rediss://default:pw@store.upstash.io:6379",
    });

    expect(mod.rateLimiter).toBeInstanceOf(mod.RedisRateLimiter);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("uses the in-memory store on a developer's machine, quietly", async () => {
    const { mod, errorSpy } = await loadLimiter({
      VERCEL_ENV: undefined,
      NODE_ENV: "development",
      REDIS_URL: undefined,
    });

    expect(mod.rateLimiter).toBeInstanceOf(mod.MemoryRateLimiter);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // THE BUG. Vercel always sets VERCEL_ENV on a deployment; NODE_ENV is
  // ordinary configuration and can be dropped or misspelled by hand. Reading
  // NODE_ENV alone meant one typo swapped the shared store for a per-isolate
  // map and nothing anywhere said so.
  it("still uses Redis on a Vercel deployment whose NODE_ENV was lost", async () => {
    const { mod } = await loadLimiter({
      VERCEL_ENV: "production",
      NODE_ENV: undefined,
      REDIS_URL: "rediss://default:pw@store.upstash.io:6379",
    });

    expect(mod.rateLimiter).toBeInstanceOf(mod.RedisRateLimiter);
  });

  it("still uses Redis on a Vercel deployment whose NODE_ENV was misspelled", async () => {
    const { mod } = await loadLimiter({
      VERCEL_ENV: "production",
      NODE_ENV: "prodction",
      REDIS_URL: "rediss://default:pw@store.upstash.io:6379",
    });

    expect(mod.rateLimiter).toBeInstanceOf(mod.RedisRateLimiter);
  });

  // A preview deployment is publicly reachable and serves the same
  // service-role widget paths as production, opened by a token published in
  // the customer's page markup. Unmetered there is the same exposure.
  //
  // NODE_ENV is left unset on purpose: Vercel happens to set it to "production"
  // for a preview build too, so asserting with it present would pass on that
  // coincidence rather than on VERCEL_ENV being read.
  it("treats a preview deployment as production-like", async () => {
    const { mod } = await loadLimiter({
      VERCEL_ENV: "preview",
      NODE_ENV: undefined,
      REDIS_URL: "rediss://default:pw@store.upstash.io:6379",
    });

    expect(mod.rateLimiter).toBeInstanceOf(mod.RedisRateLimiter);
  });

  // `vercel dev` is a laptop. VERCEL_ENV outranks NODE_ENV in both directions
  // or it is not the discriminator.
  it("treats VERCEL_ENV=development as a laptop even when NODE_ENV says production", async () => {
    const { mod, errorSpy } = await loadLimiter({
      VERCEL_ENV: "development",
      NODE_ENV: "production",
      REDIS_URL: undefined,
    });

    expect(mod.rateLimiter).toBeInstanceOf(mod.MemoryRateLimiter);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // Fail safe: an environment that identifies itself as nothing is assumed to
  // be serving real traffic. Being wrongly strict is a 503 someone reads in an
  // hour; being wrongly permissive is an unmetered service-role path nobody
  // can see at all.
  it("assumes production-like when neither variable says otherwise", async () => {
    const { mod } = await loadLimiter({
      VERCEL_ENV: undefined,
      NODE_ENV: undefined,
      REDIS_URL: "rediss://default:pw@store.upstash.io:6379",
    });

    expect(mod.rateLimiter).toBeInstanceOf(mod.RedisRateLimiter);
  });

  it("keeps the test runner on the in-memory store", async () => {
    // Otherwise this very suite would be the exception that hides the rule.
    const { mod, errorSpy } = await loadLimiter({
      VERCEL_ENV: undefined,
      NODE_ENV: "test",
      REDIS_URL: undefined,
    });

    expect(mod.rateLimiter).toBeInstanceOf(mod.MemoryRateLimiter);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("a production-like deployment with no rate-limit store", () => {
  const PRODUCTION_WITHOUT_REDIS = {
    VERCEL_ENV: "production",
    NODE_ENV: "production",
    REDIS_URL: undefined,
  };

  it("never quietly downgrades to the in-memory store", async () => {
    // MemoryRateLimiter.checkLimit cannot throw, so a caller that asked for
    // `onStoreFailure: "deny"` would be served an allow it can never detect.
    const { mod } = await loadLimiter(PRODUCTION_WITHOUT_REDIS);

    expect(mod.rateLimiter).not.toBeInstanceOf(mod.MemoryRateLimiter);
    expect(mod.rateLimiter).toBeInstanceOf(mod.RedisRateLimiter);
  });

  it("logs at error, not warn — a missing limiter is not an advisory", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const { errorSpy } = await loadLimiter(PRODUCTION_WITHOUT_REDIS);

    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("names the variable to set and the environment it read", async () => {
    const { errorSpy } = await loadLimiter(PRODUCTION_WITHOUT_REDIS);

    const message = errorSpy.mock.calls
      .map((call) => call.join(" "))
      .join("\n");
    expect(message).toContain("REDIS_URL");
    expect(message).toContain("VERCEL_ENV=production");
    expect(message).toContain("NODE_ENV=production");
  });

  it("fails the check closed rather than answering allowed", async () => {
    // End to end through the store the app actually holds: no URL, so
    // ensureClient() refuses instead of dialling localhost, checkLimit throws,
    // and `enforceRateLimit` applies each endpoint's declared policy.
    const { mod } = await loadLimiter(PRODUCTION_WITHOUT_REDIS);

    await expect(mod.rateLimiter.checkLimit(SOME_CHECK)).rejects.toThrow(
      /REDIS_URL/,
    );
    expect(mockCreateRedisClient).not.toHaveBeenCalled();
  });

  // The client guard used to ask NODE_ENV the same question the store
  // selection did, so a deployment that lost NODE_ENV fell through to
  // redis://localhost:6379 — a host that does not exist on Vercel. The
  // endpoint still failed closed, but it failed reporting a refused connection
  // to an address nobody configured instead of naming the variable to set.
  it("names REDIS_URL rather than dialling localhost when NODE_ENV was lost", async () => {
    const { mod } = await loadLimiter({
      VERCEL_ENV: "production",
      NODE_ENV: undefined,
      REDIS_URL: undefined,
    });

    await expect(mod.rateLimiter.checkLimit(SOME_CHECK)).rejects.toThrow(
      /REDIS_URL/,
    );
    expect(mockCreateRedisClient).not.toHaveBeenCalled();
  });
});

describe("isProductionLikeEnvironment", () => {
  it.each([
    ["production", "production"],
    ["preview", "preview"],
    ["an unrecognised VERCEL_ENV", "staging"],
  ])("is true for %s", async (_label, vercelEnv) => {
    const { mod } = await loadLimiter({
      VERCEL_ENV: vercelEnv,
      REDIS_URL: "rediss://default:pw@store.upstash.io:6379",
    });

    expect(mod.isProductionLikeEnvironment()).toBe(true);
  });

  it.each([
    ["vercel dev", { VERCEL_ENV: "development", NODE_ENV: "production" }],
    ["npm run dev", { VERCEL_ENV: undefined, NODE_ENV: "development" }],
    ["the test runner", { VERCEL_ENV: undefined, NODE_ENV: "test" }],
  ])("is false for %s", async (_label, env) => {
    const { mod } = await loadLimiter(env);

    expect(mod.isProductionLikeEnvironment()).toBe(false);
  });
});
