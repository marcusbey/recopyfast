/**
 * `GET /api/health` — the realtime check, and the asymmetry it has to preserve.
 *
 * ADR 004's "Watch" clause: realtime is now a second thing that can be down, and
 * it must never be a thing that can take editing down with it. HTTP is
 * authoritative — with the socket service stopped, editing, saving, staging and
 * publishing all still work — so a realtime outage is a *degradation*, never an
 * outage of the app.
 *
 * The severity maths in the route is what makes this delicate. It counts errors
 * across `checks` and turns "two or more" into `unhealthy`, which answers 503.
 * Drop the realtime check into that array and a Fly restart during a storage
 * blip returns 503 for the whole product, pages whoever is on call, and takes
 * the app out of load balancer rotation — over a feature that is, by design,
 * additive.
 *
 * So every case below is written as a pair: what realtime being down DOES do
 * (degrade, 200) and what it must NOT be able to do (contribute to `unhealthy`,
 * reach `HEAD`, produce a 503). This is the one automated guard on a criterion
 * whose absence would be invisible until an outage.
 */

interface DoubleOptions {
  databaseOk?: boolean;
  storageOk?: boolean;
}

let doubleOptions: DoubleOptions = {};

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(
      doubleOptions.databaseOk === false
        ? {
            data: null,
            error: { code: "PGRST301", message: "database down" },
          }
        : { data: { id: "1" }, error: null },
    ),
    storage: {
      getBucket: jest
        .fn()
        .mockResolvedValue(
          doubleOptions.storageOk === false
            ? { data: null, error: { message: "storage down" } }
            : { data: { name: "assets", public: false }, error: null },
        ),
    },
  })),
}));

const REALTIME_ORIGIN = "wss://recopyfast-ws.fly.dev";

/** The shape `server/index.js:129-136` actually answers with. */
function realtimeUp() {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      status: "ok",
      connections: 3,
      supabase: "connected",
      message: "All systems operational",
    }),
  } as unknown as Response);
}

async function callGet(url = "http://localhost:3000/api/health") {
  const { NextRequest } = await import("next/server");
  const { GET } = await import("@/app/api/health/route");
  const response = await GET(new NextRequest(url));
  return { response, body: await response.json() };
}

describe("GET /api/health — the realtime check", () => {
  const originalWsUrl = process.env.NEXT_PUBLIC_WS_URL;
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    doubleOptions = {};
    process.env.NEXT_PUBLIC_WS_URL = REALTIME_ORIGIN;
    fetchMock = jest.fn(realtimeUp);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalWsUrl === undefined) {
      delete process.env.NEXT_PUBLIC_WS_URL;
    } else {
      process.env.NEXT_PUBLIC_WS_URL = originalWsUrl;
    }
  });

  it("reports realtime alongside the other checks when the service answers", async () => {
    const { response, body } = await callGet();

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.checks.realtime).toMatchObject({ status: "ok" });
    expect(body.checks.realtime.details).toMatchObject({
      connections: 3,
      supabase: "connected",
    });
  });

  it("probes the service over https when the configured origin is a wss one", async () => {
    // `NEXT_PUBLIC_WS_URL` is a websocket origin because that is what the widget
    // and the CSP need. `fetch` cannot speak wss:, so a naive `fetch(wsUrl +
    // "/health")` throws `unsupported protocol` and reports the service down on
    // every single request — a permanently degraded app with a healthy service.
    await callGet();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://recopyfast-ws.fly.dev/health",
    );
  });

  it("degrades the app when realtime is down, and still answers 200", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const { response, body } = await callGet();

    expect(body.checks.realtime.status).toBe("error");
    expect(body.status).toBe("degraded");
    expect(response.status).toBe(200);
  });

  it("degrades on a non-2xx answer from the service too", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    } as unknown as Response);

    const { response, body } = await callGet();

    expect(body.checks.realtime.status).toBe("error");
    expect(body.status).toBe("degraded");
    expect(response.status).toBe(200);
  });

  it("records a timeout rather than waiting on an unreachable service", async () => {
    const aborted = new Error("The operation was aborted");
    aborted.name = "AbortError";
    fetchMock.mockRejectedValue(aborted);

    const { response, body } = await callGet();

    expect(body.checks.realtime.status).toBe("timeout");
    expect(body.status).toBe("degraded");
    expect(response.status).toBe(200);
  });

  it("cannot push the app to unhealthy alongside a second failing check", async () => {
    // The load-bearing case. Storage down on its own is one error, which is
    // `degraded` and 200. If realtime joined the severity array this pair would
    // be two errors, `unhealthy`, and a 503 for the entire app — caused by a
    // service the app does not need in order to serve.
    doubleOptions = { storageOk: false };
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const { response, body } = await callGet();

    expect(body.checks.storage.status).toBe("error");
    expect(body.checks.realtime.status).toBe("error");
    expect(body.status).toBe("degraded");
    expect(response.status).toBe(200);
  });

  it("leaves a genuine two-check outage reporting unhealthy", async () => {
    // The control. Excluding realtime from the maths must not defang the maths:
    // database and storage both down is still 503.
    doubleOptions = { databaseOk: false, storageOk: false };

    const { response, body } = await callGet();

    expect(body.status).toBe("unhealthy");
    expect(response.status).toBe(503);
  });

  it("omits the check entirely when no realtime origin is configured", async () => {
    // The kill switch (ADR 004 rule 2): unset the variable and the product
    // returns to its pre-s07b state. A health check that then reported
    // "realtime: error" would turn a deliberate rollback into a permanent
    // degraded reading, and the next person would treat the alarm as noise.
    delete process.env.NEXT_PUBLIC_WS_URL;

    const { response, body } = await callGet();

    expect(body.checks.realtime).toBeUndefined();
    expect(body.status).toBe("healthy");
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps HEAD reading the database alone, with realtime down", async () => {
    // HEAD is what the uptime monitor and the load balancer poll. It answers
    // "can this instance serve traffic", and realtime has no bearing on that.
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const { HEAD } = await import("@/app/api/health/route");
    const response = await HEAD();

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the probe on the quick path", async () => {
    // `?quick=true` exists to answer without touching a dependency at all.
    const { response, body } = await callGet(
      "http://localhost:3000/api/health?quick=true",
    );

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
