/**
 * s46 — the browser SDK is initialised, with the options it always had.
 *
 * Until s46 the client init lived in `sentry.client.config.ts`, which only
 * Sentry's webpack entry injection loads. Next 16 builds with Turbopack, so the
 * file was never bundled: production shipped no browser SDK, the DSN's public
 * key was absent from every chunk, and an uncaught error on the live site sent
 * nothing. `instrumentation-client.ts` is the entry Next itself loads before
 * the app hydrates, under either bundler.
 *
 * The options were moved, not redesigned. These tests pin the ones that carry
 * a decision — production-only, sample rates, Replay masking, no PII — so the
 * move cannot quietly change them.
 */

jest.mock("@sentry/nextjs", () => ({
  init: jest.fn(),
  replayIntegration: jest.fn((options: unknown) => ({
    name: "Replay",
    options,
  })),
  browserTracingIntegration: jest.fn(() => ({ name: "BrowserTracing" })),
  captureRouterTransitionStart: jest.fn(),
}));

import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const DSN = "https://s46dummypublickey@o0.ingest.sentry.io/0";

const env = process.env as Record<string, string | undefined>;
const original = {
  NODE_ENV: env.NODE_ENV,
  NEXT_PUBLIC_SENTRY_DSN: env.NEXT_PUBLIC_SENTRY_DSN,
};

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

interface InitOptions {
  dsn?: string;
  enabled?: boolean;
  tracesSampleRate?: number;
  replaysSessionSampleRate?: number;
  replaysOnErrorSampleRate?: number;
  sendDefaultPii?: boolean;
  integrations?: unknown[];
  beforeSend?: (event: ErrorEvent, hint: EventHint) => ErrorEvent | null;
}

/** Evaluate the module afresh under `nodeEnv` and report what it did. */
async function loadUnder(nodeEnv: string) {
  setEnv("NODE_ENV", nodeEnv);
  setEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
  jest.resetModules();

  const Sentry = await import("@sentry/nextjs");
  const clientModule = await import("@/instrumentation-client");
  const init = Sentry.init as unknown as jest.Mock;

  return {
    Sentry,
    clientModule,
    initCalls: init.mock.calls.length,
    options: (init.mock.calls[0]?.[0] ?? {}) as InitOptions,
  };
}

afterEach(() => {
  for (const [name, value] of Object.entries(original)) setEnv(name, value);
  window.localStorage.clear();
});

describe("instrumentation-client", () => {
  it("initialises Sentry once, with the DSN from the environment", async () => {
    const { initCalls, options } = await loadUnder("production");

    expect(initCalls).toBe(1);
    expect(options.dsn).toBe(DSN);
  });

  it("is enabled in production only", async () => {
    expect((await loadUnder("production")).options.enabled).toBe(true);
    expect((await loadUnder("development")).options.enabled).toBe(false);
  });

  it("samples 10% of traces in production", async () => {
    const { options } = await loadUnder("production");

    expect(options.tracesSampleRate).toBe(0.1);
  });

  it("keeps Session Replay at its existing rates, with everything masked", async () => {
    // Replays render customer websites and their visitors' content. Unmasked,
    // they would route third parties' personal data into our error tooling.
    const { Sentry, options } = await loadUnder("production");

    expect(options.replaysSessionSampleRate).toBe(0.1);
    expect(options.replaysOnErrorSampleRate).toBe(1.0);
    expect(Sentry.replayIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
    );
    expect(options.integrations).toContainEqual(
      expect.objectContaining({ name: "Replay" }),
    );
  });

  it("never opts into default PII", async () => {
    const { options } = await loadUnder("production");

    expect(options.sendDefaultPii).not.toBe(true);
  });

  it("attaches only the user id to an event, never the email", async () => {
    window.localStorage.setItem(
      "user",
      JSON.stringify({ id: "user-1", email: "owner@example.com" }),
    );
    const { options } = await loadUnder("production");

    const event = options.beforeSend?.(
      { exception: { values: [] } } as unknown as ErrorEvent,
      { originalException: new Error("boom") },
    );

    expect(event?.user).toEqual({ id: "user-1" });
  });

  it("drops errors thrown from a browser extension", async () => {
    const { options } = await loadUnder("production");
    const error = new Error("extension noise");
    error.stack = "Error\n    at chrome-extension://abc/content.js:1:1";

    expect(
      options.beforeSend?.(
        { exception: { values: [] } } as unknown as ErrorEvent,
        { originalException: error },
      ),
    ).toBeNull();
  });

  it("instruments App Router navigations", async () => {
    const { Sentry, clientModule } = await loadUnder("production");

    expect(clientModule.onRouterTransitionStart).toBe(
      Sentry.captureRouterTransitionStart,
    );
  });
});
