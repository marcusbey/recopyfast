import { NextRequest } from "next/server";
import { GET, POST, PUT, OPTIONS } from "@/app/api/content/[siteId]/route";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  authorizeSiteRequest,
  authorizeSiteOrigin,
  sanitizeIncomingContent,
} from "@/lib/security/site-auth";

jest.mock("@/lib/supabase/service");
jest.mock("@/lib/security/site-auth", () => ({
  authorizeSiteRequest: jest.fn(),
  authorizeSiteOrigin: jest.fn(),
  sanitizeIncomingContent: jest.fn((value: string) => value),
}));

const mockAuthorizeSiteRequest = authorizeSiteRequest as jest.MockedFunction<
  typeof authorizeSiteRequest
>;
const mockAuthorizeSiteOrigin = authorizeSiteOrigin as jest.MockedFunction<
  typeof authorizeSiteOrigin
>;
const mockSanitizeIncomingContent =
  sanitizeIncomingContent as jest.MockedFunction<
    typeof sanitizeIncomingContent
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
    mockAuthorizeSiteRequest.mockResolvedValue({
      site: { id: "site-123", domain: "example.com", api_key: "api-key" },
      allowedOrigin: "https://example.com",
    });
    mockAuthorizeSiteOrigin.mockResolvedValue({
      site: { id: "site-123", domain: "example.com" },
      allowedOrigin: "https://example.com",
    } as unknown as Awaited<ReturnType<typeof authorizeSiteOrigin>>);
    mockSanitizeIncomingContent.mockImplementation((value: string) => value);

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
      expect(mockSanitizeIncomingContent).toHaveBeenCalledWith(
        "Welcome to our site",
      );
      expect(mockServiceClient.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            site_id: "site-123",
            element_id: "header-1",
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
      // Nothing is written and no content is sanitized on this path.
      expect(mockServiceClient.update).not.toHaveBeenCalled();
      expect(mockSanitizeIncomingContent).not.toHaveBeenCalled();
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

    it("should return 403 when origin not allowed", async () => {
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
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Origin not allowed");
    });
  });
});
