/**
 * `POST /api/ai/suggest` — behaviour: validation, limiter order, messages,
 * refunds. Rewritten for s40.
 *
 * The previous version of this suite pinned cookie authentication and a
 * per-user limiter — the very things that made the route 401 for its only
 * caller, the widget on a customer's origin, which carries no cookie. The
 * security of the new authentication is asserted through the REAL editor-access
 * code in `editor-credentials.test.ts`; here the validator is mocked for speed
 * and clarity while `requireEditorPermission` stays real, so the grading is
 * still the codebase's one widening rule.
 */

jest.mock("@/lib/ai/openai-service", () => ({
  aiService: {
    batchTranslate: jest.fn(),
    translateText: jest.fn(),
    generateContentSuggestion: jest.fn(),
    detectLanguage: jest.fn(),
  },
}));

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => {
    throw new Error("the AI route must not open a cookie client");
  }),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));

jest.mock("@/lib/auth/editor-access", () => ({
  ...jest.requireActual("@/lib/auth/editor-access"),
  validateEditorTokenFromRequest: jest.fn(),
}));

jest.mock("@/lib/feature-gating/permissions", () => ({
  consumeFeatureUsage: jest.fn(),
  resolveSiteOwnerId: jest.fn(),
}));

jest.mock("@/lib/credits/system", () => ({
  CREDIT_COSTS: { AI_SUGGESTION: 1 },
  refundCredits: jest.fn(),
}));

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(),
  getClientIp: jest.fn(() => "127.0.0.1"),
}));

import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/ai/suggest/route";
import { aiService } from "@/lib/ai/openai-service";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { validateEditorTokenFromRequest } from "@/lib/auth/editor-access";
import type { EditorAccess } from "@/lib/auth/editor-access";
import {
  consumeFeatureUsage,
  resolveSiteOwnerId,
} from "@/lib/feature-gating/permissions";
import { refundCredits } from "@/lib/credits/system";
import { enforceRateLimit } from "@/lib/api/rate-limit";

const mockAiService = aiService as jest.Mocked<typeof aiService>;
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock;
const mockValidate = validateEditorTokenFromRequest as jest.Mock;
const mockConsumeFeatureUsage = consumeFeatureUsage as jest.Mock;
const mockResolveSiteOwnerId = resolveSiteOwnerId as jest.Mock;
const mockRefundCredits = refundCredits as jest.Mock;
const mockEnforceRateLimit = enforceRateLimit as jest.Mock;

const SITE_ID = "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";
const OWNER_ID = "owner-user-1";
const SERVICE_CLIENT = { service: true };

const GRANT_EDITOR: EditorAccess = {
  kind: "device-grant",
  siteId: SITE_ID,
  token: "rcfg1.grant",
  permissions: ["view", "edit"],
  email: "bob@corp.example",
  verified: true,
};

const OWNER_SESSION: EditorAccess = {
  kind: "edit-session",
  siteId: SITE_ID,
  token: "edit-tok",
  permissions: ["view", "edit", "publish", "admin"],
  userId: OWNER_ID,
  verified: true,
};

const postRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/ai/suggest", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const validBody = {
  siteId: SITE_ID,
  text: "Improve your business",
  context: "homepage hero section",
  tone: "professional",
  goal: "improve",
};

function expectPublicCors(response: Response) {
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
}

const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;

