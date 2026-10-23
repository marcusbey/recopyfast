/**
 * s119 (ADR 075) — the content route's half of source drift.
 *
 * GET hands the widget `source_seen` on edited rows only, so the widget can tell
 * that the page's live authored text no longer matches what the override was
 * written against. POST, after the discovery upsert, hands the reported text to
 * `record_content_source_drift`, which decides. The scenario is the one that
 * motivated the story: original "5 to 10", published "5 to 11", deployed
 * "5 to 9" — the conflict is recorded and visitors still get "5 to 11".
 */

import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/content/[siteId]/route";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  authorizeFirstPartySiteRequest,
  authorizeSiteRequest,
} from "@/lib/security/site-auth";

jest.mock("@/lib/supabase/service");
jest.mock("@/lib/security/site-auth", () => {
  const actual = jest.requireActual("@/lib/security/site-auth");
  return {
    __esModule: true,
    ...actual,
    authorizeFirstPartySiteRequest: jest.fn(),
    authorizeSiteRequest: jest.fn(),
  };
});
// The limiter is proved in rate-limit.test.ts; here it admits.
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(async () => null),
}));

const mockAuthorizeFirstParty =
  authorizeFirstPartySiteRequest as jest.MockedFunction<
    typeof authorizeFirstPartySiteRequest
  >;
const mockAuthorizeSiteRequest = authorizeSiteRequest as jest.MockedFunction<
  typeof authorizeSiteRequest
>;
const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;

type MockServiceClient = {
  from: jest.Mock;
  select: jest.Mock;
  eq: jest.Mock;
  is: jest.Mock;
  order: jest.Mock;
  range: jest.Mock;
  single: jest.Mock;
  upsert: jest.Mock;
  update: jest.Mock;
  rpc: jest.Mock;
};

const client: MockServiceClient = {
  from: jest.fn(() => client),
  select: jest.fn(() => client),
  eq: jest.fn(() => client),
  is: jest.fn(() => client),
  order: jest.fn(() => client),
  range: jest.fn(),
  single: jest.fn(),
  upsert: jest.fn(),
  update: jest.fn(() => client),
  rpc: jest.fn(),
};

const SITE_ID = "11111111-1111-4111-8111-111111111111";

const editedRow = {
  id: "row-1",
  site_id: SITE_ID,
  element_id: "pricing-range",
  selector: "p",
  original_content: "5 to 10",
  published_content: "5 to 11",
  language: "en",
  variant: "default",
  page_path: "/",
  metadata: { type: "p" },
  published_at: "2026-10-20T10:00:00Z",
  source_baseline: null,
  source_drift_content: null,
  source_drift_detected_at: null,
};

const uneditedRow = {
  ...editedRow,
  id: "row-2",
  element_id: "headline",
  original_content: "Hello",
  published_content: "Hello",
  published_at: null,
};

function widgetGet(query = "?page_path=%2F") {
  return GET(
    new NextRequest(`http://localhost/api/content/${SITE_ID}${query}`, {
      headers: {
        Authorization: "Bearer token",
        Origin: "https://example.com",
      },
    }),
    { params: Promise.resolve({ siteId: SITE_ID }) },
  );
}

function widgetPost(body: unknown) {
  return POST(
    new NextRequest(`http://localhost/api/content/${SITE_ID}`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        Origin: "https://example.com",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ siteId: SITE_ID }) },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateServiceRoleClient.mockReturnValue(
    client as unknown as ReturnType<typeof createServiceRoleClient>,
  );
  mockAuthorizeFirstParty.mockResolvedValue(null);
  mockAuthorizeSiteRequest.mockResolvedValue({
    site: { id: SITE_ID, domain: "example.com", api_key: "k" },
    allowedOrigin: "https://example.com",
  } as unknown as Awaited<ReturnType<typeof authorizeSiteRequest>>);
  client.from.mockReturnValue(client);
  client.select.mockReturnValue(client);
  client.eq.mockReturnValue(client);
  client.is.mockReturnValue(client);
  client.order.mockReturnValue(client);
  client.update.mockReturnValue(client);
  client.range.mockResolvedValue({ data: [], error: null, count: 0 });
  client.single.mockResolvedValue({ data: { id: SITE_ID }, error: null });
  client.upsert.mockResolvedValue({ error: null });
  client.rpc.mockResolvedValue({ data: 1, error: null });
});

