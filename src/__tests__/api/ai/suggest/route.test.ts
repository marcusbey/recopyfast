// Mock dependencies first before any imports
jest.mock("@/lib/ai/openai-service", () => ({
  aiService: {
    batchTranslate: jest.fn(),
    translateText: jest.fn(),
    generateContentSuggestion: jest.fn(),
    detectLanguage: jest.fn(),
  },
}));

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(),
}));

jest.mock("@/lib/feature-gating/permissions", () => ({
  consumeFeatureUsage: jest.fn(),
}));

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(),
  getClientIp: jest.fn(() => "127.0.0.1"),
}));

import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/ai/suggest/route";
import { aiService } from "@/lib/ai/openai-service";
import { createClient } from "@/lib/supabase/server";
import { consumeFeatureUsage } from "@/lib/feature-gating/permissions";
import { enforceRateLimit } from "@/lib/api/rate-limit";

const mockAiService = aiService as jest.Mocked<typeof aiService>;
const mockCreateClient = createClient as jest.Mock;
const mockConsumeFeatureUsage = consumeFeatureUsage as jest.Mock;
const mockEnforceRateLimit = enforceRateLimit as jest.Mock;

const TEST_USER = { id: "user-123", email: "user@example.com" };

const postRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/ai/suggest", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const validBody = {
  text: "Improve your business",
  context: "homepage hero section",
  tone: "professional",
  goal: "improve",
};

describe("/api/ai/suggest - POST", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Rate limiters allow the request through by returning null.
    mockEnforceRateLimit.mockResolvedValue(null);
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: TEST_USER },
          error: null,
        }),
      },
    });
    mockConsumeFeatureUsage.mockResolvedValue({ success: true });
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
        postRequest({ text: "Some text", context: "some context" }),
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

  describe("authentication and rate limiting", () => {
    it("should return 401 when there is no authenticated user", async () => {
      mockCreateClient.mockResolvedValue({
        auth: {
          getUser: jest
            .fn()
            .mockResolvedValue({ data: { user: null }, error: null }),
        },
      });

      const response = await POST(postRequest(validBody));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized" });
      expect(mockAiService.generateContentSuggestion).not.toHaveBeenCalled();
    });

    it("should short-circuit when the IP rate limiter rejects the request", async () => {
      mockEnforceRateLimit.mockResolvedValueOnce(
        NextResponse.json({ error: "Too many requests" }, { status: 429 }),
      );

      const response = await POST(postRequest(validBody));

      expect(response.status).toBe(429);
      // Rejected before the user lookup, so only the IP limiter ran.
      expect(mockEnforceRateLimit).toHaveBeenCalledTimes(1);
      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it("should short-circuit when the per-user rate limiter rejects the request", async () => {
      mockEnforceRateLimit
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          NextResponse.json({ error: "Slow down" }, { status: 429 }),
        );

      const response = await POST(postRequest(validBody));

      expect(response.status).toBe(429);
      expect(mockAiService.generateContentSuggestion).not.toHaveBeenCalled();
    });
  });

  describe("quota enforcement", () => {
    it("should return 403 and flag an upgrade when the plan has no AI access", async () => {
      mockConsumeFeatureUsage.mockResolvedValue({
        success: false,
        error: "AI features require a Pro or Enterprise plan",
      });

      const response = await POST(postRequest(validBody));
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("AI features require a Pro or Enterprise plan");
      expect(data.requiresUpgrade).toBe(true);
      expect(mockAiService.generateContentSuggestion).not.toHaveBeenCalled();
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
        TEST_USER.id,
        "ai_suggestion",
        expect.objectContaining({ originalText: "a".repeat(100) }),
      );
    });
  });

  describe("input validation", () => {
    it("should return 400 when text is missing", async () => {
      const response = await POST(postRequest({ context: "some context" }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Field "text" is required and must be a string',
      });
    });

    it("should return 400 when context is missing", async () => {
      const response = await POST(postRequest({ text: "some text" }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Field "context" is required and must be a string',
      });
    });

    it("should return 400 for an empty text field", async () => {
      const response = await POST(
        postRequest({ text: "   ", context: "some context" }),
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Field "text" must be at least 1 characters',
      });
    });

    it("should return 400 when text exceeds the 5000 character prompt ceiling", async () => {
      const response = await POST(
        postRequest({ text: "a".repeat(5001), context: "some context" }),
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
        postRequest({ text: "some text", context: "a".repeat(1001) }),
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

      expect(response.status).toBe(400);
      expect(data.error).toBe(
        'Field "goal" must be one of: improve, shorten, expand, optimize',
      );
    });

    it("should return 400 for malformed JSON", async () => {
      const response = await POST(postRequest("{ invalid json"));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: "Request body must be valid JSON" });
    });
  });

  describe("AI service failures", () => {
    it("should return 500 when the AI service reports a failure", async () => {
      mockAiService.generateContentSuggestion.mockResolvedValueOnce({
        success: false,
        error: "OpenAI API rate limit exceeded",
      });

      const response = await POST(postRequest(validBody));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: "OpenAI API rate limit exceeded" });
    });

    it("should return 500 when the AI service throws", async () => {
      mockAiService.generateContentSuggestion.mockRejectedValueOnce(
        new Error("Network failure"),
      );

      const response = await POST(postRequest(validBody));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: "Internal server error" });
    });
  });
});
