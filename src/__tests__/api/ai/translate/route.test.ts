// Mock dependencies first before any imports
jest.mock("@/lib/ai/openai-service", () => ({
  aiService: {
    batchTranslate: jest.fn(),
    translateText: jest.fn(),
    generateContentSuggestion: jest.fn(),
    detectLanguage: jest.fn(),
  },
}));
jest.mock("@/lib/supabase/server");

jest.mock("@/lib/feature-gating/permissions", () => ({
  consumeFeatureUsage: jest.fn(),
}));

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(),
  getClientIp: jest.fn(() => "127.0.0.1"),
}));

import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/ai/translate/route";
import { aiService } from "@/lib/ai/openai-service";
import { createClient } from "@/lib/supabase/server";
import { consumeFeatureUsage } from "@/lib/feature-gating/permissions";
import { enforceRateLimit } from "@/lib/api/rate-limit";

const TEST_USER = { id: "user-123", email: "user@example.com" };

const mockSupabase = {
  auth: {
    getUser: jest.fn(),
  },
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn(),
  upsert: jest.fn().mockReturnThis(),
};

const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;
const mockAiService = aiService as jest.Mocked<typeof aiService>;
const mockConsumeFeatureUsage = consumeFeatureUsage as jest.Mock;
const mockEnforceRateLimit = enforceRateLimit as jest.Mock;

/** sites.id is a UUID column; the route rejects anything that is not one. */
const VALID_SITE_ID = "7e3b2d6c-1ab1-46f3-92fd-493173fa3e17";

/**
 * The route makes two `.single()` calls before it does any work: the site
 * lookup, then the caller's `site_permissions` row. Queue both.
 */
const allowSiteAccess = () => {
  mockSupabase.single
    .mockResolvedValueOnce({ data: { id: VALID_SITE_ID }, error: null })
    .mockResolvedValueOnce({ data: { permission: "edit" }, error: null });
};

