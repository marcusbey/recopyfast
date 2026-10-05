import {
  PUBLIC_CONTENT_CACHE_MAX_BYTES,
  RedisPublishedContentCache,
  buildPublicContentCacheKey,
  isPublicContentCacheEnabled,
  type PublicContentCacheIdentity,
  type PublicContentRow,
} from "@/lib/content/published-content-cache";

const identity: PublicContentCacheIdentity = {
  siteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  revision: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  language: "en",
  variant: "default",
  pagePath: "/pricing",
};

const row: PublicContentRow = {
  id: "row-1",
  site_id: identity.siteId,
  element_id: "hero",
  selector: "h1",
  published_content: "Published",
  original_content: "Original",
  current_content: "Published",
  language: identity.language,
  variant: identity.variant,
  page_path: identity.pagePath,
  metadata: { type: "h1" },
  published_at: "2026-10-05T00:00:00.000Z",
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeClient() {
  return {
    isOpen: false,
    isReady: false,
    connect: jest.fn(async function (this: {
      isOpen: boolean;
      isReady: boolean;
    }) {
      this.isOpen = true;
      this.isReady = true;
    }),
    destroy: jest.fn(),
    on: jest.fn(),
    getRange: jest.fn<Promise<Buffer | null>, [string, number, number]>(),
    set: jest.fn<
      Promise<string | null>,
      [string, string, { expiration: { type: "EX"; value: number } }]
    >(),
  };
}

function envelope(rows: unknown, override: Record<string, unknown> = {}) {
  return Buffer.from(
    JSON.stringify({
      format: "rcf-public-content-v1",
      identity,
      rows,
      ...override,
    }),
  );
}

describe("published content cache", () => {
  const originalFlag = process.env.PUBLIC_CONTENT_CACHE_ENABLED;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.PUBLIC_CONTENT_CACHE_ENABLED;
    } else {
      process.env.PUBLIC_CONTENT_CACHE_ENABLED = originalFlag;
    }
    jest.restoreAllMocks();
  });

  it("enables only for the exact internal true value", () => {
    for (const value of [undefined, "", "1", "TRUE", " true", "false"]) {
      if (value === undefined) delete process.env.PUBLIC_CONTENT_CACHE_ENABLED;
      else process.env.PUBLIC_CONTENT_CACHE_ENABLED = value;
      expect(isPublicContentCacheEnabled()).toBe(false);
    }
    process.env.PUBLIC_CONTENT_CACHE_ENABLED = "true";
    expect(isPublicContentCacheEnabled()).toBe(true);
  });

  it("hashes the full identity and keeps null scope distinct from root", () => {
    const key = buildPublicContentCacheKey(identity);

    expect(key).toMatch(/^public_content:v1:[a-f0-9]{64}$/);
    expect(
      buildPublicContentCacheKey({ ...identity, pagePath: null }),
    ).not.toBe(buildPublicContentCacheKey({ ...identity, pagePath: "/" }));
    for (const changed of [
      { revision: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      { language: "fr" },
      { variant: "mobile" },
      { siteId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
    ]) {
      expect(buildPublicContentCacheKey({ ...identity, ...changed })).not.toBe(
        key,
      );
    }
  });

  it("distinguishes a cached empty array from a miss", async () => {
    const client = fakeClient();
    client.getRange
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(Buffer.alloc(0));
    const cache = new RedisPublishedContentCache({
      redisUrl: "redis://cache.test:6379",
      createClient: () => client,
    });

    await expect(cache.read(identity)).resolves.toEqual([]);
    await expect(cache.read(identity)).resolves.toBeNull();
    expect(client.getRange).toHaveBeenCalledWith(
      buildPublicContentCacheKey(identity),
      0,
      PUBLIC_CONTENT_CACHE_MAX_BYTES,
    );
  });

  it("rebuilds only whitelisted public rows", async () => {
    const client = fakeClient();
    client.getRange.mockResolvedValue(
      envelope([{ ...row, unexpected: "drop-me" }]),
    );
    const cache = new RedisPublishedContentCache({
      redisUrl: "redis://cache.test:6379",
      createClient: () => client,
    });

    const cached = await cache.read(identity);

    expect(cached).toEqual([row]);
    expect(cached?.[0]).not.toHaveProperty("unexpected");
  });

  it.each([
    ["wrong site", [{ ...row, site_id: "other-site" }]],
    ["wrong language", [{ ...row, language: "fr" }]],
    ["wrong variant", [{ ...row, variant: "mobile" }]],
    ["wrong scoped path", [{ ...row, page_path: "/other" }]],
    [
      "staging metadata",
      [{ ...row, metadata: { staging_attributes: { href: "/draft" } } }],
    ],
    ["private field", [{ ...row, staging_content: "draft" }]],
  ])(
    "rejects %s instead of serving a corrupted entry",
    async (_label, rows) => {
      const client = fakeClient();
      client.getRange.mockResolvedValue(envelope(rows));
      const cache = new RedisPublishedContentCache({
        redisUrl: "redis://cache.test:6379",
        createClient: () => client,
      });

      await expect(cache.read(identity)).resolves.toBeNull();
    },
  );

  it("allows any row path for the legacy all-site scope", async () => {
    const client = fakeClient();
    const legacyIdentity = { ...identity, pagePath: null };
    client.getRange.mockResolvedValue(
      envelope(
        [
          { ...row, page_path: "/one" },
          { ...row, id: "row-2", element_id: "shared", page_path: null },
        ],
        { identity: legacyIdentity },
      ),
    );
    const cache = new RedisPublishedContentCache({
      redisUrl: "redis://cache.test:6379",
      createClient: () => client,
    });

    await expect(cache.read(legacyIdentity)).resolves.toHaveLength(2);
  });

  it("reads at most MAX+1 bytes and rejects an oversized value before parsing", async () => {
    const client = fakeClient();
    client.getRange.mockResolvedValue(
      Buffer.alloc(PUBLIC_CONTENT_CACHE_MAX_BYTES + 1, 0x7b),
    );
    const cache = new RedisPublishedContentCache({
      redisUrl: "redis://cache.test:6379",
      createClient: () => client,
    });
    const parse = jest.spyOn(JSON, "parse");

    await expect(cache.read(identity)).resolves.toBeNull();
    expect(parse).not.toHaveBeenCalled();
  });

  it("does not construct a client without REDIS_URL", async () => {
    const factory = jest.fn(() => fakeClient());
    const cache = new RedisPublishedContentCache({
      redisUrl: undefined,
      createClient: factory,
    });

    await expect(cache.read(identity)).resolves.toBeNull();
    await expect(cache.write(identity, [row])).resolves.toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });

  it("redacts connection errors and degrades them to a miss", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    const cache = new RedisPublishedContentCache({
      redisUrl: "rediss://user:secret@cache.test:6379",
      createClient: () => {
        throw new Error("rediss://user:secret@cache.test:6379 refused");
      },
    });

    await expect(cache.read(identity)).resolves.toBeNull();
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

  it("bounds connect plus GETRANGE to the visitor budget", async () => {
    jest.useFakeTimers();
    const client = fakeClient();
    const connection = deferred<void>();
    client.connect.mockReturnValue(connection.promise);
    const cache = new RedisPublishedContentCache({
      redisUrl: "redis://cache.test:6379",
      createClient: () => client,
      readBudgetMs: 30,
    });

    const read = cache.read(identity);
    await jest.advanceTimersByTimeAsync(31);
    await expect(read).resolves.toBeNull();
    expect(client.getRange).not.toHaveBeenCalled();
    expect(client.destroy).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("shares one cold connection across simultaneous readers", async () => {
    const client = fakeClient();
    const connection = deferred<void>();
    client.connect.mockImplementation(async () => {
      await connection.promise;
      client.isOpen = true;
      client.isReady = true;
    });
    client.getRange.mockResolvedValue(envelope([row]));
    const cache = new RedisPublishedContentCache({
      redisUrl: "redis://cache.test:6379",
      createClient: () => client,
    });

    const first = cache.read(identity);
    const second = cache.read(identity);
    connection.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual([[row], [row]]);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("lets a timed-out visitor connect warm the later deferred write", async () => {
    jest.useFakeTimers();
    const client = fakeClient();
    const connection = deferred<void>();
    client.connect.mockImplementation(async () => {
      await connection.promise;
      client.isOpen = true;
      client.isReady = true;
    });
    client.set.mockResolvedValue("OK");
    const cache = new RedisPublishedContentCache({
      redisUrl: "redis://cache.test:6379",
      createClient: () => client,
      readBudgetMs: 30,
      writeBudgetMs: 250,
    });

    const read = cache.read(identity);
    await jest.advanceTimersByTimeAsync(31);
    await expect(read).resolves.toBeNull();
    expect(client.destroy).not.toHaveBeenCalled();

    const write = cache.write(identity, [row]);
    connection.resolve();
    await expect(write).resolves.toBe(true);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.set).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("writes with a five-minute TTL inside the deferred budget", async () => {
    const client = fakeClient();
    client.set.mockResolvedValue("OK");
    const cache = new RedisPublishedContentCache({
      redisUrl: "redis://cache.test:6379",
      createClient: () => client,
    });

    await expect(cache.write(identity, [row])).resolves.toBe(true);
    expect(client.set).toHaveBeenCalledWith(
      buildPublicContentCacheKey(identity),
      expect.any(String),
      { expiration: { type: "EX", value: 300 } },
    );
  });

  it("skips an oversized write without truncating the public response", async () => {
    const client = fakeClient();
    const cache = new RedisPublishedContentCache({
      redisUrl: "redis://cache.test:6379",
      createClient: () => client,
    });
    const oversized = [
      { ...row, current_content: "x".repeat(PUBLIC_CONTENT_CACHE_MAX_BYTES) },
    ];

    await expect(cache.write(identity, oversized)).resolves.toBe(false);
    expect(client.set).not.toHaveBeenCalled();
  });

  it("bounds a stalled deferred SET without destroying the shared client", async () => {
    jest.useFakeTimers();
    const client = fakeClient();
    client.set.mockReturnValue(new Promise(() => {}));
    const cache = new RedisPublishedContentCache({
      redisUrl: "redis://cache.test:6379",
      createClient: () => client,
      writeBudgetMs: 250,
    });

    const write = cache.write(identity, [row]);
    await jest.advanceTimersByTimeAsync(251);
    await expect(write).resolves.toBe(false);
    expect(client.destroy).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("closes only its owned client", async () => {
    const client = fakeClient();
    client.set.mockResolvedValue("OK");
    const cache = new RedisPublishedContentCache({
      redisUrl: "redis://cache.test:6379",
      createClient: () => client,
    });
    await cache.write(identity, [row]);

    cache.close();

    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
});