describe("/api/ai/suggest - POST", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks keeps queued `mockResolvedValueOnce` values; a test that
    // stops early would hand its leftovers to the next one.
    mockAiService.generateContentSuggestion.mockReset();
    process.env.OPENAI_API_KEY = "sk-test-configured";
    jest.spyOn(console, "error").mockImplementation(() => {});
    // Rate limiters allow the request through by returning null.
    mockEnforceRateLimit.mockResolvedValue(null);
    mockValidate.mockResolvedValue({ valid: true, access: GRANT_EDITOR });
    mockCreateServiceRoleClient.mockReturnValue(SERVICE_CLIENT);
    mockResolveSiteOwnerId.mockResolvedValue(OWNER_ID);
    mockConsumeFeatureUsage.mockResolvedValue({ success: true });
    mockRefundCredits.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (ORIGINAL_OPENAI_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_KEY;
    }
  });

  describe("happy path", () => {
    it("should successfully generate content suggestions", async () => {
      const mockSuggestions = [
        "Transform your business with our innovative solutions",
        "Revolutionize your workflow with cutting-edge technology",
        "Elevate your operations with advanced digital tools",
      ];

      mockAiService.generateContentSuggestion.mockResolvedValueOnce({
        success: true,
        data: mockSuggestions,
        tokensUsed: 75,
      });

      const response = await POST(postRequest(validBody));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        suggestions: mockSuggestions,
        tokensUsed: 75,
        originalText: "Improve your business",
      });

      expect(mockAiService.generateContentSuggestion).toHaveBeenCalledWith({
        originalText: "Improve your business",
        context: "homepage hero section",
        tone: "professional",
        goal: "improve",
      });
    });

    it("should use default tone and goal when not provided", async () => {
      mockAiService.generateContentSuggestion.mockResolvedValueOnce({
        success: true,
        data: ["A suggestion"],
        tokensUsed: 10,
      });

      const response = await POST(
        postRequest({
          siteId: SITE_ID,
          text: "Some text",
          context: "some context",
        }),
      );

      expect(response.status).toBe(200);
      expect(mockAiService.generateContentSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({ tone: "professional", goal: "improve" }),
      );
    });

    it("should accept every supported tone", async () => {
      for (const tone of ["professional", "casual", "marketing", "technical"]) {
        mockAiService.generateContentSuggestion.mockResolvedValueOnce({
          success: true,
          data: ["A suggestion"],
          tokensUsed: 10,
        });

        const response = await POST(postRequest({ ...validBody, tone }));

        expect(response.status).toBe(200);
        expect(mockAiService.generateContentSuggestion).toHaveBeenCalledWith(
          expect.objectContaining({ tone }),
        );
      }
    });

    it("should accept every supported goal", async () => {
      for (const goal of ["improve", "shorten", "expand", "optimize"]) {
        mockAiService.generateContentSuggestion.mockResolvedValueOnce({
          success: true,
          data: ["A suggestion"],
          tokensUsed: 10,
        });

        const response = await POST(postRequest({ ...validBody, goal }));

        expect(response.status).toBe(200);
        expect(mockAiService.generateContentSuggestion).toHaveBeenCalledWith(
          expect.objectContaining({ goal }),
        );
      }
    });

    it("accepts every goal the widget's modal offers", async () => {
      // recopyfast.src.js `showAISuggestions` offers these six and always sends
      // tone "professional". Three of them used to be 400s that the modal
      // reported as "Failed to generate suggestions".
      for (const goal of [
        "improve",
        "shorten",
        "expand",
        "engage",
        "professional",
        "casual",
      ]) {
        mockAiService.generateContentSuggestion.mockResolvedValueOnce({
          success: true,
          data: ["A suggestion"],
          tokensUsed: 10,
        });

        const response = await POST(
          postRequest({ ...validBody, goal, tone: "professional" }),
        );

        expect(response.status).toBe(200);
      }
    });

    it.each([
      ["engage", "professional", { goal: "optimize", tone: "professional" }],
      [
        "professional",
        "professional",
        { goal: "improve", tone: "professional" },
      ],
      ["casual", "professional", { goal: "improve", tone: "casual" }],
    ])(
      "maps the modal's %s goal onto what the model understands",
      async (goal, tone, expected) => {
        mockAiService.generateContentSuggestion.mockResolvedValueOnce({
          success: true,
          data: ["A suggestion"],
          tokensUsed: 10,
        });

        await POST(postRequest({ ...validBody, goal, tone }));

        expect(mockAiService.generateContentSuggestion).toHaveBeenCalledWith(
          expect.objectContaining(expected),
        );
      },
    );

    it("should handle empty suggestions from the AI service", async () => {
      mockAiService.generateContentSuggestion.mockResolvedValueOnce({
        success: true,
        data: [],
        tokensUsed: 5,
      });

      const response = await POST(postRequest(validBody));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.suggestions).toEqual([]);
    });

    it("should preserve unicode and special characters", async () => {
      const text = "Améliorez 你的 business — 100% 🚀";
      mockAiService.generateContentSuggestion.mockResolvedValueOnce({
        success: true,
        data: ["Suggestion"],
        tokensUsed: 10,
      });

      const response = await POST(postRequest({ ...validBody, text }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.originalText).toBe(text);
    });
  });

  describe("authorization", () => {
    it("passes the parsed body to the editor validator, for the site it names", async () => {
      mockAiService.generateContentSuggestion.mockResolvedValueOnce({
        success: true,
        data: ["A suggestion"],
        tokensUsed: 10,
      });
      const body = { ...validBody, editToken: "edit-tok" };

      await POST(postRequest(body));

      expect(mockValidate).toHaveBeenCalledWith(
        expect.objectContaining({ siteId: SITE_ID, body }),
      );
    });

    it("answers the validator's refusal with its status and reason, and spends nothing", async () => {
      mockValidate.mockResolvedValueOnce({
        valid: false,
        error: "origin_mismatch",
        status: 401,
      });

      const response = await POST(postRequest(validBody));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "origin_mismatch" });
      expectPublicCors(response);
      expect(mockResolveSiteOwnerId).not.toHaveBeenCalled();
      expect(mockConsumeFeatureUsage).not.toHaveBeenCalled();
      expect(mockAiService.generateContentSuggestion).not.toHaveBeenCalled();
    });

    it("defaults a refusal without a status to 401", async () => {
      mockValidate.mockResolvedValueOnce({
        valid: false,
        error: "Missing editor token",
      });

      const response = await POST(postRequest(validBody));

      expect(response.status).toBe(401);
    });

    it("refuses a view-only editor with 403", async () => {
      mockValidate.mockResolvedValueOnce({
        valid: true,
        access: { ...GRANT_EDITOR, permissions: ["view"] },
      });

      const response = await POST(postRequest(validBody));
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toEqual({ error: "Requires 'edit' permission" });
      expect(mockConsumeFeatureUsage).not.toHaveBeenCalled();
    });

    it.each([
      ["missing", { ...validBody, siteId: undefined }],
      ["not a UUID", { ...validBody, siteId: "site-abc" }],
    ])(
      "returns 400 when siteId is %s, before any auth call",
      async (_label, body) => {
        const response = await POST(postRequest(body));
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data).toEqual({ error: 'Field "siteId" must be a valid UUID' });
        expectPublicCors(response);
        expect(mockValidate).not.toHaveBeenCalled();
      },
    );
  });

  describe("rate limiting", () => {
    it("short-circuits on the IP limiter, with CORS, before parsing the body or authorising", async () => {
      mockEnforceRateLimit.mockResolvedValueOnce(
        NextResponse.json({ error: "Too many requests" }, { status: 429 }),
      );
      const request = postRequest(validBody);
      const readBody = jest.spyOn(request, "json");

      const response = await POST(request);

      expect(response.status).toBe(429);
      // Readable by the widget: a 429 without CORS reaches the page as a
      // network error and reads "Error connecting to AI service".
      expectPublicCors(response);
      expect(mockEnforceRateLimit).toHaveBeenCalledTimes(1);
      expect(readBody).not.toHaveBeenCalled();
      expect(mockValidate).not.toHaveBeenCalled();
    });

    it("meters the site, fail closed, only after the editor is graded", async () => {
      mockAiService.generateContentSuggestion.mockResolvedValueOnce({
        success: true,
        data: ["A suggestion"],
        tokensUsed: 10,
      });

      await POST(postRequest(validBody));

      expect(mockEnforceRateLimit).toHaveBeenCalledTimes(2);
      expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({
          limit: "API_UPLOAD",
          endpoint: "ai/suggest",
          identifier: SITE_ID,
          identifierType: "api_key",
          onStoreFailure: "deny",
        }),
      );
      expect(mockValidate.mock.invocationCallOrder[0]).toBeLessThan(
        mockEnforceRateLimit.mock.invocationCallOrder[1],
      );
    });

    it("never meters the site for a caller who failed the grade", async () => {
      // A site id is public. A per-site bucket in front of the grade would let
      // anyone lock the owner out of AI by naming their site.
      mockValidate.mockResolvedValueOnce({
        valid: false,
        error: "Missing editor token",
        status: 401,
      });

      const response = await POST(postRequest(validBody));

      // The grade really ran and really refused — so the single limiter call
      // below is the IP one, not a crash before anything was decided.
      expect(mockValidate).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(401);
      expect(mockEnforceRateLimit).toHaveBeenCalledTimes(1);
      expect(mockEnforceRateLimit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ endpoint: "ai/suggest:ip" }),
      );
    });

    it("refuses on the per-site limiter with CORS, and charges nothing", async () => {
      mockEnforceRateLimit
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          NextResponse.json({ error: "Slow down" }, { status: 429 }),
        );

      const response = await POST(postRequest(validBody));

      expect(response.status).toBe(429);
      expectPublicCors(response);
      expect(mockConsumeFeatureUsage).not.toHaveBeenCalled();
      expect(mockAiService.generateContentSuggestion).not.toHaveBeenCalled();
    });
  });

  describe("the payer", () => {
    it("charges the site owner through the service client, with the editor named", async () => {
      mockAiService.generateContentSuggestion.mockResolvedValueOnce({
        success: true,
        data: ["Suggestion"],
        tokensUsed: 10,
      });

      await POST(postRequest(validBody));

      expect(mockResolveSiteOwnerId).toHaveBeenCalledWith(
        SERVICE_CLIENT,
        SITE_ID,
      );
      expect(mockConsumeFeatureUsage).toHaveBeenCalledWith(
        OWNER_ID,
        "ai_suggestion",
        expect.objectContaining({
          siteId: SITE_ID,
          editor: "bob@corp.example",
        }),
        SERVICE_CLIENT,
      );
    });

    it("should record a truncated sample of the original text for analytics", async () => {
      const longText = "a".repeat(500);
      mockAiService.generateContentSuggestion.mockResolvedValueOnce({
        success: true,
        data: ["Suggestion"],
        tokensUsed: 10,
      });

      await POST(postRequest({ ...validBody, text: longText }));

      expect(mockConsumeFeatureUsage).toHaveBeenCalledWith(
        OWNER_ID,
        "ai_suggestion",
        expect.objectContaining({ originalText: "a".repeat(100) }),
        SERVICE_CLIENT,
      );
    });

    it("refuses a site with no admin row, logs it, and charges nothing", async () => {
      mockResolveSiteOwnerId.mockResolvedValueOnce(null);

      const response = await POST(postRequest(validBody));
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toEqual({
        error: "AI suggestions aren't available on this site.",
      });
      expectPublicCors(response);
      expect(console.error).toHaveBeenCalled();
      expect(mockConsumeFeatureUsage).not.toHaveBeenCalled();
      expect(mockAiService.generateContentSuggestion).not.toHaveBeenCalled();
    });
  });

  describe("quota enforcement", () => {
    it("shows the owner the gate's own reason, flagged for upgrade", async () => {
      mockValidate.mockResolvedValueOnce({
        valid: true,
        access: OWNER_SESSION,
      });
      mockConsumeFeatureUsage.mockResolvedValueOnce({
        success: false,
        error:
          "Your Starter plan does not include AI credits. Buy credits to use AI features — this costs 1 and you have 0.",
      });

      const response = await POST(postRequest(validBody));
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toEqual({
        error:
          "Your Starter plan does not include AI credits. Buy credits to use AI features — this costs 1 and you have 0.",
        requiresUpgrade: true,
      });
      expect(mockAiService.generateContentSuggestion).not.toHaveBeenCalled();
    });

    it("tells an invited editor to ask the owner, rather than about 'your plan'", async () => {
      // The gate's sentences say "Your … plan". Said to a grant holder, that is
      // about somebody else's plan, and they have no billing page to visit.
      mockConsumeFeatureUsage.mockResolvedValueOnce({
        success: false,
        error: "This account has no active plan. Choose a plan to continue.",
      });

      const response = await POST(postRequest(validBody));
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toEqual({
        error:
          "AI suggestions aren't available on this site's plan right now. Ask the site owner to add AI credits.",
        requiresUpgrade: true,
      });
      expectPublicCors(response);
      expect(mockAiService.generateContentSuggestion).not.toHaveBeenCalled();
    });
  });

  describe("input validation", () => {
    it("should return 400 when text is missing", async () => {
      const response = await POST(
        postRequest({ siteId: SITE_ID, context: "some context" }),
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Field "text" is required and must be a string',
      });
      expect(mockValidate).not.toHaveBeenCalled();
    });

    it("should return 400 when context is missing", async () => {
      const response = await POST(
        postRequest({ siteId: SITE_ID, text: "some text" }),
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Field "context" is required and must be a string',
      });
    });

    it("should return 400 for an empty text field", async () => {
      const response = await POST(
        postRequest({ siteId: SITE_ID, text: "   ", context: "some context" }),
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Field "text" must be at least 1 characters',
      });
    });

    it("should return 400 when text exceeds the 5000 character prompt ceiling", async () => {
      const response = await POST(
        postRequest({
          siteId: SITE_ID,
          text: "a".repeat(5001),
          context: "some context",
        }),
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Field "text" must be at most 5000 characters',
      });
      expect(mockAiService.generateContentSuggestion).not.toHaveBeenCalled();
    });

    it("should return 400 when context exceeds the 1000 character ceiling", async () => {
      const response = await POST(
        postRequest({
          siteId: SITE_ID,
          text: "some text",
          context: "a".repeat(1001),
        }),
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Field "context" must be at most 1000 characters',
      });
    });

    it("should reject an unsupported tone rather than silently defaulting", async () => {
      const response = await POST(
        postRequest({ ...validBody, tone: "invalid-tone" }),
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe(
        'Field "tone" must be one of: professional, casual, marketing, technical',
      );
    });

    it("should reject an unsupported goal rather than silently defaulting", async () => {
      const response = await POST(
        postRequest({ ...validBody, goal: "invalid-goal" }),
      );
      const data = await response.json();

      // Lists every accepted value, the modal's vocabulary included (s40).
      expect(response.status).toBe(400);
      expect(data.error).toBe(
        'Field "goal" must be one of: improve, shorten, expand, optimize, engage, professional, casual',
      );
      expect(mockValidate).not.toHaveBeenCalled();
    });

    it("should return 400 for malformed JSON", async () => {
      const response = await POST(postRequest("{ invalid json"));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: "Request body must be valid JSON" });
      expectPublicCors(response);
    });
  });

  describe("configuration", () => {
    it.each([
      ["unset", undefined],
      ["blank", "   "],
    ])(
      "refuses with 503 when OPENAI_API_KEY is %s, before any owner lookup or charge",
      async (_label, value) => {
        // The SDK throws at construction when the key is missing, which the old
        // route only discovered after charging: it charged, refunded, and
        // echoed the SDK's sentence about environment variables to the page.
        if (value === undefined) {
          delete process.env.OPENAI_API_KEY;
        } else {
          process.env.OPENAI_API_KEY = value;
        }

        const response = await POST(postRequest(validBody));
        const data = await response.json();

        expect(response.status).toBe(503);
        expect(data).toEqual({
          error: "AI suggestions are not available right now.",
        });
        expectPublicCors(response);
        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining("OPENAI_API_KEY"),
        );
        expect(mockResolveSiteOwnerId).not.toHaveBeenCalled();
        expect(mockConsumeFeatureUsage).not.toHaveBeenCalled();
        expect(mockAiService.generateContentSuggestion).not.toHaveBeenCalled();
      },
    );
  });

  describe("AI service failures", () => {
    it("refunds the owner and answers 502 without echoing the provider", async () => {
      mockAiService.generateContentSuggestion.mockResolvedValueOnce({
        success: false,
        error: "OpenAI API rate limit exceeded",
      });

      const response = await POST(postRequest(validBody));
      const data = await response.json();

      expect(mockRefundCredits).toHaveBeenCalledWith(
        OWNER_ID,
        1,
        "ai_suggestion_failed",
      );
      expect(response.status).toBe(502);
      expect(data).toEqual({
        error:
          "AI suggestions are unavailable right now. You were not charged.",
      });
      expect(JSON.stringify(data)).not.toContain("rate limit");
      expectPublicCors(response);
      // The provider's detail goes to the log, where it is actionable.
      expect(console.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("OpenAI API rate limit exceeded"),
      );
    });

    it("refunds the owner when the model call throws after the charge", async () => {
      mockAiService.generateContentSuggestion.mockRejectedValueOnce(
        new Error("Network failure"),
      );

      const response = await POST(postRequest(validBody));
      const data = await response.json();

      // Reached the model — this 500 is the model's failure, not an earlier crash.
      expect(mockAiService.generateContentSuggestion).toHaveBeenCalledTimes(1);
      expect(mockRefundCredits).toHaveBeenCalledWith(
        OWNER_ID,
        1,
        "ai_suggestion_failed",
      );
      expect(response.status).toBe(500);
      expect(data).toEqual({ error: "Internal server error" });
      expectPublicCors(response);
    });

    it("refunds nothing when the gate itself throws, before the charge landed", async () => {
      // A refund is a fresh non-expiring grant. Refunding a charge that never
      // happened would mint a credit on every failed balance read.
      mockConsumeFeatureUsage.mockRejectedValueOnce(
        new Error("credit_purchases read failed: connection reset"),
      );

      const response = await POST(postRequest(validBody));

      expect(mockConsumeFeatureUsage).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(500);
      expect(mockRefundCredits).not.toHaveBeenCalled();
      expectPublicCors(response);
    });
  });
});
