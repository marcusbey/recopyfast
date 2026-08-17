/**
 * GET /api/cron/webhook-dispatch — the sweep both halves of ADR 010 depend on.
 *
 * Without this route nothing ever fires: `after()` on the publish path only
 * marks a coalescing window, and a failed delivery only writes a `next_retry_at`.
 * Both are inert until something sweeps them, and on serverless that something
 * cannot be a timer.
 *
 * The secret check is not decoration. This endpoint makes outbound HTTP
 * requests to customer-configured URLs; an unauthenticated caller could drive
 * that at will.
 */

import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { webhookManager } from "@/lib/webhooks/manager";

jest.mock("@/lib/webhooks/manager", () => ({
  ...jest.requireActual("@/lib/webhooks/manager"),
  webhookManager: {
    sweepDueDispatches: jest.fn(),
    sweepDueRetries: jest.fn(),
  },
}));

import { GET } from "@/app/api/cron/webhook-dispatch/route";

const manager = webhookManager as jest.Mocked<typeof webhookManager>;

function cronRequest(authorization?: string) {
  return new NextRequest("https://www.recopyfa.st/api/cron/webhook-dispatch", {
    headers: authorization ? { authorization } : {},
  });
}

describe("GET /api/cron/webhook-dispatch", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    process.env.CRON_SECRET = "cron-secret";
    manager.sweepDueDispatches.mockResolvedValue({ dispatched: 2 });
    manager.sweepDueRetries.mockResolvedValue({ retried: 3 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.CRON_SECRET = originalSecret;
  });

  it("refuses a request with no Authorization header and sweeps nothing", async () => {
    const response = await GET(cronRequest());

    expect(response.status).toBe(401);
    expect(manager.sweepDueDispatches).not.toHaveBeenCalled();
    expect(manager.sweepDueRetries).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret", async () => {
    const response = await GET(cronRequest("Bearer not-the-secret"));

    expect(response.status).toBe(401);
    expect(manager.sweepDueDispatches).not.toHaveBeenCalled();
  });

  it("refuses when no CRON_SECRET is configured, rather than running open", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(cronRequest("Bearer anything"));

    expect(response.status).toBe(401);
    expect(manager.sweepDueDispatches).not.toHaveBeenCalled();
  });

  it("runs both sweeps once and reports both counts", async () => {
    const response = await GET(cronRequest("Bearer cron-secret"));
    const body = (await response.json()) as {
      dispatched: number;
      retried: number;
    };

    expect(response.status).toBe(200);
    expect(manager.sweepDueDispatches).toHaveBeenCalledTimes(1);
    expect(manager.sweepDueRetries).toHaveBeenCalledTimes(1);
    expect(body).toEqual({ dispatched: 2, retried: 3 });
  });

  /**
   * An unscheduled cron route is dead code that reads as a working feature —
   * /api/cron/ab-test-lifecycle has been exactly that since it was written.
   */
  it("is registered in vercel.json, or nothing ever calls it", () => {
    const vercelConfig = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons?: Array<{ path: string; schedule: string }> };

    const entry = (vercelConfig.crons ?? []).find(
      (cron) => cron.path === "/api/cron/webhook-dispatch",
    );

    expect(entry).toBeDefined();
    expect(entry?.schedule).toBe("*/5 * * * *");
  });

  it("still sweeps retries when the dispatch sweep throws", async () => {
    // The two sweeps are independent concerns sharing a tick. One failing must
    // not silently strand the other — a stranded retry sweep means every failed
    // delivery stops retrying, which is the exact failure this story exists to
    // fix.
    manager.sweepDueDispatches.mockRejectedValue(new Error("db down"));

    const response = await GET(cronRequest("Bearer cron-secret"));

    expect(manager.sweepDueRetries).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(500);
  });
});
