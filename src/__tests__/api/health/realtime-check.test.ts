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
    // The route memoizes its realtime probe in module scope, so a stale memo
    // from the previous test would answer the next one's GET and every case
    // below would pass without a probe ever running. Resetting the registry is
    // what keeps the degrade / timeout / kill-switch cases biting.
    jest.resetModules();
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

  it("probes the service over http when the configured origin is a ws one", async () => {
    // The local-dev half of the same swap. `npm run dev` runs the socket server
    // on `ws://localhost:4001`, and `https://localhost:4001/health` is not the
    // same URL — it fails the TLS handshake against a plain HTTP server, so a
    // developer running the whole stack correctly would still read
    // "realtime: error" and go looking for a service that is up.
    process.env.NEXT_PUBLIC_WS_URL = "ws://localhost:4001";

    await callGet();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://localhost:4001/health",
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

  it("never returns the raw probe error to an anonymous caller", async () => {
    // `/api/health` is public and unauthenticated. Node's real failure messages
    // carry infrastructure detail — `ECONNREFUSED 127.0.0.1:4001` names an
    // internal port, TLS errors name ciphers and certificates — and they are
    // most interesting to an attacker exactly when the probe is failing. The
    // operator still gets the full message: it is logged at warn.
    const leaky = new Error(
      "connect ECONNREFUSED 10.0.0.7:4001 — internal-broker.fly.internal",
    );
    fetchMock.mockRejectedValue(leaky);

    const { response, body } = await callGet();
    const wire = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.checks.realtime.error).toBe("Realtime service unreachable");
    expect(wire).not.toContain("ECONNREFUSED");
    expect(wire).not.toContain("10.0.0.7");
    expect(wire).not.toContain("fly.internal");
  });

  it("keeps the timeout message generic too", async () => {
    const aborted = new Error("The operation was aborted due to timeout");
    aborted.name = "TimeoutError";
    fetchMock.mockRejectedValue(aborted);

    const { body } = await callGet();

    expect(body.checks.realtime.status).toBe("timeout");
    expect(body.checks.realtime.error).toBe("Realtime service timed out");
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

  it("survives a malformed NEXT_PUBLIC_WS_URL instead of 503-ing the endpoint", async () => {
    // The guard that costs the most when it is missing. `getRealtimeHealthUrl()`
    // is called INSIDE `GET`'s outer try, whose catch answers 503 `unhealthy` —
    // so an unguarded `new URL(configured)` on a typo'd variable takes the whole
    // app's health endpoint down, pages whoever is on call, and drops the
    // instance out of load balancer rotation. Same forbidden outcome as ADR
    // 004's "Watch", arriving from configuration rather than from an outage, and
    // a typo is far more likely than the outage.
    process.env.NEXT_PUBLIC_WS_URL = "not a url";

    const { response, body } = await callGet();

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.checks.realtime).toBeUndefined();
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

  /**
   * The memo. `/api/health` is public, unauthenticated and deliberately NOT
   * rate limited — uptime monitors poll it, and denying them is worse than what
   * this bounds. Since s07b every GET also issues an outbound request to the
   * realtime service, which makes an endpoint anyone can call a small
   * amplifier: one request in, two out, at whatever rate the caller likes.
   *
   * A limiter is the wrong answer here. Memoizing the probe is the right one:
   * the reading is a few seconds old at worst, and the traffic the endpoint can
   * generate downstream stops depending on the traffic it receives.
   */
  describe("the probe memo", () => {
    it("issues one outbound probe for two GETs inside the window", async () => {
      const first = await callGet();
      const second = await callGet();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(first.body.checks.realtime).toMatchObject({ status: "ok" });
      expect(second.body.checks.realtime).toMatchObject({ status: "ok" });
    });

    it("collapses concurrent GETs onto a single outbound probe", async () => {
      // The case the memo actually exists for. Storing only the settled result
      // would leave N simultaneous callers each starting their own fetch before
      // the first one lands — exactly the burst an unlimited public endpoint
      // invites — so what is held is the in-flight probe itself.
      const [first, second] = await Promise.all([callGet(), callGet()]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(first.body.checks.realtime).toMatchObject({ status: "ok" });
      expect(second.body.checks.realtime).toMatchObject({ status: "ok" });
    });

    it("probes again once the window has passed", async () => {
      // The other half: a memo that never expires is not a memo, it is a health
      // check frozen at boot, and it would report a dead service as healthy
      // forever.
      const base = Date.now();
      const nowSpy = jest.spyOn(Date, "now").mockReturnValue(base);

      try {
        await callGet();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        nowSpy.mockReturnValue(base + 10_001);
        await callGet();

        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("re-probes when the configured origin changes", async () => {
      // The memo is keyed on the URL it probed. Without that, a test — or a
      // process that reads a changed variable — gets an answer about a service
      // it is no longer pointing at.
      await callGet();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      process.env.NEXT_PUBLIC_WS_URL = "wss://recopyfast-ws-staging.fly.dev";
      await callGet();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[1][0])).toBe(
        "https://recopyfast-ws-staging.fly.dev/health",
      );
    });
  });
});
