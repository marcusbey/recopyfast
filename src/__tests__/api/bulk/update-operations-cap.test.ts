/**
 * s77 (s69 R2) — `POST /api/bulk/update` carries at most
 * MAX_BULK_UPDATE_OPERATIONS operations.
 *
 * Each operation is a sequential `content_elements` read plus up to one
 * service-role write, all inside one function invocation, and the whole array
 * is stored in `bulk_operations.configuration`. The route took any length: the
 * per-IP limiter bounded requests, not the work inside one. The only caller
 * builds batches by hand, a row at a time; bigger changes are bulk import's job
 * (one RPC, ADR 008). Over the cap is a 400 before the session is read, and
 * nothing is written.
 */

import { POST } from "@/app/api/bulk/update/route";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { checkOwnerCanEdit } from "@/lib/billing/owner-can-edit";
import { MAX_BULK_UPDATE_OPERATIONS } from "@/lib/bulk/constants";

jest.mock("@supabase/ssr");
jest.mock("@/lib/supabase/service");
jest.mock("@/lib/api/rate-limit", () => ({ enforceRateLimit: jest.fn() }));
jest.mock("@/lib/billing/owner-can-edit", () => ({
  ...jest.requireActual("@/lib/billing/owner-can-edit"),
  checkOwnerCanEdit: jest.fn(),
}));

const SITE_ID = "22222222-2222-4222-8222-222222222222";

const getUser = jest.fn();
let elementReads = 0;
let contentWrites = 0;
let operationRows = 0;

function userClient() {
  return {
    auth: { getUser },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.update = () => chain;
      chain.insert = () => {
        if (table === "bulk_operations") operationRows += 1;
        return Promise.resolve({ error: null });
      };
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(resolve);
      chain.single = () => {
        if (table === "site_permissions") {
          return Promise.resolve({ data: { permission: "edit" } });
        }
        elementReads += 1;
        return Promise.resolve({
          data: { id: `row-${elementReads}`, current_content: "old" },
          error: null,
        });
      };
      return chain;
    },
  };
}

function writerClient() {
  return {
    from: () => ({
      update: () => {
        contentWrites += 1;
        const chain = {
          eq: () => chain,
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ error: null }).then(resolve),
        };
        return chain;
      },
    }),
  };
}

function bulkRequest(count: number): NextRequest {
  return new NextRequest("http://localhost/api/bulk/update", {
    method: "POST",
    body: JSON.stringify({
      site_id: SITE_ID,
      operations: Array.from({ length: count }, (_, index) => ({
        element_id: `el-${index}`,
        operation: "set",
        content: "new",
      })),
    }),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/bulk/update — operations cap (s69 R2)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    elementReads = 0;
    contentWrites = 0;
    operationRows = 0;
    getUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    (enforceRateLimit as jest.Mock).mockResolvedValue(null);
    (checkOwnerCanEdit as jest.Mock).mockResolvedValue({
      ok: true,
      ownerId: "owner-1",
    });
    (createServerClient as jest.Mock).mockReturnValue(userClient());
    (createServiceRoleClient as jest.Mock).mockReturnValue(writerClient());
  });

  it("is 100: a hand-built batch never meets it", () => {
    expect(MAX_BULK_UPDATE_OPERATIONS).toBe(100);
  });

  it("refuses one operation over the cap with 400, before the session, writing nothing", async () => {
    const response = await POST(bulkRequest(MAX_BULK_UPDATE_OPERATIONS + 1));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      `At most ${MAX_BULK_UPDATE_OPERATIONS} operations per request.`,
    );
    expect(getUser).not.toHaveBeenCalled();
    expect(operationRows).toBe(0);
    expect(elementReads).toBe(0);
    expect(contentWrites).toBe(0);
  });

  it("processes exactly the cap", async () => {
    const response = await POST(bulkRequest(MAX_BULK_UPDATE_OPERATIONS));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results.total).toBe(MAX_BULK_UPDATE_OPERATIONS);
    expect(body.results.successful).toBe(MAX_BULK_UPDATE_OPERATIONS);
    expect(contentWrites).toBe(MAX_BULK_UPDATE_OPERATIONS);
  });
});
