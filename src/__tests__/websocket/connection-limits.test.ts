/**
 * @jest-environment node
 */

import { EventEmitter } from "node:events";

import {
  createConnectionLimiter,
  resolveRequestAddress,
} from "../../../server/connection-limits.js";
import {
  createMemoryRateLimitStore,
  createRateLimiter,
} from "../../../server/rate-limit.js";

function request(address: string, flyAddress?: string) {
  const socket = new EventEmitter() as EventEmitter & { remoteAddress: string };
  socket.remoteAddress = address;
  const req = new EventEmitter() as EventEmitter & {
    headers: Record<string, string>;
    socket: typeof socket;
  };
  req.headers = flyAddress ? { "fly-client-ip": flyAddress } : {};
  req.socket = socket;
  return { req, socket };
}

describe("realtime transport connection limits", () => {
  it("counts overlapping pending and established transports and releases idempotently", () => {
    const limiter = createConnectionLimiter({
      maxConcurrentTransportsPerAddress: 2,
    });
    const first = request("203.0.113.1");
    const second = request("203.0.113.1");
    const third = request("203.0.113.1");

    const a = limiter.reserve(first.req);
    const b = limiter.reserve(second.req);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(limiter.reserve(third.req).allowed).toBe(false);

    const engine = new EventEmitter();
    expect(limiter.transfer(first.req, engine)).toBe(true);
    second.req.emit("aborted");
    expect(limiter.reserve(third.req).allowed).toBe(true);

    engine.emit("close");
    a.release?.();
    expect(limiter.count("203.0.113.1")).toBe(1);
    third.socket.emit("close");
    expect(limiter.count("203.0.113.1")).toBe(0);
    expect(limiter.size).toBe(0);
  });

  it("releases failed, errored, timed-out and shutdown reservations", () => {
    jest.useFakeTimers();
    const limiter = createConnectionLimiter({
      maxConcurrentTransportsPerAddress: 5,
      reservationTimeoutMs: 100,
    });
    const failed = request("203.0.113.2");
    const errored = request("203.0.113.2");
    const closed = request("203.0.113.2");
    const timedOut = request("203.0.113.2");

    limiter.reserve(failed.req);
    limiter.reserve(errored.req);
    limiter.reserve(closed.req);
    limiter.reserve(timedOut.req);
    failed.req.emit("aborted");
    errored.req.emit("error", new Error("upgrade failed"));
    closed.socket.emit("close");
    jest.advanceTimersByTime(101);
    expect(limiter.size).toBe(0);

    limiter.reserve(request("203.0.113.3").req);
    limiter.releaseAll();
    expect(limiter.size).toBe(0);
    jest.useRealTimers();
  });

  it("normalizes mapped IPv4, IPv6 /64 and untrusted Fly headers", () => {
    const mapped = request("::ffff:203.0.113.7");
    const ipv4 = request("203.0.113.7");
    const ipv6a = request("2001:db8:abcd:12::1");
    const ipv6b = request("2001:db8:abcd:12::ffff");
    const forged = request("198.51.100.9", "192.0.2.40");

    expect(resolveRequestAddress(mapped.req, { trustFlyClientIp: false })).toBe(
      resolveRequestAddress(ipv4.req, { trustFlyClientIp: false }),
    );
    expect(resolveRequestAddress(ipv6a.req, { trustFlyClientIp: false })).toBe(
      resolveRequestAddress(ipv6b.req, { trustFlyClientIp: false }),
    );
    expect(resolveRequestAddress(forged.req, { trustFlyClientIp: false })).toBe(
      "198.51.100.9",
    );
    expect(resolveRequestAddress(forged.req, { trustFlyClientIp: true })).toBe(
      "192.0.2.40",
    );
  });
});

describe("content-map fixed-window site budgets", () => {
  it("permits the documented adjacent-window burst and isolates sites", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-28T12:00:59.999Z"));
    const limiter = createRateLimiter({
      store: createMemoryRateLimitStore(),
      limits: { maxContentMapsPerSite: 1 },
    });

    await expect(
      limiter.checkContentMap({ siteId: "site-a" }),
    ).resolves.toMatchObject({
      allowed: true,
    });
    await expect(
      limiter.checkContentMap({ siteId: "site-a" }),
    ).resolves.toMatchObject({
      allowed: false,
    });
    await expect(
      limiter.checkContentMap({ siteId: "site-b" }),
    ).resolves.toMatchObject({
      allowed: true,
    });

    jest.advanceTimersByTime(1);
    await expect(
      limiter.checkContentMap({ siteId: "site-a" }),
    ).resolves.toMatchObject({
      allowed: true,
    });
    jest.useRealTimers();
  });
});
