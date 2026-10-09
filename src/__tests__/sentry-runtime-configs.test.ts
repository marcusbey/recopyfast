/**
 * @jest-environment node
 */

/**
 * s84 — the server and Edge Sentry inits report the same release as the
 * browser.
 *
 * Before s84 each runtime picked its own: the browser read
 * NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA (unset unless Vercel exposes system
 * variables), server and edge read VERCEL_GIT_COMMIT_SHA at runtime. Two
 * sources for one fact, one of which can be empty — and an empty one is worse
 * than none, because @sentry/nextjs spreads these options over its own
 * build-injected release, so `release: undefined` erases it.
 *
 * The one source is NEXT_PUBLIC_SENTRY_RELEASE, which next.config.ts inlines
 * from the build's commit SHA (`next-config-sentry.test.ts`).
 */

jest.mock("@sentry/nextjs", () => ({ init: jest.fn() }));

const env = process.env as Record<string, string | undefined>;
const original = {
  NEXT_PUBLIC_SENTRY_RELEASE: env.NEXT_PUBLIC_SENTRY_RELEASE,
  VERCEL_GIT_COMMIT_SHA: env.VERCEL_GIT_COMMIT_SHA,
};

function setEnv(name: keyof typeof original, value: string | undefined) {
  if (value === undefined) delete env[name];
  else env[name] = value;
}

afterEach(() => {
  for (const [name, value] of Object.entries(original)) {
    setEnv(name as keyof typeof original, value);
  }
});

async function initOptionsOf(
  config: "sentry.server.config" | "sentry.edge.config",
): Promise<Record<string, unknown>> {
  jest.resetModules();
  const Sentry = await import("@sentry/nextjs");
  if (config === "sentry.server.config") {
    await import("../../sentry.server.config");
  } else {
    await import("../../sentry.edge.config");
  }
  const init = Sentry.init as unknown as jest.Mock;
  expect(init).toHaveBeenCalledTimes(1);
  return init.mock.calls[0][0] as Record<string, unknown>;
}

describe.each(["sentry.server.config", "sentry.edge.config"] as const)(
  "%s",
  (config) => {
    it("reports the build's release, whatever the runtime environment says", async () => {
      setEnv("NEXT_PUBLIC_SENTRY_RELEASE", "8f2c1e0d9b7a");
      setEnv("VERCEL_GIT_COMMIT_SHA", undefined);

      const options = await initOptionsOf(config);

      expect(options.release).toBe("8f2c1e0d9b7a");
    });

    it("passes no release key when the build has none", async () => {
      setEnv("NEXT_PUBLIC_SENTRY_RELEASE", undefined);
      setEnv("VERCEL_GIT_COMMIT_SHA", undefined);

      const options = await initOptionsOf(config);

      expect(options).not.toHaveProperty("release");
    });
  },
);
