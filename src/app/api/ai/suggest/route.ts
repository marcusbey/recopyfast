import { NextRequest, NextResponse } from "next/server";
import { aiService } from "@/lib/ai/openai-service";
import { createClient } from "@/lib/supabase/server";
import { CREDIT_COSTS, refundCredits } from "@/lib/credits/system";
import { consumeFeatureUsage } from "@/lib/feature-gating/permissions";
import { enforceRateLimit, getClientIp } from "@/lib/api/rate-limit";
import {
  optionalEnum,
  readJsonObject,
  requireString,
} from "@/lib/api/validation";
import { withPublicCors, publicOptions } from "@/lib/http/public-cors";

const TONES = ["professional", "casual", "marketing", "technical"] as const;
const GOALS = ["improve", "shorten", "expand", "optimize"] as const;

/** Prompt-size ceilings — these bound the per-request OpenAI token spend. */
const MAX_TEXT_LENGTH = 5000;
const MAX_CONTEXT_LENGTH = 1000;

/** Length of the original-text sample retained for usage analytics. */
const USAGE_SAMPLE_LENGTH = 100;

export async function POST(request: NextRequest) {
  try {
    // Pre-auth IP limit. Every request here is a potential OpenAI call, so the
    // unauthenticated path must be throttled before it can be used to probe
    // for valid sessions at volume.
    const ipLimited = await enforceRateLimit(request, {
      limit: "IP_GENERAL",
      endpoint: "ai/suggest:ip",
      identifier: getClientIp(request),
      onStoreFailure: "deny",
    });
    if (ipLimited) return ipLimited;

    // Check authentication
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return withPublicCors(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
    }

    // Per-user limit on the paid path. Fails CLOSED: quota accounting happens in
    // consumeFeatureUsage, but nothing else caps burst spend, so if the limiter
    // is down we would rather return 503 than hand an authenticated caller an
    // unmetered pipe to the OpenAI bill.
    const userLimited = await enforceRateLimit(request, {
      limit: "API_UPLOAD",
      endpoint: "ai/suggest",
      identifier: user.id,
      identifierType: "user",
      onStoreFailure: "deny",
      message: "Too many AI suggestion requests. Please slow down.",
    });
    if (userLimited) return userLimited;

    const body = await readJsonObject(request);
    if (!body.ok) {
      return withPublicCors(
        NextResponse.json({ error: body.error }, { status: 400 }),
      );
    }

    // Bound every field that reaches the model. Request count alone does not cap
    // spend when a single request may carry an arbitrarily large prompt.
    const text = requireString(body.value, "text", {
      maxLength: MAX_TEXT_LENGTH,
    });
    if (!text.ok) {
      return withPublicCors(
        NextResponse.json({ error: text.error }, { status: 400 }),
      );
    }

    const context = requireString(body.value, "context", {
      maxLength: MAX_CONTEXT_LENGTH,
    });
    if (!context.ok) {
      return withPublicCors(
        NextResponse.json({ error: context.error }, { status: 400 }),
      );
    }

    const tone = optionalEnum(body.value, "tone", TONES);
    if (!tone.ok) {
      return withPublicCors(
        NextResponse.json({ error: tone.error }, { status: 400 }),
      );
    }

    const goal = optionalEnum(body.value, "goal", GOALS);
    if (!goal.ok) {
      return withPublicCors(
        NextResponse.json({ error: goal.error }, { status: 400 }),
      );
    }

    // Check feature access and consume usage
    const usageResult = await consumeFeatureUsage(user.id, "ai_suggestion", {
      originalText: text.value.substring(0, USAGE_SAMPLE_LENGTH), // Store sample for analytics
      context: context.value,
      tone: tone.value,
      goal: goal.value,
    });

    if (!usageResult.success) {
      return withPublicCors(
        NextResponse.json(
          {
            error: usageResult.error,
            requiresUpgrade:
              usageResult.error?.includes("plan") ||
              usageResult.error?.includes("credits"),
          },
          { status: 403 },
        ),
      );
    }

    // Generate content suggestions
    const result = await aiService.generateContentSuggestion({
      originalText: text.value,
      context: context.value,
      tone: tone.value ?? "professional",
      goal: goal.value ?? "improve",
    });

    if (!result.success) {
      // Credits were charged before the model was called, so a provider failure
      // would otherwise bill the customer for nothing.
      await refundCredits(
        user.id,
        CREDIT_COSTS.AI_SUGGESTION,
        "ai_suggestion_failed",
      );
      return withPublicCors(
        NextResponse.json({ error: result.error }, { status: 500 }),
      );
    }

    return withPublicCors(
      NextResponse.json({
        success: true,
        suggestions: result.data,
        tokensUsed: result.tokensUsed,
        originalText: text.value,
      }),
    );
  } catch (error) {
    console.error("Content suggestion API error:", error);
    return withPublicCors(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
    );
  }
}

export async function OPTIONS() {
  return publicOptions(undefined, "POST,OPTIONS");
}
