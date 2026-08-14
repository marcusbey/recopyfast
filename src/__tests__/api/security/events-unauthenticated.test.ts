/**
 * POST /api/security/events accepted an unauthenticated body and wrote
 * caller-supplied userId / siteId / payload. Intended RLS only allows
 * service_role inserts, but production policy drift is unproven, and the
 * route should not be a public write surface either way.
 *
 * Nothing in the product POSTs here (the dashboard only GETs). Events are
 * recorded by server code. This method is shut off.
 */

import { NextRequest } from "next/server";

const from = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: {
        getUser: jest.fn(() =>
          Promise.resolve({ data: { user: null }, error: null }),
        ),
      },
      from,
    }),
  ),
}));

import { POST } from "@/app/api/security/events/route";

function postEvent() {
  return POST(
    new NextRequest("https://www.recopyfa.st/api/security/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "xss_attempt",
        siteId: "11111111-1111-1111-1111-111111111111",
        userId: "victim-user",
        payload: { note: "forged" },
      }),
    }),
  );
}

describe("POST /api/security/events", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("refuses an unauthenticated write", async () => {
    const response = await postEvent();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).not.toBe(500);
  });

  it("does not insert a security_events row", async () => {
    await postEvent();

    expect(from).not.toHaveBeenCalled();
  });

  it("does not accept the write", async () => {
    const response = await postEvent();
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(405);
    expect(body.error).toMatch(/disabled|not accepted/i);
  });
});
