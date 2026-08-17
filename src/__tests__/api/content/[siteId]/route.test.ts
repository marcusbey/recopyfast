import { NextRequest } from "next/server";
import { GET, POST, PUT, OPTIONS } from "@/app/api/content/[siteId]/route";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  authorizeFirstPartySiteRequest,
  authorizeSiteRequest,
  authorizeSiteOrigin,
} from "@/lib/security/site-auth";

jest.mock("@/lib/supabase/service");
// Only authorization is stubbed, and only because it needs a database. This file
// used to add `sanitizeIncomingContent: jest.fn((value) => value)` — an identity
// stub over the one component that was corrupting the customer's copy, which is
// what let A-1 sit here unseen while these tests passed. What the route does to
// content is now the shipped implementation on every path below.
jest.mock("@/lib/security/site-auth", () => {
  const actual = jest.requireActual("@/lib/security/site-auth");
  return {
    __esModule: true,
    ...actual,
    authorizeFirstPartySiteRequest: jest.fn(),
    authorizeSiteRequest: jest.fn(),
    authorizeSiteOrigin: jest.fn(),
  };
});

const mockAuthorizeFirstPartySiteRequest =
  authorizeFirstPartySiteRequest as jest.MockedFunction<
    typeof authorizeFirstPartySiteRequest
  >;
const mockAuthorizeSiteRequest = authorizeSiteRequest as jest.MockedFunction<
  typeof authorizeSiteRequest
>;
const mockAuthorizeSiteOrigin = authorizeSiteOrigin as jest.MockedFunction<
  typeof authorizeSiteOrigin
>;

type MockServiceClient = {
  from: jest.Mock;
  select: jest.Mock;
  eq: jest.Mock;
  single: jest.Mock;
  upsert: jest.Mock;
  update: jest.Mock;
};

// Annotated explicitly: the chain methods return the object itself, which
// TypeScript cannot infer from a self-referential initializer (TS7022).
const mockServiceClient: MockServiceClient = {
  from: jest.fn(() => mockServiceClient),
  select: jest.fn(() => mockServiceClient),
  eq: jest.fn(() => mockServiceClient),
  single: jest.fn(),
  upsert: jest.fn(),
  update: jest.fn(() => mockServiceClient),
};

const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;

