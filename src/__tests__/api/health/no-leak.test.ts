/**
 * s84 (s69 L3) — the public health bodies say how each component is, and
 * nothing about why.
 *
 * `/api/health` and `/api/health/ready` are anonymous by design: uptime
 * monitors call them without a credential. They used to answer with the raw
 * Postgres/PostgREST/Storage error message, the bucket name and whether it is
 * public, the realtime service's live connection count, heap metrics on
 * `?detailed=true`, the NAMES of missing environment variables and the Vercel
 * region. Each is reconnaissance, and the error text is most interesting to an
 * attacker exactly when the probe is failing.
 *
 * The contract pinned here: every component is `{ status, latency }` and
 * nothing else; every readiness check is `{ name, status, critical }`; the
 * detail goes to the server log, where an operator reads it.
 */

import { NextRequest } from "next/server";

const mockLoggerError = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock("@/lib/monitoring/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

/** What the database and storage answer for the current test. */
let databaseError: unknown = null;
let storageError: unknown = null;

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    limit: jest.fn(async () =>
      databaseError
        ? { data: null, error: databaseError }
        : { data: [{ id: "plan-1" }], error: null },
    ),
    storage: {
      getBucket: jest.fn(async () =>
        storageError
          ? { data: null, error: storageError }
          : { data: { name: "assets", public: true }, error: null },
      ),
      listBuckets: jest.fn(async () =>
        storageError
          ? { data: null, error: storageError }
          : { data: [{ name: "assets" }], error: null },
      ),
    },
  })),
}));

/** Strings that must never reach an anonymous caller. */
const DB_LEAK =
  'relation "plans" does not exist at db.leakyproject.supabase.co';
const STORAGE_LEAK = "Bucket assets-internal-7f3a not found for project leaky";
const REALTIME_LEAK = "connect ECONNREFUSED 10.0.0.7:4001 internal.fly";

const env = process.env as Record<string, string | undefined>;
const saved = {
  NEXT_PUBLIC_WS_URL: env.NEXT_PUBLIC_WS_URL,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  VERCEL_REGION: env.VERCEL_REGION,
};
const originalFetch = global.fetch;

function setEnv(name: keyof typeof saved, value: string | undefined): void {
  if (value === undefined) delete env[name];
  else env[name] = value;
}

function request(path: string): NextRequest {
  return new NextRequest(`https://www.recopyfa.st${path}`);
}

beforeEach(() => {
  jest.resetModules();
  mockLoggerError.mockReset();
  mockLoggerWarn.mockReset();
  databaseError = null;
  storageError = null;
  setEnv("NEXT_PUBLIC_WS_URL", "wss://recopyfast-ws.fly.dev");
  setEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
  setEnv("VERCEL_REGION", "iad1");
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: "ok", connections: 7, supabase: "connected" }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    setEnv(name as keyof typeof saved, value);
  }
  global.fetch = originalFetch;
});

async function getHealth(path = "/api/health") {
  const { GET } = await import("@/app/api/health/route");
  const response = await GET(request(path));
  return { response, body: await response.json() };
}

async function getReady() {
  const { GET } = await import("@/app/api/health/ready/route");
  const response = await GET(request("/api/health/ready"));
  return { response, body: await response.json() };
}

/** Every logged error's message, flattened, so a test can find the detail. */
function loggedErrorText(): string {
  return JSON.stringify(
    mockLoggerError.mock.calls.map(([message, error, , context]) => [
      message,
      error instanceof Error ? error.message : error,
      context,
    ]),
  );
}

