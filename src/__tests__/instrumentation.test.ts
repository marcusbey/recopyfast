/**
 * @jest-environment node
 */

/**
 * s46 — which Sentry init the server runs, and that request errors reach it.
 *
 * Until s46 the repo had two server instrumentation files: a runtime-aware one
 * at the root and a stale one in `src/` that loaded the Node config on every
 * runtime. Next 16 builds with Turbopack, which looks at the root first, so the
 * root file ran; `next build --webpack` only scans `src/` for a `src/app`
 * layout, so it would have run the other one. Which init shipped depended on
 * the bundler. The layout block below pins "one file, in `src/`", the only
 * place both bundlers agree on.
 *
 * Neither file exported `onRequestError`, so errors Next catches in route
 * handlers and server components never reached Sentry at all.
 */

import fs from "node:fs";
import path from "node:path";

const mockLoaded: string[] = [];

jest.mock("../../sentry.server.config", () => {
  mockLoaded.push("sentry.server.config");
  return {};
});

jest.mock("../../sentry.edge.config", () => {
  mockLoaded.push("sentry.edge.config");
  return {};
});

jest.mock("@sentry/nextjs", () => ({ captureRequestError: jest.fn() }));

const REPO_ROOT = path.resolve(__dirname, "../..");
const DSN = "https://s46dummypublickey@o0.ingest.sentry.io/0";

// `NODE_ENV` is typed read-only by Next's ambient types; the register gate
// reads it at call time, so the tests have to be able to set it.
const env = process.env as Record<string, string | undefined>;
const original = {
  NODE_ENV: env.NODE_ENV,
  NEXT_RUNTIME: env.NEXT_RUNTIME,
  NEXT_PUBLIC_SENTRY_DSN: env.NEXT_PUBLIC_SENTRY_DSN,
};

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

interface Scenario {
  nodeEnv: string;
  runtime: string | undefined;
  dsn: string | undefined;
}

/** The config modules `register()` pulled in, in order. */
async function registerUnder({
  nodeEnv,
  runtime,
  dsn,
}: Scenario): Promise<string[]> {
  setEnv("NODE_ENV", nodeEnv);
  setEnv("NEXT_RUNTIME", runtime);
  setEnv("NEXT_PUBLIC_SENTRY_DSN", dsn);
  jest.resetModules();
  mockLoaded.length = 0;

  const { register } = await import("@/instrumentation");
  await register();

  return [...mockLoaded];
}

afterEach(() => {
  for (const [name, value] of Object.entries(original)) setEnv(name, value);
});

describe("register()", () => {
  it("loads the Node config, and only it, on the Node runtime", async () => {
    await expect(
      registerUnder({ nodeEnv: "production", runtime: "nodejs", dsn: DSN }),
    ).resolves.toEqual(["sentry.server.config"]);
  });

  it("loads the Edge config, and only it, on the Edge runtime", async () => {
    // The stale src/ file loaded the Node config here, which reads
    // `process.version` in its beforeSend — an Edge isolate has no such thing.
    await expect(
      registerUnder({ nodeEnv: "production", runtime: "edge", dsn: DSN }),
    ).resolves.toEqual(["sentry.edge.config"]);
  });

  it("loads nothing on a runtime it does not know", async () => {
    await expect(
      registerUnder({ nodeEnv: "production", runtime: undefined, dsn: DSN }),
    ).resolves.toEqual([]);
  });

  it("loads nothing without a DSN", async () => {
    await expect(
      registerUnder({
        nodeEnv: "production",
        runtime: "nodejs",
        dsn: undefined,
      }),
    ).resolves.toEqual([]);
  });

  it("loads nothing outside production", async () => {
    await expect(
      registerUnder({ nodeEnv: "development", runtime: "nodejs", dsn: DSN }),
    ).resolves.toEqual([]);
  });
});

describe("onRequestError", () => {
  it("hands every request error Next catches to Sentry", async () => {
    jest.resetModules();
    const instrumentation = await import("@/instrumentation");
    const Sentry = await import("@sentry/nextjs");

    expect(instrumentation.onRequestError).toBe(Sentry.captureRequestError);
  });
});

describe("instrumentation file layout", () => {
  const exists = (...segments: string[]) =>
    fs.existsSync(path.join(REPO_ROOT, ...segments));

  it("keeps the server instrumentation in src/", () => {
    expect(exists("src", "instrumentation.ts")).toBe(true);
  });

  it.each(["instrumentation.ts", "instrumentation.js", "instrumentation.mjs"])(
    "has no root %s to shadow it under Turbopack",
    (file) => {
      expect(exists(file)).toBe(false);
    },
  );

  it.each(["instrumentation-client.ts", "instrumentation-client.js"])(
    "has no root %s beside the src/ one",
    (file) => {
      expect(exists(file)).toBe(false);
    },
  );

  it("keeps the browser init in src/", () => {
    expect(exists("src", "instrumentation-client.ts")).toBe(true);
  });

  it.each(["sentry.client.config.ts", "sentry.client.config.js"])(
    "has no %s, which webpack would inject as a second init",
    (file) => {
      // Turbopack never loads it (that is how s46 happened); webpack injects it
      // *and* instrumentation-client, so Sentry.init would run twice.
      expect(exists(file)).toBe(false);
    },
  );
});