describe("/api/content/[siteId]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateServiceRoleClient.mockReturnValue(
      mockServiceClient as unknown as ReturnType<
        typeof createServiceRoleClient
      >,
    );
    // No session by default: every existing test exercises the widget's
    // token/origin path exactly as before.
    mockAuthorizeFirstPartySiteRequest.mockResolvedValue(null);
    mockAuthorizeSiteRequest.mockResolvedValue({
      site: { id: "site-123", domain: "example.com", api_key: "api-key" },
      allowedOrigin: "https://example.com",
    });
    mockAuthorizeSiteOrigin.mockResolvedValue({
      site: { id: "site-123", domain: "example.com" },
      allowedOrigin: "https://example.com",
    } as unknown as Awaited<ReturnType<typeof authorizeSiteOrigin>>);

    mockServiceClient.from.mockReturnValue(mockServiceClient);
    mockServiceClient.select.mockReturnValue(mockServiceClient);
    mockServiceClient.eq.mockImplementation(() => mockServiceClient);
    mockServiceClient.single.mockResolvedValue({
      data: { id: "site-123" },
      error: null,
    });
    mockServiceClient.upsert.mockResolvedValue({ error: null });
    mockServiceClient.update.mockReturnValue(mockServiceClient);
  });

  describe("GET", () => {
    const mockContentElements = [
      {
        id: 1,
        site_id: "site-123",
        element_id: "header-1",
        selector: "h1",
        original_content: "Welcome",
        current_content: "Welcome",
        language: "en",
        variant: "default",
        metadata: { type: "text" },
      },
    ];

    it("should fetch content elements with default parameters", async () => {
      mockServiceClient.eq
        .mockImplementationOnce(() => mockServiceClient) // site_id
        .mockImplementationOnce(() => mockServiceClient) // language
        .mockImplementationOnce(() =>
          Promise.resolve({ data: mockContentElements, error: null }),
        ); // variant

      const request = new NextRequest("http://localhost/api/content/site-123", {
        headers: {
          Authorization: "Bearer token",
          Origin: "https://example.com",
        },
      });

      const response = await GET(request, {
        params: Promise.resolve({ siteId: "site-123" }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(mockContentElements);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
    });

    it("should fetch content elements with custom language and variant", async () => {
      mockServiceClient.eq
        .mockImplementationOnce(() => mockServiceClient) // site_id
        .mockImplementationOnce(() => mockServiceClient) // language
        .mockImplementationOnce(() =>
          Promise.resolve({ data: mockContentElements, error: null }),
        ); // variant

      const request = new NextRequest(
        "http://localhost/api/content/site-123?language=es&variant=mobile",
        {
          headers: {
            Authorization: "Bearer token",
            Origin: "https://example.com",
          },
        },
      );

      const response = await GET(request, {
        params: Promise.resolve({ siteId: "site-123" }),
      });

      expect(response.status).toBe(200);
      expect(mockServiceClient.eq).toHaveBeenNthCalledWith(2, "language", "es");
      expect(mockServiceClient.eq).toHaveBeenNthCalledWith(
        3,
        "variant",
        "mobile",
      );
    });

    it("should return empty array when no content found", async () => {
      mockServiceClient.eq
        .mockImplementationOnce(() => mockServiceClient)
        .mockImplementationOnce(() => mockServiceClient)
        .mockImplementationOnce(() =>
          Promise.resolve({ data: null, error: null }),
        );

      const request = new NextRequest("http://localhost/api/content/site-123", {
        headers: {
          Authorization: "Bearer token",
          Origin: "https://example.com",
        },
      });

      const response = await GET(request, {
        params: Promise.resolve({ siteId: "site-123" }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual([]);
    });

    it("should return 401 when authorization fails", async () => {
      mockAuthorizeSiteRequest.mockRejectedValueOnce(
        new Error("Missing site token"),
      );

      const request = new NextRequest("http://localhost/api/content/site-123");
      const response = await GET(request, {
        params: Promise.resolve({ siteId: "site-123" }),
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Missing site token");
    });

    it("should authorize a first-party dashboard session without a token or Origin, and skip the widget path entirely", async () => {
      mockAuthorizeFirstPartySiteRequest.mockResolvedValueOnce({
        site: { id: "site-123", domain: "example.com", api_key: "api-key" },
        allowedOrigin: null,
      });
      mockServiceClient.eq
        .mockImplementationOnce(() => mockServiceClient) // site_id
        .mockImplementationOnce(() => mockServiceClient) // language
        .mockImplementationOnce(() =>
          Promise.resolve({ data: mockContentElements, error: null }),
        ); // variant

      // No Authorization header, no Origin header, no ?token= — the dashboard
      // never sends these; only the session cookie authorizes this request.
      const request = new NextRequest("http://localhost/api/content/site-123");

      const response = await GET(request, {
        params: Promise.resolve({ siteId: "site-123" }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(mockContentElements);
      expect(mockAuthorizeSiteRequest).not.toHaveBeenCalled();
      // allowedOrigin is null for first-party requests, so withCors() falls
      // back to NEXT_PUBLIC_APP_URL rather than echoing a caller-supplied origin.
      expect(
        response.headers.get("Access-Control-Allow-Origin"),
      ).not.toBeNull();
    });

    /**
     * The liveness signal for AC 7, and why it lives on GET.
     *
     * POST goes silent on a healthy site: the widget tracks which element ids
     * the server already holds and stops reporting once the page is fully
     * discovered. This GET is the request every page view makes, so it is the
     * only ongoing evidence that the script is still running — without it every
     * working, unchanged site would drift into `stale` a fortnight after
     * install.
     */
    describe("liveness", () => {
      const queueContentQuery = () => {
        mockServiceClient.eq
          .mockImplementationOnce(() => mockServiceClient) // site_id
          .mockImplementationOnce(() => mockServiceClient) // language
          .mockImplementationOnce(() =>
            Promise.resolve({ data: mockContentElements, error: null }),
          ); // variant
      };

      it("records a report when the widget's own token authorized the read", async () => {
        queueContentQuery();

        await GET(
          new NextRequest("http://localhost/api/content/site-123", {
            headers: {
              Authorization: "Bearer token",
              Origin: "https://example.com",
            },
          }),
          { params: Promise.resolve({ siteId: "site-123" }) },
        );

        expect(mockServiceClient.update).toHaveBeenCalledWith({
          last_reported_at: expect.any(String),
        });
      });

      it("records nothing when the dashboard's own session authorized the read", async () => {
        // An owner opening the dashboard is not evidence that their visitors'
        // browsers are still running the script — which is the only thing
        // staleness is about. Counting it would keep an uninstalled site
        // looking alive for as long as its owner kept checking on it.
        mockAuthorizeFirstPartySiteRequest.mockResolvedValueOnce({
          site: { id: "site-123", domain: "example.com", api_key: "api-key" },
          allowedOrigin: null,
        });
        queueContentQuery();

        await GET(new NextRequest("http://localhost/api/content/site-123"), {
          params: Promise.resolve({ siteId: "site-123" }),
        });

        expect(mockServiceClient.update).not.toHaveBeenCalled();
      });

      it("serves the content even when the liveness write fails", async () => {
        // `stale` is advisory. Nothing about it may stand between a visitor and
        // the copy on the page they asked for.
        queueContentQuery();
        mockServiceClient.update.mockImplementation(() => {
          throw new Error("sites table unavailable");
        });

        const response = await GET(
          new NextRequest("http://localhost/api/content/site-123", {
            headers: {
              Authorization: "Bearer token",
              Origin: "https://example.com",
            },
          }),
          { params: Promise.resolve({ siteId: "site-123" }) },
        );
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual(mockContentElements);
      });
    });
  });

  describe("POST", () => {
    const mockContentMap = {
      "header-1": {
        selector: "h1",
        content: "Welcome to our site",
        type: "text",
      },
    };

    it("should successfully save content map", async () => {
      mockServiceClient.eq.mockImplementationOnce(() => mockServiceClient); // site lookup

      const request = new NextRequest("http://localhost/api/content/site-123", {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          Origin: "https://example.com",
        },
        body: JSON.stringify(mockContentMap),
      });

      const response = await POST(request, {
        params: Promise.resolve({ siteId: "site-123" }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true });
      expect(mockServiceClient.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            site_id: "site-123",
            element_id: "header-1",
            // The customer's text, unchanged. src/__tests__/api/content/
            // discovery-fidelity.test.ts covers the copy that used to be
            // rewritten (angle brackets, tag-shaped prose, long paragraphs).
            original_content: "Welcome to our site",
            current_content: "Welcome to our site",
            published_content: "Welcome to our site",
          }),
        ]),
        {
          onConflict: "site_id,element_id,language,variant",
          ignoreDuplicates: true,
        },
      );
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
    });

    it("should return 404 when site not found", async () => {
      mockServiceClient.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const request = new NextRequest("http://localhost/api/content/site-123", {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
        },
        body: JSON.stringify(mockContentMap),
      });

      const response = await POST(request, {
        params: Promise.resolve({ siteId: "site-123" }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Site not found");
    });

    /**
     * The install flip (AC 2), and the three ways it could be got wrong.
     *
     * It fires on an authorized report, not on rows written: a page whose every
     * element is skipped (oversized inline images, malformed selectors) is
     * still proof the script ran on the registered domain. It is guarded so it
     * cannot re-fire and rewrite `live_at`. And it can never turn a successful
     * report into a failed one — the widget's fetch is fire-and-forget on the
     * customer's own page, so a status write that throws must not become an
     * error the customer's page has to survive.
     */
    describe("first authenticated report", () => {
      const postContentMap = (body: unknown = mockContentMap) =>
        POST(
          new NextRequest("http://localhost/api/content/site-123", {
            method: "POST",
            headers: {
              Authorization: "Bearer token",
              Origin: "https://example.com",
            },
            body: JSON.stringify(body),
          }),
          { params: Promise.resolve({ siteId: "site-123" }) },
        );

      it("flips the site to live", async () => {
        const response = await postContentMap();

        expect(response.status).toBe(200);
        expect(mockServiceClient.update).toHaveBeenCalledWith(
          expect.objectContaining({
            status: "live",
            live_at: expect.any(String),
            last_reported_at: expect.any(String),
          }),
        );
      });

      it("guards the flip so a later report cannot rewrite live_at", async () => {
        await postContentMap();

        expect(mockServiceClient.eq).toHaveBeenCalledWith(
          "status",
          "awaiting-install",
        );
      });

      it("bumps the liveness timestamp as well as flipping the status", async () => {
        await postContentMap();

        expect(mockServiceClient.update).toHaveBeenCalledWith({
          last_reported_at: expect.any(String),
        });
      });

      it("flips on a report with nothing storable in it", async () => {
        // An authorized report of an empty map is still proof the script ran.
        const response = await postContentMap({});

        expect(response.status).toBe(200);
        expect(mockServiceClient.update).toHaveBeenCalledWith(
          expect.objectContaining({ status: "live" }),
        );
      });

      it("answers the widget normally when the status write fails", async () => {
        mockServiceClient.update.mockImplementation(() => {
          throw new Error("sites table unavailable");
        });

        const response = await postContentMap();
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({ success: true });
      });

      it("never writes the derived stale state", async () => {
        await postContentMap();

        expect(
          JSON.stringify(mockServiceClient.update.mock.calls),
        ).not.toContain("stale");
      });
    });

    /**
     * AC 4 — a report from the wrong domain is recorded, and changes nothing
     * else. The request keeps failing exactly as it did: `authorizeSiteRequest`
     * throws before any content is read, the answer is still 403, and the site
     * stays `awaiting-install`. Recording it is what lets the dashboard tell an
     * owner "we heard from staging.example.net, not example.com" instead of
     * leaving them staring at a card that never turns green.
     */
    describe("a report from an unregistered domain", () => {
      const postFromWrongOrigin = () =>
        POST(
          new NextRequest("http://localhost/api/content/site-123", {
            method: "POST",
            headers: {
              Authorization: "Bearer token",
              Origin: "https://wrong-domain.example",
            },
            body: JSON.stringify(mockContentMap),
          }),
          { params: Promise.resolve({ siteId: "site-123" }) },
        );

      beforeEach(() => {
        mockAuthorizeSiteRequest.mockRejectedValue(
          new Error("Origin not allowed"),
        );
      });

      it("is still refused with a 403 and writes no content", async () => {
        const response = await postFromWrongOrigin();

        expect(response.status).toBe(403);
        expect(mockServiceClient.upsert).not.toHaveBeenCalled();
      });

      it("records the domain that reported and when", async () => {
        await postFromWrongOrigin();

        expect(mockServiceClient.update).toHaveBeenCalledWith({
          last_mismatch_domain: "wrong-domain.example",
          last_mismatch_at: expect.any(String),
        });
      });

      it("does not verify the site", async () => {
        await postFromWrongOrigin();

        expect(mockServiceClient.update).not.toHaveBeenCalledWith(
          expect.objectContaining({ status: "live" }),
        );
      });

      it("records nothing for a rejected token, which names no domain", async () => {
        mockAuthorizeSiteRequest.mockRejectedValue(
          new Error("Invalid site token"),
        );

        const response = await postFromWrongOrigin();

        expect(response.status).toBe(401);
        expect(mockServiceClient.update).not.toHaveBeenCalled();
      });
    });

    it("should return 500 when upsert fails", async () => {
      mockServiceClient.upsert.mockResolvedValueOnce({
        error: { message: "DB error" },
      });

      const request = new NextRequest("http://localhost/api/content/site-123", {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
        },
        body: JSON.stringify(mockContentMap),
      });

      const response = await POST(request, {
        params: Promise.resolve({ siteId: "site-123" }),
      });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to save content");
    });
  });

  describe("PUT", () => {
    // PUT no longer writes to live content. Callers must go through
    // /api/staging/content and publish explicitly, so an authorized request now
    // gets a 403 explaining the new flow rather than a 200.
    const putRequest = (headers: Record<string, string>) =>
      new NextRequest("http://localhost/api/content/site-123", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          elementId: "header-1",
          content: "Updated content",
          language: "en",
          variant: "default",
        }),
      });

    it("should refuse direct live updates and point at the staging flow", async () => {
      const response = await PUT(
        putRequest({
          Authorization: "Bearer token",
          Origin: "https://example.com",
        }),
        { params: Promise.resolve({ siteId: "site-123" }) },
      );
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe(
        "Live content updates must use /api/staging/content and publish explicitly",
      );
      // Nothing is written on this path.
      expect(mockServiceClient.update).not.toHaveBeenCalled();
    });

    it("should echo the allowed origin on the refusal so browsers can read it", async () => {
      const response = await PUT(
        putRequest({
          Authorization: "Bearer token",
          Origin: "https://example.com",
        }),
        { params: Promise.resolve({ siteId: "site-123" }) },
      );

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
    });

    it("should return 401 when the site token is rejected", async () => {
      mockAuthorizeSiteRequest.mockRejectedValueOnce(
        new Error("Invalid token"),
      );

      const response = await PUT(
        putRequest({ Authorization: "Bearer bad-token" }),
        { params: Promise.resolve({ siteId: "site-123" }) },
      );
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid token");
    });

    it("should return 403 when the origin is rejected", async () => {
      mockAuthorizeSiteRequest.mockRejectedValueOnce(
        new Error("Origin not allowed"),
      );

      const response = await PUT(
        putRequest({
          Authorization: "Bearer token",
          Origin: "https://malicious.com",
        }),
        { params: Promise.resolve({ siteId: "site-123" }) },
      );
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Origin not allowed");
    });
  });

  describe("OPTIONS", () => {
    it("should return 204 with CORS headers when origin allowed", async () => {
      const request = new NextRequest("http://localhost/api/content/site-123", {
        method: "OPTIONS",
        headers: {
          Origin: "https://example.com",
        },
      });

      const response = await OPTIONS(request, {
        params: Promise.resolve({ siteId: "site-123" }),
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
    });

    it("should withhold the grant, not the answer, when origin not allowed", async () => {
      // The status is uniform on purpose: varying it made the preflight an
      // existence oracle for site ids. What stops the caller is the missing
      // grant — a 204 whose Access-Control-Allow-Origin is not theirs is one the
      // browser will not act on, so the real request is never sent.
      mockAuthorizeSiteOrigin.mockRejectedValueOnce(
        new Error("Origin not allowed"),
      );

      const request = new NextRequest("http://localhost/api/content/site-123", {
        method: "OPTIONS",
        headers: {
          Origin: "https://malicious.com",
        },
      });

      const response = await OPTIONS(request, {
        params: Promise.resolve({ siteId: "site-123" }),
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe(
        "https://malicious.com",
      );
    });
  });
});