describe("GET /api/health — what an anonymous caller learns", () => {
  it("reports every component as exactly { status, latency } when all is well", async () => {
    const { response, body } = await getHealth("/api/health?detailed=true");

    expect(response.status).toBe(200);
    for (const [name, check] of Object.entries(body.checks)) {
      expect([name, Object.keys(check as object).sort()]).toEqual([
        name,
        ["latency", "status"],
      ]);
    }
    // Guard: the components the contract is about are really there.
    expect(Object.keys(body.checks).sort()).toEqual(
      ["cache", "database", "external", "realtime", "storage"].sort(),
    );
  });

  it("never exposes heap metrics, even on ?detailed=true", async () => {
    const { body } = await getHealth("/api/health?detailed=true");

    expect(body).not.toHaveProperty("metrics");
  });

  it("does not publish the realtime service's connection count", async () => {
    const { body } = await getHealth();
    const wire = JSON.stringify(body);

    expect(body.checks.realtime).toEqual({
      status: "ok",
      latency: expect.any(Number),
    });
    expect(wire).not.toContain("connections");
    expect(wire).not.toContain("connected");
  });

  it("does not name the bucket or say whether it is public", async () => {
    const { body } = await getHealth();
    const wire = JSON.stringify(body);

    expect(wire).not.toContain("assets");
    expect(wire).not.toContain("public");
  });

  it("answers a failing database and storage with a status, and logs the reason", async () => {
    databaseError = { code: "42P01", message: DB_LEAK };
    storageError = { message: STORAGE_LEAK };

    const { response, body } = await getHealth();
    const wire = JSON.stringify(body);

    expect(response.status).toBe(503);
    expect(body.checks.database).toEqual({
      status: "error",
      latency: expect.any(Number),
    });
    expect(body.checks.storage).toEqual({
      status: "error",
      latency: expect.any(Number),
    });
    expect(wire).not.toContain("leaky");
    expect(wire).not.toContain("does not exist");
    // The operator still gets it: the route logs the raw failure.
    expect(loggedErrorText()).toContain("leakyproject");
    expect(loggedErrorText()).toContain("assets-internal-7f3a");
  });

  it("answers an unreachable realtime service with a status only", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error(REALTIME_LEAK);
    }) as unknown as typeof fetch;

    const { body } = await getHealth();
    const wire = JSON.stringify(body);

    expect(body.checks.realtime).toEqual({
      status: "error",
      latency: expect.any(Number),
    });
    expect(wire).not.toContain("ECONNREFUSED");
    expect(wire).not.toContain("Realtime service");
  });
});

describe("GET /api/health/ready — what an anonymous caller learns", () => {
  it("reports each check as exactly { name, status, critical }, and no region", async () => {
    const { response, body } = await getReady();

    expect(response.status).toBe(200);
    expect(body.checks.length).toBeGreaterThan(0);
    for (const check of body.checks) {
      expect(Object.keys(check).sort()).toEqual(["critical", "name", "status"]);
    }
    expect(JSON.stringify(body)).not.toContain("iad1");
    expect(body.details ?? {}).not.toHaveProperty("region");
  });

  it("does not name the missing environment variable, and logs it instead", async () => {
    setEnv("SUPABASE_SERVICE_ROLE_KEY", undefined);

    const { response, body } = await getReady();
    const wire = JSON.stringify(body);

    expect(response.status).toBe(503);
    expect(body.checks).toContainEqual({
      name: "environment_variables",
      status: "fail",
      critical: true,
    });
    expect(wire).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(wire).not.toContain("Missing");
    expect(loggedErrorText()).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("does not return the raw database or storage error", async () => {
    databaseError = new Error(DB_LEAK);
    storageError = new Error(STORAGE_LEAK);

    const { response, body } = await getReady();
    const wire = JSON.stringify(body);

    expect(response.status).toBe(503);
    expect(body.checks).toContainEqual({
      name: "database_connection",
      status: "fail",
      critical: true,
    });
    expect(body.checks).toContainEqual({
      name: "storage_access",
      status: "fail",
      critical: false,
    });
    expect(wire).not.toContain("leaky");
    expect(loggedErrorText()).toContain("leakyproject");
    expect(loggedErrorText()).toContain("assets-internal-7f3a");
  });
});
