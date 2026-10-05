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
import {
  createServer,
  createConnection,
  type Server,
  type Socket,
} from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "redis";
import {
  PUBLIC_CONTENT_CACHE_COMMAND_QUEUE_MAX_LENGTH,
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

type RespCommand = {
  args: string[];
  consumedBytes: number;
};

function parseRespCommand(input: Buffer): RespCommand | null {
  if (input.length === 0) return null;
  if (input[0] !== 0x2a) throw new Error("Expected a RESP array command");
  const countEnd = input.indexOf("\r\n", 1);
  if (countEnd === -1) return null;
  const count = Number(input.subarray(1, countEnd).toString("ascii"));
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Invalid RESP array length");
  }

  let offset = countEnd + 2;
  const args: string[] = [];
  for (let index = 0; index < count; index += 1) {
    if (offset >= input.length) return null;
    if (input[offset] !== 0x24) throw new Error("Expected a RESP bulk string");
    const lengthEnd = input.indexOf("\r\n", offset + 1);
    if (lengthEnd === -1) return null;
    const length = Number(
      input.subarray(offset + 1, lengthEnd).toString("ascii"),
    );
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error("Invalid RESP bulk-string length");
    }
    const valueStart = lengthEnd + 2;
    const valueEnd = valueStart + length;
    if (input.length < valueEnd + 2) return null;
    if (input[valueEnd] !== 0x0d || input[valueEnd + 1] !== 0x0a) {
      throw new Error("Invalid RESP bulk-string terminator");
    }
    args.push(input.subarray(valueStart, valueEnd).toString("utf8"));
    offset = valueEnd + 2;
  }

  return { args, consumedBytes: offset };
}

function bulkReply(value: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`$${value.length}\r\n`, "ascii"),
    value,
    Buffer.from("\r\n", "ascii"),
  ]);
}

type StalledRespPeer = {
  redisUrl: string;
  connectionCount: () => number;
  dataCommandCount: () => number;
  holdDataReplies: () => void;
  releaseDataReplies: () => void;
  close: () => Promise<void>;
};

async function startStalledRespPeer(
  recoveryValue: Buffer,
): Promise<StalledRespPeer> {
  const sockets = new Set<Socket>();
  const held: Array<{ socket: Socket; command: string }> = [];
  let shouldHold = false;
  let connectionCount = 0;
  let dataCommandCount = 0;

  const server: Server = createServer((socket) => {
    connectionCount += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffered = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (true) {
        const parsed = parseRespCommand(buffered);
        if (!parsed) break;
        buffered = buffered.subarray(parsed.consumedBytes);
        const command = parsed.args[0]?.toUpperCase();

        if (command === "CLIENT") {
          socket.write("+OK\r\n");
        } else if (command === "GETRANGE" || command === "SET") {
          if (shouldHold) {
            dataCommandCount += 1;
            held.push({ socket, command });
          } else if (command === "GETRANGE") {
            socket.write(bulkReply(recoveryValue));
          } else {
            socket.write("+OK\r\n");
          }
        } else {
          socket.write("-ERR unsupported test command\r\n");
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("RESP peer could not allocate a loopback port");
  }

  return {
    redisUrl: `redis://127.0.0.1:${address.port}`,
    connectionCount: () => connectionCount,
    dataCommandCount: () => dataCommandCount,
    holdDataReplies: () => {
      shouldHold = true;
    },
    releaseDataReplies: () => {
      shouldHold = false;
      for (const pending of held.splice(0)) {
        pending.socket.write(
          pending.command === "GETRANGE" ? "$-1\r\n" : "+OK\r\n",
        );
      }
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
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

describe("published content cache with a stalled ready RESP peer", () => {
  it("bounds mixed waiting commands and recovers on the same client", async () => {
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
    const recoveryEnvelope = Buffer.from(
      JSON.stringify({
        format: "rcf-public-content-v1",
        identity,
        rows,
      }),
    );
    const peer = await startStalledRespPeer(recoveryEnvelope);
    const cache = new RedisPublishedContentCache({ redisUrl: peer.redisUrl });
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      // Use the deferred-write budget to establish the ready socket. The
      // behavior under test starts after connection, so a slow CI handshake
      // must not consume the visitor read budget before the peer is stalled.
      await expect(cache.write(identity, rows)).resolves.toBe(true);
      peer.holdDataReplies();

      const attempts = Array.from({ length: 40 }, (_, index) =>
        index % 2 === 0 ? cache.read(identity) : cache.write(identity, rows),
      );
      const results = await Promise.all(attempts);

      for (const [index, result] of results.entries()) {
        expect(result).toBe(index % 2 === 0 ? null : false);
      }
      expect(peer.dataCommandCount()).toBe(
        PUBLIC_CONTENT_CACHE_COMMAND_QUEUE_MAX_LENGTH,
      );

      peer.releaseDataReplies();
      await new Promise((resolve) => setTimeout(resolve, 25));
      await expect(cache.read(identity)).resolves.toEqual(rows);
      expect(peer.connectionCount()).toBe(1);
    } finally {
      errorLog.mockRestore();
      cache.close();
      await peer.close();
    }
  });
});
