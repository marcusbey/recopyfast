/**
 * s68b M10 — `PUT /api/domains/verify` is metered per user, fail closed.
 *
 * Each PUT makes our infrastructure resolve a customer-chosen hostname and, for
 * the file method, fetch from it. The route had no limiter at all, so a signed-in
 * admin could drive unlimited DNS lookups and outbound requests at whatever their
 * domain row pointed to. The limiter sits after `getUser()` (its bucket is the
 * user) and before the row read, by ADR 037's order — and a refused request does
 * no DNS or HTTP work.
 */

import { promises as dns } from "dns";
import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";

jest.mock("dns", () => ({
  promises: {
    lookup: jest.fn(),
    resolveTxt: jest.fn(),
    resolve4: jest.fn(),
    resolve6: jest.fn(),
  },
}));

jest.mock("@/lib/api/rate-limit", () => ({ enforceRateLimit: jest.fn() }));

const mockGetUser = jest.fn();
const permissionMaybeSingle = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: permissionMaybeSingle }),
          }),
        }),
      }),
    }),
  ),
}));

const serviceFrom = jest.fn();
const rowMaybeSingle = jest.fn();

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: (table: string) => {
      serviceFrom(table);
      return {
        select: () => ({ eq: () => ({ maybeSingle: rowMaybeSingle }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  })),
}));

import { PUT } from "@/app/api/domains/verify/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const mockFetch = jest.fn();

function putRequest(): NextRequest {
  return new NextRequest("http://localhost/api/domains/verify", {
    method: "PUT",
    body: JSON.stringify({ verificationId: "verification-1" }),
    headers: { "Content-Type": "application/json" },
  });
}

/** The per-user bucket answers `status`; every other limiter lets through. */
function refusePerUserBucketWith(status: 429 | 503) {
  (enforceRateLimit as jest.Mock).mockImplementation(
    async (_request: unknown, options: { endpoint: string }) =>
      options.endpoint === "domains/verify"
        ? NextResponse.json({ error: "Refused" }, { status })
        : null,
  );
}

describe("PUT /api/domains/verify — per-user limiter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  });

  it("answers 429 and performs no row read, DNS lookup or fetch when refused", async () => {
    // Only the per-user bucket refuses: since s77 a per-IP guard runs first
    // (verify-limiters.test.ts), and this test is about the bucket behind it.
    refusePerUserBucketWith(429);

    const response = await PUT(putRequest());

    expect(response.status).toBe(429);
    expect(enforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        endpoint: "domains/verify",
        identifier: USER_ID,
        identifierType: "user",
        onStoreFailure: "deny",
      }),
    );
    expect(serviceFrom).not.toHaveBeenCalled();
    expect(dns.lookup).not.toHaveBeenCalled();
    expect(dns.resolveTxt).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails closed when the limiter's store is down", async () => {
    refusePerUserBucketWith(503);

    const response = await PUT(putRequest());

    expect(response.status).toBe(503);
    expect(serviceFrom).not.toHaveBeenCalled();
  });

  it("does not spend a bucket on an unauthenticated caller", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const response = await PUT(putRequest());

    expect(response.status).toBe(401);
    // The per-IP guard (s77) runs before getUser by design; the user's bucket
    // is never opened for an anonymous caller.
    expect(enforceRateLimit).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ endpoint: "domains/verify" }),
    );
  });

  it("proceeds to the row read when the limiter allows", async () => {
    (enforceRateLimit as jest.Mock).mockResolvedValue(null);
    rowMaybeSingle.mockResolvedValue({ data: null });

    const response = await PUT(putRequest());

    expect(response.status).toBe(404);
    expect(serviceFrom).toHaveBeenCalledWith("domain_verifications");
  });
});
