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
 * a decision — production-only, sample rates, no PII — so the move cannot
 * quietly change them.
 *
 * One option was then removed on purpose: Session Replay. Once the file was
 * actually bundled, the SDK added +121,922 B gzip to every page's first load,
 * and Replay was 38,965 B of it. The operator ruled on 2026-09-26 that launch
 * landing pages cannot carry it and that error reporting is the goal. Browser
 * tracing was kept on a measured cost of 58 B over an errors-only init (see
 * the comment in `src/instrumentation-client.ts`). The tests below pin both
 * choices, so neither can change as a side effect.
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
  sendDefaultPii?: boolean;
  tunnel?: string;
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

  it("keeps browser tracing: the one integration it registers", async () => {
    // Kept on a measured cost of 58 B gzip over an errors-only init (s46
    // follow-up). Dropping it is a size decision to re-measure, not a cleanup.
    const { Sentry, options } = await loadUnder("production");

    expect(Sentry.browserTracingIntegration).toHaveBeenCalledTimes(1);
    expect(options.integrations).toEqual([
      expect.objectContaining({ name: "BrowserTracing" }),
    ]);
  });

  it("ships no Session Replay: no integration, no replay sample rates", async () => {
    // Replay cost 38,965 B gzip on every page's first load. Re-adding it is a
    // decision (lazy-loaded, fully masked, and a CSP change), not a revert.
    const { Sentry, options } = await loadUnder("production");

    expect(Sentry.replayIntegration).not.toHaveBeenCalled();
    expect(options.integrations ?? []).not.toContainEqual(
      expect.objectContaining({ name: "Replay" }),
    );
    expect(options).not.toHaveProperty("replaysSessionSampleRate");
    expect(options).not.toHaveProperty("replaysOnErrorSampleRate");
  });

  it("sets no tunnel of its own, so the build-injected /monitoring route applies", async () => {
    // The SDK derives `tunnel` from `tunnelRoute` in next.config.ts at init.
    // A hard-coded tunnel here would be a second source of truth for it.
    const { options } = await loadUnder("production");

    expect(options).not.toHaveProperty("tunnel");
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
