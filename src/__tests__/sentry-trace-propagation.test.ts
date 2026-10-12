/**
 * @jest-environment node
 */

/**
 * s96 — scanned sites never receive Sentry trace headers.
 *
 * Research (2026-10-11, @sentry/core 10.58 in node_modules):
 * `shouldPropagateTraceForUrl(url, undefined)` returns true, so with the option
 * unset the server SDK attaches `sentry-trace` and `baggage` to every outgoing
 * `http.request` — the free tools' fetches of strangers' sites included. Both
 * server-side inits therefore set `tracePropagationTargets` to our own origins.
 */

import { shouldPropagateTraceForUrl } from "@sentry/core";
import { tracePropagationTargets } from "@/lib/monitoring/trace-propagation";

jest.mock("@sentry/nextjs", () => ({ init: jest.fn() }));

const env = process.env as Record<string, string | undefined>;
const saved = {
  NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_WS_URL: env.NEXT_PUBLIC_WS_URL,
};

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
});

async function targetsOf(
  config: "sentry.server.config" | "sentry.edge.config",
): Promise<unknown> {
  jest.resetModules();
  const Sentry = await import("@sentry/nextjs");
  if (config === "sentry.server.config") {
    await import("../../sentry.server.config");
  } else {
    await import("../../sentry.edge.config");
  }
  const init = Sentry.init as unknown as jest.Mock;
  return (init.mock.calls[0][0] as { tracePropagationTargets?: unknown })
    .tracePropagationTargets;
}

describe("the SDK's own default", () => {
  it("propagates to every URL when no targets are set — the reason for this test", () => {
    expect(
      shouldPropagateTraceForUrl("https://scanned.example/", undefined),
    ).toBe(true);
  });
});

describe.each(["sentry.server.config", "sentry.edge.config"] as const)(
  "%s",
  (config) => {
    it("propagates to the app and the realtime origins, and nowhere else", async () => {
      env.NEXT_PUBLIC_APP_URL = "https://www.recopyfa.st";
      env.NEXT_PUBLIC_WS_URL = "wss://recopyfast-ws.fly.dev";

      const targets = (await targetsOf(config)) as RegExp[];

      expect(Array.isArray(targets)).toBe(true);
      const decide = (url: string) => shouldPropagateTraceForUrl(url, targets);
      expect(decide("https://www.recopyfa.st/api/x")).toBe(true);
      expect(decide("https://www.recopyfa.st")).toBe(true);
      expect(decide("https://recopyfast-ws.fly.dev/health")).toBe(true);
      expect(decide("https://scanned.example/")).toBe(false);
      expect(decide("https://www.recopyfa.st.evil.example/")).toBe(false);
      expect(decide("https://evil.example/?u=https://www.recopyfa.st")).toBe(
        false,
      );
      expect(decide("http://169.254.169.254/latest/meta-data/")).toBe(false);
    });
  },
);

describe("tracePropagationTargets", () => {
  it("is empty — propagate nowhere — when no origin is configured", () => {
    expect(tracePropagationTargets({})).toEqual([]);
    expect(shouldPropagateTraceForUrl("https://scanned.example/", [])).toBe(
      false,
    );
  });

  it("accepts a bare host the way resolveSiteUrl does", () => {
    const [target] = tracePropagationTargets({
      NEXT_PUBLIC_APP_URL: "www.recopyfa.st",
    });

    expect(target.test("https://www.recopyfa.st/x")).toBe(true);
  });
});
