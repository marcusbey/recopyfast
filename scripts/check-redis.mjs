#!/usr/bin/env node
/**
 * Proves a REDIS_URL actually works before you trust it in production.
 *
 * Why this exists: the rate-limit store died silently. The hostname stopped
 * resolving, and nothing noticed until the endpoints that fail CLOSED — editor
 * login, staging verification, site registration — started returning 503. A
 * dead store is indistinguishable from a working one until traffic hits it, so
 * this makes the check explicit and cheap to repeat.
 *
 * Usage:
 *   node scripts/check-redis.mjs                  # uses REDIS_URL from .env
 *   node scripts/check-redis.mjs <redis-url>      # checks a URL directly
 *
 * Exits non-zero on any failure so it can gate a deploy.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookup } from "node:dns/promises";
import { createClient } from "redis";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Never print the password — only ever the part that is safe to paste. */
function redact(url) {
  return url.replace(/(rediss?:\/\/)[^@]*@/, "$1<redacted>@");
}

async function resolveUrl() {
  const fromArg = process.argv[2];
  if (fromArg) return fromArg;
  if (process.env.REDIS_URL) return process.env.REDIS_URL;

  for (const file of [".env.local", ".env"]) {
    try {
      const text = await readFile(path.join(ROOT, file), "utf8");
      const match = text.match(/^REDIS_URL=(.+)$/m);
      if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    } catch {
      // File absent; try the next one.
    }
  }
  return null;
}

const steps = [];
function record(name, ok, detail) {
  steps.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const url = await resolveUrl();
  if (!url) {
    console.error(
      "No REDIS_URL found. Pass one as an argument, export it, or set it in .env",
    );
    process.exit(1);
  }

  console.log(`Checking ${redact(url)}\n`);

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    record("URL parses", false, "malformed connection string");
    process.exit(1);
  }
  record("URL parses", true, `${parsed.protocol}//${parsed.hostname}:${parsed.port}`);

  if (parsed.protocol !== "rediss:") {
    console.log(
      "  note  scheme is redis:// (no TLS). Upstash and Redis Cloud both want rediss://",
    );
  }

  // DNS first: this is the exact failure that took the last instance down, and
  // its error ("nodename nor servname provided") is otherwise cryptic.
  try {
    const { address } = await lookup(parsed.hostname);
    record("DNS resolves", true, address);
  } catch (error) {
    record("DNS resolves", false, `${parsed.hostname} has no address record`);
    console.error(
      "\nThe host does not exist. The instance was deleted, or the URL is wrong.",
    );
    process.exit(1);
  }

  const client = createClient({ url, socket: { connectTimeout: 5000 } });
  client.on("error", () => {
    // Handled via the awaited promises below; an unhandled 'error' event on the
    // EventEmitter would crash the process before this script can report.
  });

  try {
    await client.connect();
    record("connect + auth", true);
  } catch (error) {
    record("connect + auth", false, error.message);
    process.exit(1);
  }

  try {
    const pong = await client.ping();
    record("PING", pong === "PONG", pong);
  } catch (error) {
    record("PING", false, error.message);
  }

  // Exercise the real command shape the limiter uses (INCR + EXPIRE pipeline)
  // rather than just proving the socket is open.
  const probeKey = `rate_limit:__healthcheck__:${process.pid}`;
  try {
    const results = await client.multi().incr(probeKey).expire(probeKey, 10).exec();
    const count = Number(results?.[0]);
    record(
      "INCR + EXPIRE pipeline",
      Number.isFinite(count) && count >= 1,
      `counter=${count}`,
    );
    await client.del(probeKey);
  } catch (error) {
    record("INCR + EXPIRE pipeline", false, error.message);
  }

  await client.destroy();

  const failed = steps.filter((s) => !s.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }

  console.log(
    "\nAll checks passed. Rate limiting will work against this instance.",
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
