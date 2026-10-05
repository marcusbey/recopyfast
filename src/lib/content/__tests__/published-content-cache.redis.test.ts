/**
 * Real node-redis/Redis 7 proof for the optional published-content cache.
 *
 * The suite owns a loopback process, random port and temporary directory. It
 * never reads REDIS_URL and skips cleanly where the explicit binary is absent.
 * Local timings prove command behavior only; they do not predict production
 * TLS or network latency.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "redis";
import {
  PUBLIC_CONTENT_CACHE_MAX_BYTES,
  PUBLIC_CONTENT_CACHE_TTL_SECONDS,
  RedisPublishedContentCache,
  buildPublicContentCacheKey,
  type PublicContentCacheIdentity,
  type PublicContentRow,
} from "@/lib/content/published-content-cache";

const REDIS_BINARY =
  process.env.RCF_REDIS_BIN ?? "/usr/local/opt/redis/bin/redis-server";
const describeRedis = existsSync(REDIS_BINARY) ? describe : describe.skip;

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Redis test could not allocate a loopback port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const opened = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (opened) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Owned Redis process did not accept loopback connections");
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describeRedis("published content cache with owned Redis", () => {
  let child: ChildProcess;
  let dataDir: string;
  let redisUrl: string;

  beforeAll(async () => {
    const port = await freePort();
    dataDir = mkdtempSync(path.join(tmpdir(), "recopyfast-s62-redis-"));
    child = spawn(
      REDIS_BINARY,
      [
        "--bind",
        "127.0.0.1",
        "--port",
        String(port),
        "--save",
        "",
        "--appendonly",
        "no",
        "--dir",
        dataDir,
      ],
      { stdio: "ignore" },
    );
    redisUrl = `redis://127.0.0.1:${port}`;
    await waitForPort(port);
  });

  afterAll(async () => {
    await stop(child);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("round-trips bounded bytes, applies TTL and expires cleanly", async () => {
    const identity: PublicContentCacheIdentity = {
      siteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      revision: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      language: "en",
      variant: "default",
      pagePath: "/",
    };
    const rows: PublicContentRow[] = [
      {
        id: "row-1",
        site_id: identity.siteId,
        element_id: "hero",
        selector: "h1",
        published_content: "Published",
        original_content: "Original",
        current_content: "Published",
        language: "en",
        variant: "default",
        page_path: "/",
        metadata: {},
        published_at: null,
      },
    ];
    const cache = new RedisPublishedContentCache({ redisUrl });

    await expect(cache.write(identity, rows)).resolves.toBe(true);
    await expect(cache.read(identity)).resolves.toEqual(rows);

    const inspector = createClient({ url: redisUrl });
    await inspector.connect();
    try {
      const key = buildPublicContentCacheKey(identity);
      const stored = await inspector.getRange(
        key,
        0,
        PUBLIC_CONTENT_CACHE_MAX_BYTES,
      );
      if (stored === null) throw new Error("Redis cache key disappeared");
      expect(Buffer.byteLength(stored, "utf8")).toBeLessThanOrEqual(
        PUBLIC_CONTENT_CACHE_MAX_BYTES,
      );
      expect(stored).toContain("rcf-public-content-v1");
      expect(await inspector.ttl(key)).toBeGreaterThanOrEqual(
        PUBLIC_CONTENT_CACHE_TTL_SECONDS - 1,
      );

      await inspector.expire(key, 1);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await expect(cache.read(identity)).resolves.toBeNull();
    } finally {
      cache.close();
      await inspector.quit();
    }
  });
});
