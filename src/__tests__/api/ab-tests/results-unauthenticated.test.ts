/**
 * POST /api/ab-tests/[testId]/results used the service-role key with no
 * session, no site token, and no origin pin. The widget already exposes
 * testId, so anyone could forge conversions and attribute them to any user_id.
 *
 * Ingest belongs on POST /api/ab-tests/track, which authorizes with
 * authorizeSiteRequest. This POST must not write at all.
 */

import { NextRequest } from "next/server";

const createServerClient = jest.fn();

jest.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClient(...args),
}));

import { POST } from "@/app/api/ab-tests/[testId]/results/route";

const TEST_ID = "11111111-1111-1111-1111-111111111111";
const VARIANT_ID = "22222222-2222-2222-2222-222222222222";

function postResults() {
  return POST(
    new NextRequest(`https://www.recopyfa.st/api/ab-tests/${TEST_ID}/results`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        variant_id: VARIANT_ID,
        event_type: "conversion",
        user_id: "victim-user",
        value: 1,
      }),
    }),
    { params: Promise.resolve({ testId: TEST_ID }) },
  );
}

describe("POST /api/ab-tests/[testId]/results", () => {
  beforeEach(() => {
    createServerClient.mockReset();
  });

  it("refuses an unauthenticated write", async () => {
    const response = await postResults();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).not.toBe(500);
  });

  it("does not open a Supabase client", async () => {
    await postResults();

    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("does not accept the write", async () => {
    const response = await postResults();
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(405);
    expect(body.error).toMatch(/track/i);
  });
});
