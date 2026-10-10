/**
 * s56 — `bulk/update` is metered before anything else runs.
 *
 * Since s56 (ADR 042) the route writes `content_elements` through the service
 * role: no web principal holds DML on a content table any more. AGENTS.md makes
 * a fail-closed limiter the price of every service-role write path, and this
 * route had none at all (ADR 041 "Watch"). It sits before the body read and
 * before `getUser()`, the same shape as `bulk/import`: a limiter behind the
 * auth lookup never sees the flood it exists to stop.
 */

import { POST } from "@/app/api/bulk/update/route";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { enforceRateLimit } from "@/lib/api/rate-limit";

jest.mock("@supabase/ssr");
jest.mock("@/lib/supabase/service");
jest.mock("@/lib/api/rate-limit", () => ({ enforceRateLimit: jest.fn() }));
jest.mock("@/lib/billing/owner-can-edit", () => ({
  ...jest.requireActual("@/lib/billing/owner-can-edit"),
  checkOwnerCanEdit: jest.fn(),
}));

const getUser = jest.fn();
const from = jest.fn();

describe("POST /api/bulk/update — rate limit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createServerClient as jest.Mock).mockReturnValue({
      auth: { getUser },
      from,
    });
  });

  it("answers 429 before reading the body or the session", async () => {
    (enforceRateLimit as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }),
    );
    const request = new NextRequest("http://localhost/api/bulk/update", {
      method: "POST",
      body: JSON.stringify({
        site_id: "site-123",
        operations: [{ element_id: "h1", operation: "set", content: "x" }],
      }),
      headers: { "Content-Type": "application/json" },
    });
    const readBody = jest.spyOn(request, "json");

    const response = await POST(request);

    expect(response.status).toBe(429);
    expect(readBody).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when the limiter's store is down", async () => {
    (enforceRateLimit as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: "Unavailable" }, { status: 503 }),
    );

    await POST(
      new NextRequest("http://localhost/api/bulk/update", {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(enforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        endpoint: "bulk/update",
        onStoreFailure: "deny",
      }),
    );
  });
});