describe("GET /api/content/:siteId — source_seen", () => {
  function serve(rows: unknown[]) {
    client.range.mockResolvedValueOnce({
      data: rows,
      error: null,
      count: rows.length,
    });
  }

  it("reads the drift columns in the same select as the copy", async () => {
    serve([]);
    await widgetGet();

    const columns = client.select.mock.calls[0][0] as string;
    expect(columns).toEqual(expect.stringContaining("source_baseline"));
    expect(columns).toEqual(expect.stringContaining("source_drift_content"));
  });

  it("gives an edited row its baseline as source_seen and still serves the override", async () => {
    serve([editedRow]);
    const [row] = await (await widgetGet()).json();

    expect(row.current_content).toBe("5 to 11");
    expect(row.original_content).toBe("5 to 10");
    expect(row.source_seen).toBe("5 to 10");
  });

  it("the three-value scenario: once a drift is recorded, source_seen is the deployed text and visitors still get the override", async () => {
    serve([
      {
        ...editedRow,
        source_drift_content: "5 to 9",
        source_drift_detected_at: "2026-10-22T10:00:00Z",
      },
    ]);
    const [row] = await (await widgetGet()).json();

    expect(row.current_content).toBe("5 to 11");
    expect(row.source_seen).toBe("5 to 9");
  });

  it("measures against a kept baseline when one exists", async () => {
    serve([{ ...editedRow, source_baseline: "5 to 9" }]);
    const [row] = await (await widgetGet()).json();

    expect(row.source_seen).toBe("5 to 9");
  });

  it("gives an unedited row no source_seen, so the widget never reports it", async () => {
    serve([uneditedRow]);
    const [row] = await (await widgetGet()).json();

    expect(row).not.toHaveProperty("source_seen");
  });

  it("treats a NULL published copy the way the widget does: unedited", async () => {
    serve([{ ...uneditedRow, published_content: null }]);
    const [row] = await (await widgetGet()).json();

    expect(row.current_content).toBe("Hello");
    expect(row).not.toHaveProperty("source_seen");
  });

  it("does not hand the raw baseline and drift columns to the page", async () => {
    serve([
      {
        ...editedRow,
        source_baseline: "5 to 10",
        source_drift_content: "5 to 9",
        source_drift_detected_at: "2026-10-22T10:00:00Z",
      },
    ]);
    const [row] = await (await widgetGet()).json();

    expect(row).not.toHaveProperty("source_baseline");
    expect(row).not.toHaveProperty("source_drift_content");
    expect(row).not.toHaveProperty("source_drift_detected_at");
  });

  it("emits no source_seen outside en/default, which the server never records", async () => {
    serve([{ ...editedRow, language: "fr" }]);
    const [row] = await (await widgetGet("?page_path=%2F&language=fr")).json();

    expect(row).not.toHaveProperty("source_seen");
  });
});

describe("POST /api/content/:siteId — record_content_source_drift", () => {
  it("the three-value scenario: the deployed text is handed to the drift recorder after the upsert", async () => {
    const response = await widgetPost({
      "pricing-range": { selector: "p", content: "5 to 9", type: "p" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(client.upsert).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("record_content_source_drift", {
      p_site_id: SITE_ID,
      p_reports: [{ element_id: "pricing-range", content: "5 to 9" }],
    });
    expect(client.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      client.rpc.mock.invocationCallOrder[0],
    );
    // Nothing on the published copy is touched by a discovery report.
    expect(client.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ published_content: expect.anything() }),
    );
  });

  it("hands only validated elements to the recorder", async () => {
    await widgetPost({
      "pricing-range": { selector: "p", content: "5 to 9", type: "p" },
      "bad id with spaces\n": { selector: "p", content: "x", type: "p" },
    });

    expect(client.rpc).toHaveBeenCalledWith("record_content_source_drift", {
      p_site_id: SITE_ID,
      p_reports: [{ element_id: "pricing-range", content: "5 to 9" }],
    });
  });

  it("answers the widget normally when the recorder fails", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    client.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });

    const response = await widgetPost({
      "pricing-range": { selector: "p", content: "5 to 9", type: "p" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("source drift"),
      expect.anything(),
    );
    consoleError.mockRestore();
  });

  it("answers the widget normally when the recorder throws", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    client.rpc.mockRejectedValueOnce(new Error("network"));

    const response = await widgetPost({
      "pricing-range": { selector: "p", content: "5 to 9", type: "p" },
    });

    expect(response.status).toBe(200);
    consoleError.mockRestore();
  });

  it("does not call the recorder when the upsert failed", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    client.upsert.mockResolvedValueOnce({ error: { message: "nope" } });

    const response = await widgetPost({
      "pricing-range": { selector: "p", content: "5 to 9", type: "p" },
    });

    expect(response.status).toBe(500);
    expect(client.rpc).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not call the recorder for a map with nothing storable", async () => {
    const consoleWarn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    await widgetPost({ "bad id\n": { selector: "p", content: "x" } });

    expect(client.rpc).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});
