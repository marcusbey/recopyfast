#!/usr/bin/env node

/**
 * Matched local backend timing for s62.
 *
 * Owns loopback PostgreSQL and Redis processes and compares the same public
 * payload through (a) fresh site auth + DB page/shared reads and (b) fresh site
 * auth + versioned Redis read. Both paths perform the current awaited liveness
 * UPDATE. This is local backend evidence, never a production TLS/browser claim.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const { RedisPublishedContentCache } = await import(
  path.join(repoRoot, "src/lib/content/published-content-cache.ts")
);

function binary(name, configured) {
  const candidates = [
    configured,
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    name,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {}
  }
  throw new Error(`Could not find ${name}`);
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate loopback port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForPort(port) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Port ${port} did not become ready`);
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summary(values) {
  return {
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    minMs: Number(Math.min(...values).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  };
}

const initdb = binary(
  "initdb",
  process.env.RCF_POSTGRES_BIN &&
    path.join(process.env.RCF_POSTGRES_BIN, "initdb"),
);
const pgCtl = binary(
  "pg_ctl",
  process.env.RCF_POSTGRES_BIN &&
    path.join(process.env.RCF_POSTGRES_BIN, "pg_ctl"),
);
const redisBinary = binary(
  "redis-server",
  process.env.RCF_REDIS_BIN ?? "/usr/local/opt/redis/bin/redis-server",
);
const pgPort = await freePort();
const redisPort = await freePort();
const pgDir = mkdtempSync(path.join(tmpdir(), "recopyfast-s62-measure-pg-"));
const redisDir = mkdtempSync(
  path.join(tmpdir(), "recopyfast-s62-measure-redis-"),
);
let redisProcess;
let pool;

try {
  execFileSync(initdb, ["-D", pgDir, "--username=postgres", "--auth=trust"], {
    stdio: "ignore",
  });
  execFileSync(
    pgCtl,
    ["-D", pgDir, "-o", `-F -p ${pgPort} -h 127.0.0.1`, "-w", "start"],
    { stdio: "ignore" },
  );
  redisProcess = spawn(
    redisBinary,
    [
      "--bind",
      "127.0.0.1",
      "--port",
      String(redisPort),
      "--save",
      "",
      "--appendonly",
      "no",
      "--dir",
      redisDir,
    ],
    { stdio: "ignore" },
  );
  await waitForPort(redisPort);

  pool = new Pool({
    connectionString: `postgresql://postgres@127.0.0.1:${pgPort}/postgres`,
    max: 6,
  });
  await pool.query(`
    CREATE TABLE sites (
      id UUID PRIMARY KEY,
      domain TEXT NOT NULL,
      api_key TEXT NOT NULL,
      public_content_revision UUID NOT NULL,
      last_reported_at TIMESTAMPTZ
    );
    CREATE TABLE content_elements (
      id UUID PRIMARY KEY,
      site_id UUID NOT NULL,
      element_id TEXT NOT NULL,
      selector TEXT NOT NULL,
      published_content TEXT,
      original_content TEXT,
      language TEXT NOT NULL,
      variant TEXT NOT NULL,
      page_path TEXT,
      metadata JSONB NOT NULL,
      published_at TIMESTAMPTZ
    );
    CREATE INDEX content_scope ON content_elements(site_id, language, variant, page_path);
  `);

  const siteId = randomUUID();
  const revision = randomUUID();
  await pool.query(
    "INSERT INTO sites(id, domain, api_key, public_content_revision) VALUES ($1, 'example.com', 'test-key', $2)",
    [siteId, revision],
  );
  // Eight parameters per row; kept explicit to ensure the fixture payload is
  // exactly the same for both measured paths.
  const rowSql = [];
  const rowValues = [];
  for (let index = 0; index < 100; index += 1) {
    const offset = index * 8;
    rowSql.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, 'en', 'default', $${offset + 7}, $${offset + 8}::jsonb, now())`,
    );
    rowValues.push(
      randomUUID(),
      siteId,
      `element-${String(index).padStart(3, "0")}`,
      `#element-${index}`,
      `Published ${index}`,
      `Original ${index}`,
      index < 20 ? null : "/pricing",
      JSON.stringify({ type: "p" }),
    );
  }
  await pool.query(
    `INSERT INTO content_elements (
       id, site_id, element_id, selector, published_content, original_content,
       language, variant, page_path, metadata, published_at
     ) VALUES ${rowSql.join(",")}`,
    rowValues,
  );

  const identity = {
    siteId,
    revision,
    language: "en",
    variant: "default",
    pagePath: "/pricing",
  };
  const redisUrl = `redis://127.0.0.1:${redisPort}`;
  const cache = new RedisPublishedContentCache({ redisUrl });

  async function freshAuth() {
    const { rows } = await pool.query(
      "SELECT id, domain, api_key, public_content_revision FROM sites WHERE id = $1",
      [siteId],
    );
    return rows[0];
  }

  function project(rows) {
    return rows
      .sort(
        (left, right) =>
          left.element_id.localeCompare(right.element_id) ||
          String(left.id).localeCompare(String(right.id)),
      )
      .map((element) => ({
        ...element,
        published_at:
          element.published_at instanceof Date
            ? element.published_at.toISOString()
            : element.published_at,
        current_content:
          element.published_content ?? element.original_content ?? "",
      }));
  }

  async function dbPath() {
    await freshAuth();
    const [page, shared] = await Promise.all([
      pool.query(
        `SELECT id, site_id, element_id, selector, published_content,
                original_content, language, variant, page_path, metadata, published_at
           FROM content_elements
          WHERE site_id = $1 AND language = 'en' AND variant = 'default'
            AND page_path = '/pricing'
          ORDER BY element_id, id`,
        [siteId],
      ),
      pool.query(
        `SELECT id, site_id, element_id, selector, published_content,
                original_content, language, variant, page_path, metadata, published_at
           FROM content_elements
          WHERE site_id = $1 AND language = 'en' AND variant = 'default'
            AND page_path IS NULL
          ORDER BY element_id, id`,
        [siteId],
      ),
    ]);
    await pool.query(
      "UPDATE sites SET last_reported_at = now() WHERE id = $1",
      [siteId],
    );
    return project([...page.rows, ...shared.rows]);
  }

  async function cachePath() {
    await freshAuth();
    const rows = await cache.read(identity);
    await pool.query(
      "UPDATE sites SET last_reported_at = now() WHERE id = $1",
      [siteId],
    );
    if (rows === null) throw new Error("warm cache unexpectedly missed");
    return rows;
  }

  const expected = await dbPath();
  const fillStarted = performance.now();
  if (!(await cache.write(identity, expected))) {
    throw new Error("fixture cache fill failed");
  }
  const fillMs = performance.now() - fillStarted;

  const dbTimes = [];
  const cacheTimes = [];
  for (let index = 0; index < 20; index += 1) {
    const order = index % 2 === 0 ? ["db", "cache"] : ["cache", "db"];
    for (const pathName of order) {
      const started = performance.now();
      const rows = pathName === "db" ? await dbPath() : await cachePath();
      const elapsed = performance.now() - started;
      if (!isDeepStrictEqual(rows, expected)) {
        throw new Error(`${pathName} payload differed from matched fixture`);
      }
      (pathName === "db" ? dbTimes : cacheTimes).push(elapsed);
    }
  }

  const unusedPort = await freePort();
  const timeoutCache = new RedisPublishedContentCache({
    redisUrl: `redis://127.0.0.1:${unusedPort}`,
  });
  const timeoutStarted = performance.now();
  const timeoutResult = await timeoutCache.read({
    ...identity,
    revision: randomUUID(),
  });
  const timeoutMs = performance.now() - timeoutStarted;
  if (timeoutResult !== null)
    throw new Error("unreachable Redis was not a miss");

  console.log(
    JSON.stringify(
      {
        evidence: "local-loopback-only",
        pairs: 20,
        rows: expected.length,
        payloadBytes: Buffer.byteLength(JSON.stringify(expected), "utf8"),
        db: summary(dbTimes),
        warmCache: summary(cacheTimes),
        initialFillMs: Number(fillMs.toFixed(3)),
        unreachableRedisMissMs: Number(timeoutMs.toFixed(3)),
        includesFreshAuthAndAwaitedLiveness: true,
        excludesBrowserTlsPreflightRuntimeHydration: true,
      },
      null,
      2,
    ),
  );
  cache.close();
  timeoutCache.close();
} finally {
  if (pool) await pool.end().catch(() => undefined);
  if (redisProcess && redisProcess.exitCode === null) {
    redisProcess.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        redisProcess.kill("SIGKILL");
        resolve();
      }, 2000);
      redisProcess.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  try {
    execFileSync(pgCtl, ["-D", pgDir, "-m", "fast", "-w", "stop"], {
      stdio: "ignore",
    });
  } catch {}
  rmSync(pgDir, { recursive: true, force: true });
  rmSync(redisDir, { recursive: true, force: true });
}
