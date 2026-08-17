import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getStaleAfterMs,
  markSiteLive,
  recordSiteReport,
  resolveEffectiveSiteStatus,
} from "@/lib/sites/site-status";

/**
 * The one place staleness is decided.
 *
 * `stale` is never a column value — ADR 006 persists `awaiting-install` and
 * `live` only, and derives the third state here from `last_reported_at`. Every
 * consumer reads the already-resolved string, so if this function is wrong, it
 * is wrong identically everywhere, which is the point: the alternative was six
 * call sites each subtracting their own dates.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-16T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

describe("resolveEffectiveSiteStatus", () => {
  it.each([
    [
      "a site that has never reported",
      { status: "awaiting-install", last_reported_at: null },
      "awaiting-install",
    ],
    [
      "a site that has never reported but somehow carries a timestamp",
      { status: "awaiting-install", last_reported_at: daysAgo(0) },
      "awaiting-install",
    ],
    [
      "a live site that reported this morning",
      { status: "live", last_reported_at: daysAgo(0) },
      "live",
    ],
    [
      "a live site that reported just inside the window",
      { status: "live", last_reported_at: daysAgo(13) },
      "live",
    ],
    [
      "a live site that has been quiet past the window",
      { status: "live", last_reported_at: daysAgo(30) },
      "stale",
    ],
    [
      "a site with no status at all",
      { status: null, last_reported_at: null },
      "awaiting-install",
    ],
  ])("resolves %s to %s", (_label, fields, expected) => {
    expect(resolveEffectiveSiteStatus(fields, NOW)).toBe(expected);
  });

  /**
   * The false-stale trap. A site backfilled from `content_elements` rows whose
   * `created_at` was null lands as `live` with no `last_reported_at`, and so
   * does any future write path that flips the status without dating it.
   * "We have no idea when you last reported" is not "you have gone quiet" —
   * inventing an alarm from missing data is worse than staying silent.
   */
  it("does not invent staleness from a missing timestamp", () => {
    expect(
      resolveEffectiveSiteStatus({ status: "live", last_reported_at: null }),
    ).toBe("live");
  });

  it("does not invent staleness from an unparseable timestamp", () => {
    expect(
      resolveEffectiveSiteStatus(
        { status: "live", last_reported_at: "not a date" },
        NOW,
      ),
    ).toBe("live");
  });
});

describe("the staleness window", () => {
  const originalWindow = process.env.SITE_STALE_AFTER_DAYS;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete process.env.SITE_STALE_AFTER_DAYS;
    } else {
      process.env.SITE_STALE_AFTER_DAYS = originalWindow;
    }
  });

  it("defaults to fourteen days", () => {
    delete process.env.SITE_STALE_AFTER_DAYS;

    expect(getStaleAfterMs()).toBe(14 * DAY_MS);
  });

  it("is configurable, and moves the boundary with it", () => {
    process.env.SITE_STALE_AFTER_DAYS = "2";

    expect(getStaleAfterMs()).toBe(2 * DAY_MS);
    expect(
      resolveEffectiveSiteStatus(
        { status: "live", last_reported_at: daysAgo(3) },
        NOW,
      ),
    ).toBe("stale");
  });

  it.each([
    ["nonsense", "soon"],
    ["zero", "0"],
    ["negative", "-5"],
  ])(
    "ignores a %s override rather than never (or always) going stale",
    (_label, value) => {
      process.env.SITE_STALE_AFTER_DAYS = value;

      expect(getStaleAfterMs()).toBe(14 * DAY_MS);
    },
  );
});

/**
 * The two writes, against a mocked client.
 *
 * Both are called from the widget's own request path, where the site token is
 * the credential — so they run under the service-role client and must touch
 * nothing but the one row they name.
 */
type ChainCall = { method: string; args: unknown[] };

function mockClient(result: { error: unknown } = { error: null }) {
  const calls: ChainCall[] = [];
  const builder: Record<string, unknown> = {};

  for (const method of ["update", "eq"]) {
    builder[method] = jest.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    });
  }
  builder.then = (
    resolve: (value: { error: unknown }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);

  const from = jest.fn((table: string) => {
    calls.push({ method: "from", args: [table] });
    return builder;
  });

  return {
    client: { from } as unknown as SupabaseClient,
    calls,
  };
}

describe("markSiteLive", () => {
  it("flips the site to live and dates both the transition and the report", async () => {
    const { client, calls } = mockClient();

    await markSiteLive(client, "site-123", NOW);

    expect(calls[0]).toEqual({ method: "from", args: ["sites"] });
    expect(calls[1]).toEqual({
      method: "update",
      args: [
        {
          status: "live",
          live_at: NOW.toISOString(),
          last_reported_at: NOW.toISOString(),
        },
      ],
    });
  });

  /**
   * Write-once, enforced in the WHERE clause and not in a read-then-write.
   *
   * `live_at` is the answer to "when did this site first come up", which s03
   * reads as an activation milestone. Two concurrent first reports — two
   * visitors landing at the same moment — would both see `awaiting-install` if
   * this checked first and wrote second. The guard makes the second update
   * match zero rows instead.
   */
  it("only ever writes to a site that is still awaiting install", async () => {
    const { client, calls } = mockClient();

    await markSiteLive(client, "site-123", NOW);

    expect(calls).toContainEqual({ method: "eq", args: ["id", "site-123"] });
    expect(calls).toContainEqual({
      method: "eq",
      args: ["status", "awaiting-install"],
    });
  });

  it("never writes the word stale", async () => {
    const { client, calls } = mockClient();

    await markSiteLive(client, "site-123", NOW);

    expect(JSON.stringify(calls)).not.toContain("stale");
  });

  it("surfaces a write failure to its caller", async () => {
    const { client } = mockClient({ error: { message: "connection lost" } });

    await expect(markSiteLive(client, "site-123", NOW)).rejects.toThrow();
  });
});

describe("recordSiteReport", () => {
  it("bumps last_reported_at on the named site and nothing else", async () => {
    const { client, calls } = mockClient();

    await recordSiteReport(client, "site-123", NOW);

    expect(calls[0]).toEqual({ method: "from", args: ["sites"] });
    expect(calls[1]).toEqual({
      method: "update",
      args: [{ last_reported_at: NOW.toISOString() }],
    });
    expect(calls[2]).toEqual({ method: "eq", args: ["id", "site-123"] });
  });

  /**
   * Unconditional, unlike markSiteLive. This is the "still alive" signal and it
   * has to keep landing for a site that is already live — that is the only
   * thing that ever moves a site back out of `stale`.
   */
  it("does not gate on the site's current status", async () => {
    const { client, calls } = mockClient();

    await recordSiteReport(client, "site-123", NOW);

    expect(calls).not.toContainEqual({
      method: "eq",
      args: ["status", "awaiting-install"],
    });
  });

  it("surfaces a write failure to its caller", async () => {
    const { client } = mockClient({ error: { message: "connection lost" } });

    await expect(recordSiteReport(client, "site-123", NOW)).rejects.toThrow();
  });
});
