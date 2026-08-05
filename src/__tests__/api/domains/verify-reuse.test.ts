/**
 * POST /api/domains/verify — what "Get instructions" hands back when a live
 * challenge already exists for the domain.
 *
 * The reuse branch exists so that switching method, or asking twice, does not
 * strand the owner with instructions for a challenge that is no longer the live
 * one. It re-issued whatever was stored, including nothing: a row with a null
 * `verification_value` came back as `recopyfast-verification=` or
 * `/.well-known/recopyfast-verification-.txt`, both of which `verifyDomainFile`
 * and the DNS check now refuse outright. The owner could follow the screen
 * exactly and never pass, with deleting the record the only way out.
 *
 * The row is now re-minted in place rather than replaced beside, because the
 * lookup takes the newest row per domain and a broken one left behind would be
 * handed back again the moment it won that ordering.
 */

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

const existingRowMaybeSingle = jest.fn();
const updateSingle = jest.fn();
const updatePayload = jest.fn();
const insertSingle = jest.fn();

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: existingRowMaybeSingle }),
            }),
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updatePayload(payload);
        return {
          eq: () => ({ select: () => ({ single: updateSingle }) }),
        };
      },
      insert: () => ({ select: () => ({ single: insertSingle }) }),
    }),
  })),
}));

import { POST } from "@/app/api/domains/verify/route";
import { NextRequest } from "next/server";

const IN_AN_HOUR = new Date(Date.now() + 60 * 60 * 1000).toISOString();

interface Row {
  id: string;
  site_id: string;
  domain: string;
  verification_method: "dns" | "file";
  verification_token: string;
  verification_value: string | null;
  is_verified: boolean;
  verified_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

const aRow = (overrides: Partial<Row> = {}): Row => ({
  id: "row-1",
  site_id: "site-1",
  domain: "example.com",
  verification_method: "dns",
  verification_token: "token-1",
  verification_value: "abc123",
  is_verified: false,
  verified_at: null,
  expires_at: IN_AN_HOUR,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

interface InstructionsResponse {
  verification: { verificationCode: string };
  instructions: { type: string; record?: string; content?: string };
}

async function requestInstructions(): Promise<InstructionsResponse> {
  const response = await POST(
    new NextRequest("https://www.recopyfa.st/api/domains/verify", {
      method: "POST",
      body: JSON.stringify({
        siteId: "site-1",
        domain: "example.com",
        method: "dns",
      }),
      headers: { "Content-Type": "application/json" },
    }),
  );
  return response.json() as Promise<InstructionsResponse>;
}

describe("POST /api/domains/verify reuse branch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    permissionMaybeSingle.mockResolvedValue({ data: { permission: "admin" } });
    // Whatever the update writes is what comes back.
    updateSingle.mockImplementation(async () => ({
      data: aRow(updatePayload.mock.calls.at(-1)?.[0] as Partial<Row>),
      error: null,
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reuses a live challenge rather than minting a second one", async () => {
    existingRowMaybeSingle.mockResolvedValue({
      data: aRow({ verification_value: "abc123" }),
    });

    const body = await requestInstructions();

    expect(body.verification.verificationCode).toBe("abc123");
    expect(body.instructions.record).toBe("recopyfast-verification=abc123");
    expect(insertSingle).not.toHaveBeenCalled();
    // The code is untouched: only the method and timestamp are rewritten.
    expect(updatePayload).toHaveBeenCalledWith(
      expect.not.objectContaining({ verification_value: expect.anything() }),
    );
  });

  it("re-mints a stored challenge that has no code instead of re-issuing it", async () => {
    existingRowMaybeSingle.mockResolvedValue({
      data: aRow({ verification_value: null }),
    });

    const body = await requestInstructions();

    const written = updatePayload.mock.calls.at(-1)?.[0] as Record<
      string,
      string
    >;
    expect(written.verification_value).toBeTruthy();
    expect(written.verification_token).toBeTruthy();

    // What the owner is told to publish is now something that can be checked.
    expect(body.verification.verificationCode).toBe(written.verification_value);
    expect(body.instructions.record).toBe(
      `recopyfast-verification=${written.verification_value}`,
    );
    expect(body.instructions.record).not.toBe("recopyfast-verification=");
  });
});
