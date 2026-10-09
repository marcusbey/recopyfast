// Mock dependencies first before any imports

// The fixture's owner holds a plan (s51). The owner-plan gate itself is
// proved in src/__tests__/api/owner-plan-gate.test.ts.
jest.mock("@/lib/billing/owner-can-edit", () => ({
  ...jest.requireActual("@/lib/billing/owner-can-edit"),
  checkOwnerCanEdit: jest.fn(() =>
    Promise.resolve({ ok: true, ownerId: "owner-1" }),
  ),
}));

jest.mock("@/lib/ai/openai-service", () => ({
  aiService: {
    batchTranslate: jest.fn(),
    translateText: jest.fn(),
    generateContentSuggestion: jest.fn(),
    detectLanguage: jest.fn(),
  },
}));
jest.mock("@/lib/supabase/server");
// The translated rows are written through the service role since s56 (ADR 042).
jest.mock("@/lib/supabase/service");

jest.mock("@/lib/feature-gating/permissions", () => ({
  consumeFeatureUsage: jest.fn(),
}));

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(),
  getClientIp: jest.fn(() => "127.0.0.1"),
}));

// Without this mock the route's refund ran the real one against a placeholder
// service client and failed silently, so no test could see a refund (s48).
jest.mock("@/lib/credits/system", () => ({
  CREDIT_COSTS: { AI_TRANSLATION: 5 },
  refundCharge: jest.fn(),
}));

import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/ai/translate/route";
import { aiService } from "@/lib/ai/openai-service";
import { createClient } from "@/lib/supabase/server";
import { consumeFeatureUsage } from "@/lib/feature-gating/permissions";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { refundCharge } from "@/lib/credits/system";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { checkOwnerCanEdit } from "@/lib/billing/owner-can-edit";

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

/**
 * The service client. Since s56 (ADR 042) no web principal holds DML on
 * `content_elements`, so the translated rows are upserted here, never on the
 * cookie client above.
 */
const mockService = {
  from: jest.fn(),
  upsert: jest.fn(),
};

const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;
const mockAiService = aiService as jest.Mocked<typeof aiService>;
const mockConsumeFeatureUsage = consumeFeatureUsage as jest.Mock;
const mockEnforceRateLimit = enforceRateLimit as jest.Mock;
const mockRefundCharge = refundCharge as jest.Mock;

