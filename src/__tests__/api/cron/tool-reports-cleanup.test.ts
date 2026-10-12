/**
 * @jest-environment node
 */

/**
 * s96 — the daily cleanup of `tool_reports`: expired rows, then the oldest
 * past the 5,000-row ceiling, through `prune_tool_reports` (one SECURITY
 * INVOKER function, executable by the service role only). Bearer-gated like
 * every cron route; idempotent, because cron platforms retry.
 */

import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));

import { GET } from "@/app/api/cron/tool-reports-cleanup/route";

const SECRET = "cron-secret-0123456789";
const rpc = jest.fn();

function request(authorization?: string): NextRequest {
  return new NextRequest(
    "https://www.recopyfa.st/api/cron/tool-reports-cleanup",
    {
      headers: authorization ? { authorization } : {},
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  (createServiceRoleClient as jest.Mock).mockReturnValue({ rpc });
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe("GET /api/cron/tool-reports-cleanup", () => {
  it.each([undefined, "Bearer wrong", `bearer ${SECRET}`, SECRET])(
    "refuses %p with 401 and never touches the database",
    async (authorization) => {
      const response = await GET(request(authorization));

      expect(response.status).toBe(401);
      expect(createServiceRoleClient).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("fails closed when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;

    expect((await GET(request("Bearer "))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("prunes to 5,000 rows and logs the counts", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ expired: 12, trimmed: 3 }],
      error: null,
    });

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      expired: 12,
      trimmed: 3,
    });
    expect(rpc).toHaveBeenCalledWith("prune_tool_reports", {
      p_max_rows: 5000,
    });
    expect(console.info).toHaveBeenCalledWith(
      "[cron/tool-reports-cleanup] pruned",
      {
        expired: 12,
        trimmed: 3,
      },
    );
  });

  it("answers 200 with zero counts when there is nothing to prune (idempotent)", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ expired: 0, trimmed: 0 }],
      error: null,
    });

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(await response.json()).toEqual({
      success: true,
      expired: 0,
      trimmed: 0,
    });
  });

  it("answers 500 on an RPC error, without the database's text", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "secret detail" },
    });

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(
      "secret detail",
    );
  });

  it("is scheduled once a day in vercel.json", () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons: { path: string; schedule: string }[] };

    const entries = config.crons.filter(
      (cron) => cron.path === "/api/cron/tool-reports-cleanup",
    );
    expect(entries).toEqual([
      { path: "/api/cron/tool-reports-cleanup", schedule: "15 3 * * *" },
    ]);
  });
});