describe("/api/ai/translate - POST", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateClient.mockResolvedValue(
      mockSupabase as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: TEST_USER },
      error: null,
    });
    mockEnforceRateLimit.mockResolvedValue(null);
    mockConsumeFeatureUsage.mockResolvedValue({ success: true });
  });

  it("should successfully translate elements", async () => {
    const mockElements = [
      { id: "header-1", text: "Welcome to our website" },
      { id: "btn-1", text: "Get Started" },
    ];

    const mockTranslations = [
      {
        id: "header-1",
        originalText: "Welcome to our website",
        translatedText: "Bienvenido a nuestro sitio web",
      },
      {
        id: "btn-1",
        originalText: "Get Started",
        translatedText: "Empezar",
      },
    ];

    allowSiteAccess();

    // Mock AI service
    mockAiService.batchTranslate.mockResolvedValueOnce({
      success: true,
      data: mockTranslations,
      tokensUsed: 150,
    });

    // Mock database upsert
    mockSupabase.upsert.mockResolvedValueOnce({ error: null });

    const request = new NextRequest("http://localhost/api/ai/translate", {
      method: "POST",
      body: JSON.stringify({
        siteId: VALID_SITE_ID,
        fromLanguage: "en",
        toLanguage: "es",
        elements: mockElements,
        context: "website homepage",
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      translations: mockTranslations,
      tokensUsed: 150,
      message: "Successfully translated 2 elements to es",
    });

    // Verify AI service call
    expect(mockAiService.batchTranslate).toHaveBeenCalledWith(
      mockElements,
      "en",
      "es",
      "website homepage",
    );

    // Verify database upsert
    expect(mockSupabase.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          site_id: VALID_SITE_ID,
          element_id: "header-1",
          original_content: "Welcome to our website",
          current_content: "Bienvenido a nuestro sitio web",
          language: "es",
          variant: "default",
          metadata: {
            translatedFrom: "en",
            aiGenerated: true,
            tokensUsed: 150,
          },
        }),
      ]),
      { onConflict: "site_id,element_id,language,variant" },
    );
  });

  it("should return 400 when required fields are missing", async () => {
    // The route validates field-by-field and names the offending field, rather
    // than returning one catch-all message for any missing input.
    const testCases = [
      {
        body: { siteId: VALID_SITE_ID, fromLanguage: "en", toLanguage: "es" },
        error: 'Field "elements" must be a non-empty array',
      },
      {
        body: { fromLanguage: "en", toLanguage: "es", elements: [] },
        error: 'Field "siteId" must be a valid UUID',
      },
      {
        body: { siteId: VALID_SITE_ID, toLanguage: "es", elements: [] },
        error: 'Field "fromLanguage" is required and must be a string',
      },
      {
        body: { siteId: VALID_SITE_ID, fromLanguage: "en", elements: [] },
        error: 'Field "toLanguage" is required and must be a string',
      },
    ];

    for (const testCase of testCases) {
      const request = new NextRequest("http://localhost/api/ai/translate", {
        method: "POST",
        body: JSON.stringify(testCase.body),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: testCase.error });
    }
  });

  it("should reject a siteId that is not a UUID", async () => {
    const request = new NextRequest("http://localhost/api/ai/translate", {
      method: "POST",
      body: JSON.stringify({
        siteId: "site-123",
        fromLanguage: "en",
        toLanguage: "es",
        elements: [{ id: "test", text: "test" }],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Field "siteId" must be a valid UUID' });
  });

  it("should reject a batch larger than the per-request element cap", async () => {
    const request = new NextRequest("http://localhost/api/ai/translate", {
      method: "POST",
      body: JSON.stringify({
        siteId: VALID_SITE_ID,
        fromLanguage: "en",
        toLanguage: "es",
        elements: Array.from({ length: 101 }, (_, i) => ({
          id: `el-${i}`,
          text: "text",
        })),
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Field "elements" must contain at most 100 items',
    });
  });

  it("should return 401 when there is no authenticated user", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const request = new NextRequest("http://localhost/api/ai/translate", {
      method: "POST",
      body: JSON.stringify({
        siteId: VALID_SITE_ID,
        fromLanguage: "en",
        toLanguage: "es",
        elements: [{ id: "test", text: "test" }],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mockAiService.batchTranslate).not.toHaveBeenCalled();
  });

  it("should return 403 when the caller holds no permission on the site", async () => {
    mockSupabase.single
      .mockResolvedValueOnce({ data: { id: VALID_SITE_ID }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const request = new NextRequest("http://localhost/api/ai/translate", {
      method: "POST",
      body: JSON.stringify({
        siteId: VALID_SITE_ID,
        fromLanguage: "en",
        toLanguage: "es",
        elements: [{ id: "test", text: "test" }],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    // A caller without a permission row must never reach the paid model call.
    expect(mockAiService.batchTranslate).not.toHaveBeenCalled();
  });

  it("should return 403 when the plan quota rejects the translation", async () => {
    allowSiteAccess();
    mockConsumeFeatureUsage.mockResolvedValue({
      success: false,
      error: "Translation features require a Pro or Enterprise plan",
    });

    const request = new NextRequest("http://localhost/api/ai/translate", {
      method: "POST",
      body: JSON.stringify({
        siteId: VALID_SITE_ID,
        fromLanguage: "en",
        toLanguage: "es",
        elements: [{ id: "test", text: "test" }],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.requiresUpgrade).toBe(true);
    expect(mockAiService.batchTranslate).not.toHaveBeenCalled();
  });

  it("should short-circuit when the IP rate limiter rejects the request", async () => {
    mockEnforceRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: "Too many requests" }, { status: 429 }),
    );

    const request = new NextRequest("http://localhost/api/ai/translate", {
      method: "POST",
      body: JSON.stringify({
        siteId: VALID_SITE_ID,
        fromLanguage: "en",
        toLanguage: "es",
        elements: [{ id: "test", text: "test" }],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(429);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("should return 404 when site not found", async () => {
    // Site lookup misses; the permission lookup is never reached.
    mockSupabase.single.mockResolvedValueOnce({ data: null, error: null });

    const request = new NextRequest("http://localhost/api/ai/translate", {
      method: "POST",
      body: JSON.stringify({
        // Well-formed but unknown — otherwise the UUID check rejects it at 400
        // and this never exercises the "site not found" path it claims to test.
        siteId: "99999999-8888-4777-a666-555555555555",
        fromLanguage: "en",
        toLanguage: "es",
        elements: [{ id: "test", text: "test" }],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({
      error: "Site not found",
    });
  });

  it("should return 500 when AI service fails", async () => {
    allowSiteAccess();

    // Mock AI service failure
    mockAiService.batchTranslate.mockResolvedValueOnce({
      success: false,
      error: "OpenAI API error",
    });

    const request = new NextRequest("http://localhost/api/ai/translate", {
      method: "POST",
      body: JSON.stringify({
        siteId: VALID_SITE_ID,
        fromLanguage: "en",
        toLanguage: "es",
        elements: [{ id: "test", text: "test" }],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: "OpenAI API error",
    });
  });

  it("should still return success when database save fails", async () => {
    const mockElements = [{ id: "header-1", text: "Welcome" }];

    const mockTranslations = [
      {
        id: "header-1",
        originalText: "Welcome",
        translatedText: "Bienvenido",
      },
    ];

    allowSiteAccess();

    // Mock AI service success
    mockAiService.batchTranslate.mockResolvedValueOnce({
      success: true,
      data: mockTranslations,
      tokensUsed: 50,
    });

    // Mock database upsert failure
    mockSupabase.upsert.mockResolvedValueOnce({
      error: { message: "Database error" },
    });

    const request = new NextRequest("http://localhost/api/ai/translate", {
      method: "POST",
      body: JSON.stringify({
        siteId: VALID_SITE_ID,
        fromLanguage: "en",
        toLanguage: "es",
        elements: mockElements,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      translations: mockTranslations,
      tokensUsed: 50,
      message: "Successfully translated 1 elements to es",
    });
  });

  it("should handle translation without context", async () => {
    const mockElements = [{ id: "test", text: "Hello" }];

    allowSiteAccess();

    // Mock AI service
    mockAiService.batchTranslate.mockResolvedValueOnce({
      success: true,
      data: [{ id: "test", originalText: "Hello", translatedText: "Hola" }],
      tokensUsed: 25,
    });

    // Mock database upsert
    mockSupabase.upsert.mockResolvedValueOnce({ error: null });

    const request = new NextRequest("http://localhost/api/ai/translate", {
      method: "POST",
      body: JSON.stringify({
        siteId: VALID_SITE_ID,
        fromLanguage: "en",
        toLanguage: "es",
        elements: mockElements,
        // No context provided
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockAiService.batchTranslate).toHaveBeenCalledWith(
      mockElements,
      "en",
      "es",
      undefined,
    );
  });

  it("should reject an empty elements array instead of calling the model", async () => {
    const request = new NextRequest("http://localhost/api/ai/translate", {
      method: "POST",
      body: JSON.stringify({
        siteId: VALID_SITE_ID,
        fromLanguage: "en",
        toLanguage: "es",
        elements: [],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Field "elements" must be a non-empty array',
    });
    expect(mockAiService.batchTranslate).not.toHaveBeenCalled();
  });

  it("should handle malformed JSON", async () => {
    const request = new NextRequest("http://localhost/api/ai/translate", {
      method: "POST",
      body: "invalid-json",
    });

    const response = await POST(request);
    const data = await response.json();

    // A body the client got wrong is a 400, not a 500. This previously fell
    // through to the catch-all handler and reported a server fault.
    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: "Request body must be valid JSON",
    });
  });

  it("should handle unsupported language codes", async () => {
    allowSiteAccess();

    // Mock AI service failure for unsupported language
    mockAiService.batchTranslate.mockResolvedValueOnce({
      success: false,
      error: "Unsupported language: xyz",
    });

    const request = new NextRequest("http://localhost/api/ai/translate", {
      method: "POST",
      body: JSON.stringify({
        siteId: VALID_SITE_ID,
        fromLanguage: "en",
        toLanguage: "xyz",
        elements: [{ id: "test", text: "test" }],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: "Unsupported language: xyz",
    });
  });

  it("should handle AI service exception", async () => {
    allowSiteAccess();

    // Mock AI service throwing an exception
    mockAiService.batchTranslate.mockRejectedValueOnce(
      new Error("Network error"),
    );

    const request = new NextRequest("http://localhost/api/ai/translate", {
      method: "POST",
      body: JSON.stringify({
        siteId: VALID_SITE_ID,
        fromLanguage: "en",
        toLanguage: "es",
        elements: [{ id: "test", text: "test" }],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: "Internal server error",
    });
  });
});