/** What the mocked charge returns; every refund must be keyed by exactly this. */
const RECEIPT = {
  usageId: "usage-translate-1",
  userId: TEST_USER.id,
  credits: 5,
};

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
    mockConsumeFeatureUsage.mockResolvedValue({
      success: true,
      charge: RECEIPT,
    });
    mockRefundCharge.mockResolvedValue({ success: true, refunded: 5 });
    mockService.from.mockReturnValue(mockService);
    mockService.upsert.mockResolvedValue({ error: null });
    (createServiceRoleClient as jest.Mock).mockReturnValue(mockService);
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
    mockService.upsert.mockResolvedValueOnce({ error: null });

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

    // Verify database upsert: on the service client, never the cookie client.
    expect(mockSupabase.upsert).not.toHaveBeenCalled();
    expect(mockService.from).toHaveBeenCalledWith("content_elements");
    expect(mockService.upsert).toHaveBeenCalledWith(
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

  /**
   * s56 (ADR 042). The route used to accept ANY permission row, `view`
   * included, and RLS was the only thing refusing a `view` member's upsert —
   * after that member had been charged, with the error swallowed. RLS no
   * longer sees this write (the service role makes it), so the route refuses
   * `view` itself, before the per-site limiter, the gate, the charge and the
   * model.
   */
  it("refuses a view member with 403 before any limiter, gate, charge, model call or write", async () => {
    mockSupabase.single
      .mockResolvedValueOnce({ data: { id: VALID_SITE_ID }, error: null })
      .mockResolvedValueOnce({ data: { permission: "view" }, error: null });

    const response = await POST(
      new NextRequest("http://localhost/api/ai/translate", {
        method: "POST",
        body: JSON.stringify({
          siteId: VALID_SITE_ID,
          fromLanguage: "en",
          toLanguage: "es",
          elements: [{ id: "header-1", text: "Welcome" }],
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    // Only the per-IP limiter ran; the per-site one never did.
    expect(mockEnforceRateLimit).toHaveBeenCalledTimes(1);
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ endpoint: "ai/translate:ip" }),
    );
    expect(checkOwnerCanEdit).not.toHaveBeenCalled();
    expect(mockConsumeFeatureUsage).not.toHaveBeenCalled();
    expect(mockAiService.batchTranslate).not.toHaveBeenCalled();
    expect(mockService.upsert).not.toHaveBeenCalled();
    expect(mockSupabase.upsert).not.toHaveBeenCalled();
  });

  it("writes an edit member's translations through the service client, every row on this site", async () => {
    allowSiteAccess();
    mockAiService.batchTranslate.mockResolvedValueOnce({
      success: true,
      data: [
        { id: "header-1", originalText: "Welcome", translatedText: "Hola" },
        { id: "btn-1", originalText: "Start", translatedText: "Empezar" },
      ],
      tokensUsed: 20,
    });

    const response = await POST(
      new NextRequest("http://localhost/api/ai/translate", {
        method: "POST",
        body: JSON.stringify({
          siteId: VALID_SITE_ID,
          fromLanguage: "en",
          toLanguage: "es",
          elements: [
            { id: "header-1", text: "Welcome" },
            { id: "btn-1", text: "Start" },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockService.upsert).toHaveBeenCalledTimes(1);
    const [rows] = mockService.upsert.mock.calls[0] as [
      Array<{ site_id: string }>,
    ];
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.site_id === VALID_SITE_ID)).toBe(true);
    expect(mockSupabase.upsert).not.toHaveBeenCalled();
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
    // A quota refusal charged nothing, so there is nothing to give back.
    expect(mockRefundCharge).not.toHaveBeenCalled();
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
    mockService.upsert.mockResolvedValueOnce({
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
    mockService.upsert.mockResolvedValueOnce({ error: null });

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
    // s48: the charge had landed, so the catch gives it back.
    expect(mockRefundCharge).toHaveBeenCalledWith(RECEIPT);
  });

  describe("charges and refunds (s48, defect 1)", () => {
    const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;

    afterEach(() => {
      if (ORIGINAL_OPENAI_KEY === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_KEY;
      }
    });

    const elementsOf = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `el-${index}`,
        text: `Text ${index}`,
      }));

    const translationsOf = (elements: Array<{ id: string; text: string }>) =>
      elements.map((element) => ({
        id: element.id,
        originalText: element.text,
        translatedText: `ES ${element.text}`,
      }));

    const translateRequest = (elements: Array<{ id: string; text: string }>) =>
      new NextRequest("http://localhost/api/ai/translate", {
        method: "POST",
        body: JSON.stringify({
          siteId: VALID_SITE_ID,
          fromLanguage: "en",
          toLanguage: "es",
          elements,
        }),
      });

    it("AI key missing: 503, nothing charged, the model never called", async () => {
      // jest.setup.js sets a key; this is the deploy that forgot it. The old
      // route charged 5 credits and answered "Successfully translated 0
      // elements" (next-dev-refund.log).
      process.env.OPENAI_API_KEY = "  ";
      jest.spyOn(console, "error").mockImplementation(() => {});
      allowSiteAccess();

      const response = await POST(translateRequest(elementsOf(1)));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "AI translation is not available right now.",
      });
      expect(mockConsumeFeatureUsage).not.toHaveBeenCalled();
      expect(mockAiService.batchTranslate).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("OPENAI_API_KEY"),
      );
    });

    it.each([
      [
        "a failed batch",
        { success: false, error: "No text could be translated." },
      ],
      ["a batch with no rows", { success: true, data: [] }],
    ])(
      "nothing translated: failure and the whole charge refunded (%s)",
      async (_label, batch) => {
        allowSiteAccess();
        mockAiService.batchTranslate.mockResolvedValueOnce(batch);

        const response = await POST(translateRequest(elementsOf(2)));
        const body = JSON.stringify(await response.json());

        expect(response.status).toBe(500);
        expect(body).not.toContain("Successfully translated");
        expect(mockRefundCharge).toHaveBeenCalledTimes(1);
        expect(mockRefundCharge).toHaveBeenCalledWith(RECEIPT);
        expect(RECEIPT.credits).toBe(5);
      },
    );

    it.each([
      // [elements, translated, refunded]
      [5, 3, 2], // 2 of 5 failed: 5 x 2/5 = 2
      [3, 2, 2], // 1 of 3 failed: 5 x 1/3 = 1.67, rounded up — floor gives 1
    ])(
      "partial batch: the failed share is refunded, rounded up (%i sent, %i translated)",
      async (sent, translated, refunded) => {
        allowSiteAccess();
        const elements = elementsOf(sent);
        const rows = translationsOf(elements.slice(0, translated));
        mockAiService.batchTranslate.mockResolvedValueOnce({
          success: true,
          data: rows,
          tokensUsed: 10,
        });
        mockService.upsert.mockResolvedValueOnce({ error: null });

        const response = await POST(translateRequest(elements));
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.translations).toEqual(rows);
        expect(mockRefundCharge).toHaveBeenCalledTimes(1);
        expect(mockRefundCharge).toHaveBeenCalledWith(RECEIPT, refunded);
      },
    );

    it("every element translated: nothing refunded", async () => {
      allowSiteAccess();
      const elements = elementsOf(3);
      mockAiService.batchTranslate.mockResolvedValueOnce({
        success: true,
        data: translationsOf(elements),
        tokensUsed: 10,
      });
      mockService.upsert.mockResolvedValueOnce({ error: null });

      const response = await POST(translateRequest(elements));

      expect(response.status).toBe(200);
      expect(mockRefundCharge).not.toHaveBeenCalled();
    });

    it("an error after the charge refunds it in the catch", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      allowSiteAccess();
      mockAiService.batchTranslate.mockRejectedValueOnce(
        new Error("socket hang up"),
      );

      const response = await POST(translateRequest(elementsOf(2)));

      expect(response.status).toBe(500);
      expect(mockRefundCharge).toHaveBeenCalledTimes(1);
      expect(mockRefundCharge).toHaveBeenCalledWith(RECEIPT);
    });

    it("an error before the charge refunds nothing", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      allowSiteAccess();
      mockConsumeFeatureUsage.mockRejectedValueOnce(
        new Error("credit_purchases read failed: connection reset"),
      );

      const response = await POST(translateRequest(elementsOf(2)));

      expect(response.status).toBe(500);
      expect(mockRefundCharge).not.toHaveBeenCalled();
    });
  });

  /**
   * s82, ADR 035: the site owner pays for AI on their site — never the
   * caller. This route charged `user.id` through the cookie client, so an
   * invited editor's own wallet was spent (or, holding no plan, they were
   * refused for the owner's site). The fixture's caller (`user-123`) is not
   * its owner (`owner-1`), so every case above was charging a non-owner.
   */
  describe("the payer is the site owner (ADR 035)", () => {
    const OWNER_ID = "owner-1";

    const translateOne = () =>
      new NextRequest("http://localhost/api/ai/translate", {
        method: "POST",
        body: JSON.stringify({
          siteId: VALID_SITE_ID,
          fromLanguage: "en",
          toLanguage: "es",
          elements: [{ id: "hero", text: "Hello" }],
        }),
      });

    const oneTranslated = () =>
      mockAiService.batchTranslate.mockResolvedValueOnce({
        success: true,
        data: [{ id: "hero", originalText: "Hello", translatedText: "Hola" }],
        tokensUsed: 10,
      });

    it("charges the owner's wallet through the service client when an editor translates", async () => {
      allowSiteAccess();
      oneTranslated();

      const response = await POST(translateOne());

      expect(response.status).toBe(200);
      expect(mockConsumeFeatureUsage).toHaveBeenCalledTimes(1);
      expect(mockConsumeFeatureUsage).toHaveBeenCalledWith(
        OWNER_ID,
        "translation",
        expect.objectContaining({
          siteId: VALID_SITE_ID,
          editor: TEST_USER.id,
        }),
        mockService,
      );
    });

    it("charges the owner through the service client when the owner translates", async () => {
      (checkOwnerCanEdit as jest.Mock).mockResolvedValueOnce({
        ok: true,
        ownerId: TEST_USER.id,
      });
      allowSiteAccess();
      oneTranslated();

      await POST(translateOne());

      expect(mockConsumeFeatureUsage).toHaveBeenCalledWith(
        TEST_USER.id,
        "translation",
        expect.objectContaining({ siteId: VALID_SITE_ID }),
        mockService,
      );
    });

    it("tells an editor to ask the owner when the owner's wallet refuses", async () => {
      allowSiteAccess();
      mockConsumeFeatureUsage.mockResolvedValueOnce({
        success: false,
        error: "Insufficient credits. You need 5 credits but only have 0.",
      });

      const response = await POST(translateOne());
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toEqual({
        error:
          "AI translation isn't available on this site's plan right now. Ask the site owner to add AI credits.",
        requiresUpgrade: true,
      });
      expect(mockAiService.batchTranslate).not.toHaveBeenCalled();
    });

    it("shows the owner the gate's own sentence", async () => {
      (checkOwnerCanEdit as jest.Mock).mockResolvedValueOnce({
        ok: true,
        ownerId: TEST_USER.id,
      });
      allowSiteAccess();
      mockConsumeFeatureUsage.mockResolvedValueOnce({
        success: false,
        error: "Insufficient credits. You need 5 credits but only have 0.",
      });

      const response = await POST(translateOne());

      await expect(response.json()).resolves.toEqual({
        error: "Insufficient credits. You need 5 credits but only have 0.",
        requiresUpgrade: true,
      });
    });
  });
});
