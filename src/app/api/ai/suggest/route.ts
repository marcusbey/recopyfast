import { NextRequest, NextResponse } from "next/server";
import { aiService } from "@/lib/ai/openai-service";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { refundCharge, type CreditCharge } from "@/lib/credits/system";
import { consumeFeatureUsage } from "@/lib/feature-gating/permissions";
import {
  checkOwnerCanEdit,
  ownerCanEditRefusal,
} from "@/lib/billing/owner-can-edit";
import {
  requireEditorPermission,
  validateEditorTokenFromRequest,
} from "@/lib/auth/editor-access";
import { enforceRateLimit, getClientIp } from "@/lib/api/rate-limit";
import {
  optionalEnum,
  readJsonObject,
  requireString,
  requireUuid,
} from "@/lib/api/validation";
import { withPublicCors, publicOptions } from "@/lib/http/public-cors";
import { logger } from "@/lib/monitoring/logger";

/**
 * AI suggestions for the in-page editor.
 *
 * WHO CALLS THIS. The widget, from a customer's own origin — the "🪄 AI" button
 * in the edit toolbar (recopyfast.src.js `showAISuggestions`). Nothing else:
 * the dashboard's `AISuggestionButton` is imported by nothing but its tests.
 *
 * WHAT BROKE (s40). This route authenticated with the dashboard's cookie
 * session. A cross-origin `fetch` from a customer's page carries no cookie for
 * our domain, so every request 401'd and the modal printed "Failed to generate
 * suggestions" to every owner and every editor, on every site, every time. It
 * looked healthy from curl and from every server-side test, because those
 * supplied the cookie the real caller never could. Public CORS (`*`) and
 * cookie auth cannot coexist anyway: `public-cors.ts` exists for endpoints that
 * authenticate "never with cookies". Do not add a cookie path back.
 *
 * WHO MAY SPEND. An editor, graded "edit", through the one helper every
 * widget write already uses — `validateEditorTokenFromRequest`: a device grant
 * in `X-RCF-Editor-Grant` (pinned to the origin it was minted on), an
 * edit-session token or a staging token in the body. The public site token is
 * NOT a credential here. It is printed in the source of every customer page;
 * sent alone as `Authorization: Bearer`, `extractEditorToken` reads it as a
 * staging token and the staging validator refuses it, before anything about
 * the owner is read or charged. Do not add `authorizeSiteRequest` here — that
 * is exactly the credential that must never suffice to spend.
 *
 * WHO PAYS. The site owner — the `admin` row in `site_permissions`, via
 * `resolveSiteOwnerId` (asked through `checkOwnerCanEdit` since s51), the same
 * payer seat billing uses. Never the caller: a device-grant editor has no
 * account to charge, and an edit session can be opened by a collaborator who
 * is not the owner. Never `sites.user_id`: there is no such column, and
 * counting through it once shipped a quota that always read 0. The owner's wallet is read and spent through the service role
 * because the owner is not the one calling — which is why this route may only
 * do so AFTER the editor has been authorised and graded.
 *
 * RATE LIMITS. Two, both fail closed (ADR 002 rule 4):
 *   - per IP, BEFORE anything else — authorisation itself costs database reads,
 *     so a limiter behind it would never see the flood;
 *   - per site, AFTER the permission grade, NOT in front of it. The bucket is
 *     the customer's site and a site id is public, so metering unauthenticated
 *     callers into it would let anyone lock the owner out of AI by naming their
 *     site. Same reasoning as `staging/content/[siteId]/route.ts` and
 *     `edit-board/languages/route.ts`. It replaces the per-user limiter, which
 *     could not apply: grant holders have no user.
 *
 * Every response, limiter refusals included, carries public CORS. A 429 without
 * it reaches the widget as a network failure and reads "Error connecting to AI
 * service", which is untrue and unactionable.
 */

const TONES = ["professional", "casual", "marketing", "technical"] as const;
const GOALS = ["improve", "shorten", "expand", "optimize"] as const;

type Tone = (typeof TONES)[number];
type Goal = (typeof GOALS)[number];

/**
 * The widget's goal vocabulary, absorbed here rather than in the widget.
 *
 * The modal (recopyfast.src.js `showAISuggestions`, its `options` list) offers
 * improve, shorten, expand, engage, professional and casual — and always sends
 * tone "professional". This route only ever knew the first three, so half the
 * menu was a 400 that the modal reported as "Failed to generate suggestions",
 * indistinguishable from the auth failure that hid it.
 *
 * Mapped on the server on purpose. `/embed/recopyfast.js` is a permanent public
 * URL cached on customer pages, and every copy already out there sends these
 * words: a widget-side rename would leave those copies broken until their
 * caches turned over, and would spend bytes from an embed budget that has
 * none. Here it costs 0 widget bytes and repairs every copy at once. An alias
 * that names a tone overrides the tone sent, because the widget's constant
 * "professional" was never the user's choice.
 */
const GOAL_ALIASES: Readonly<Record<string, { goal: Goal; tone?: Tone }>> = {
  engage: { goal: "optimize" },
  professional: { goal: "improve", tone: "professional" },
  casual: { goal: "improve", tone: "casual" },
};

/** Every goal a caller may send: the model's own, then the widget's aliases. */
const ACCEPTED_GOALS = [...GOALS, ...Object.keys(GOAL_ALIASES)];

/** Prompt-size ceilings — these bound the per-request OpenAI token spend. */
const MAX_TEXT_LENGTH = 5000;
const MAX_CONTEXT_LENGTH = 1000;

/** Length of the original-text sample retained for usage analytics. */
const USAGE_SAMPLE_LENGTH = 100;

const CORS_METHODS = "POST,OPTIONS";

/** Said to anyone when the site has no owner row to charge. */
const NO_PAYER_MESSAGE = "AI suggestions aren't available on this site.";

/**
 * Said to an invited editor when the owner's plan or wallet refuses. The gate's
 * own sentences say "Your … plan" and "you have 0", which are about somebody
 * else's account when the reader is an editor — and a grant holder has no
 * billing page to act on them.
 */
const EDITOR_DENIED_MESSAGE =
  "AI suggestions aren't available on this site's plan right now. Ask the site owner to add AI credits.";

/** The model failed and the whole charge came back. */
const NOT_CHARGED_MESSAGE =
  "AI suggestions are unavailable right now. You were not charged.";

/**
 * The model failed and the refund did not land, or not in full. s82: this
 * route said "You were not charged" either way.
 */
const REFUND_FAILED_MESSAGE =
  "AI suggestions are unavailable right now. We could not refund the credit for this request automatically, and we have been notified.";

function cors(response: NextResponse, request: NextRequest) {
  return withPublicCors(response, request, CORS_METHODS);
}

function fail(
  request: NextRequest,
  status: number,
  body: Record<string, unknown>,
) {
  return cors(NextResponse.json(body, { status }), request);
}

/**
 * Give back what this request took, after the model failed to deliver, and
 * say whether ALL of it came back.
 *
 * By the receipt the charge returned (s48), never by the owner's id: the old
 * owner-keyed refund, `(ownerId, 1, reason)`, could not know the credit had
 * come from the owner's monthly allowance, so it minted a new never-expiring
 * purchased credit AND left the allowance spent (probe P2) — a paid-looking
 * balance that kept a lapsed trial past the paywall (P3). `refundCharge` returns the credit to
 * where it came from and never creates a row.
 *
 * s82: the answer used to be discarded, and the 502 told the widget "You were
 * not charged" whatever had happened. The caller now says that only when this
 * returns true. A refund that failed, threw or came back short is reported
 * through `logger.error` — stdout plus Sentry in production — because
 * `console.error` never reaches Sentry for a response this route handles
 * itself, so the owner's lost credit was visible to nobody. The report carries
 * ids and amounts only: never the editor's token, grant or email.
 *
 * Never throws: it runs on the way out of a failure, and a refund that threw
 * from the `catch` would turn a 500 with CORS into an unhandled rejection the
 * widget cannot read.
 */
async function refundOwner(
  charge: CreditCharge,
  siteId: string,
): Promise<boolean> {
  let refunded = 0;
  let isRefunded = false;
  let failure: unknown;
  try {
    const outcome = await refundCharge(charge);
    refunded = outcome.refunded;
    isRefunded = outcome.success && outcome.refunded >= charge.credits;
  } catch (refundError) {
    failure = refundError;
  }

  if (!isRefunded) {
    logger.error(
      "[ai/suggest] AI credit refund failed: the site owner was charged for a suggestion that never arrived. Refund this usage by hand.",
      failure instanceof Error ? failure : undefined,
      { siteId, userId: charge.userId },
      {
        component: "ai/suggest",
        action: "refund",
        usageId: charge.usageId,
        credits: charge.credits,
        refunded,
      },
    );
  }
  return isRefunded;
}

export async function POST(request: NextRequest) {
  // The receipt of THIS request's charge, once and only once it has landed.
  // The `catch` below refunds exactly that: a failure before the charge (the
  // owner lookup, the gate itself) took nothing and must give nothing back.
  // Once refunded it is cleared, so the `catch` cannot refund it a second time
  // (the database would cap a second refund at 0 anyway — s48).
  let charge: CreditCharge | null = null;
  // The site that charge was for, named in the ops report if its refund fails.
  let chargedSiteId = "";

  try {
    // Pre-auth IP limit. Every request here is a potential OpenAI call, so the
    // unauthenticated path must be throttled before it can be used to probe
    // for valid credentials at volume.
    const ipLimited = await enforceRateLimit(request, {
      limit: "IP_GENERAL",
      endpoint: "ai/suggest:ip",
      identifier: getClientIp(request),
      onStoreFailure: "deny",
    });
    if (ipLimited) return cors(ipLimited, request);

    const body = await readJsonObject(request);
    if (!body.ok) return fail(request, 400, { error: body.error });

    const siteId = requireUuid(body.value, "siteId");
    if (!siteId.ok) return fail(request, 400, { error: siteId.error });

    // Bound every field that reaches the model — and do it before
    // authorisation, so garbage costs no database work. Request count alone
    // does not cap spend when a single request may carry an arbitrarily large
    // prompt.
    const text = requireString(body.value, "text", {
      maxLength: MAX_TEXT_LENGTH,
    });
    if (!text.ok) return fail(request, 400, { error: text.error });

    const context = requireString(body.value, "context", {
      maxLength: MAX_CONTEXT_LENGTH,
    });
    if (!context.ok) return fail(request, 400, { error: context.error });

    const tone = optionalEnum(body.value, "tone", TONES);
    if (!tone.ok) return fail(request, 400, { error: tone.error });

    const requestedGoal = optionalEnum(body.value, "goal", ACCEPTED_GOALS);
    if (!requestedGoal.ok) {
      return fail(request, 400, { error: requestedGoal.error });
    }
    const alias =
      requestedGoal.value !== undefined
        ? GOAL_ALIASES[requestedGoal.value]
        : undefined;
    const goal: Goal | undefined = alias
      ? alias.goal
      : (requestedGoal.value as Goal | undefined);
    const effectiveTone: Tone | undefined = alias?.tone ?? tone.value;

    const validation = await validateEditorTokenFromRequest({
      request,
      siteId: siteId.value,
      body: body.value,
    });
    if (!validation.valid || !validation.access) {
      return fail(request, validation.status || 401, {
        error: validation.error || "Invalid editor token",
      });
    }
    const access = validation.access;

    if (!requireEditorPermission(access, "edit")) {
      return fail(request, 403, { error: "Requires 'edit' permission" });
    }

    // Per site, fail closed, behind the grade — see the header. API_UPLOAD
    // (10/min) because a human clicks "Generate" and reads the result; each
    // accepted request is one OpenAI call charged to the owner.
    const siteLimited = await enforceRateLimit(request, {
      limit: "API_UPLOAD",
      endpoint: "ai/suggest",
      identifier: siteId.value,
      identifierType: "api_key",
      onStoreFailure: "deny",
      message:
        "Too many AI suggestion requests for this site. Please slow down.",
    });
    if (siteLimited) return cors(siteLimited, request);

    // Fail closed on configuration, BEFORE anyone is charged. Without a key the
    // OpenAI SDK throws at construction, inside `generateContentSuggestion`,
    // which turned it into `{ success: false, error: <the SDK's sentence> }` —
    // so the old route charged the credit, refunded it, and echoed "The
    // OPENAI_API_KEY environment variable is missing or empty" to a customer's
    // page. The variable is in neither `validateConfig` nor `/api/health`, so
    // this log line is the only place its absence becomes visible (s40
    // research, "OPENAI_API_KEY absence does not fail loudly").
    if (!process.env.OPENAI_API_KEY?.trim()) {
      console.error(
        "[ai/suggest] OPENAI_API_KEY is not set in this environment — refusing AI suggestions before charging anyone.",
      );
      return fail(request, 503, {
        error: "AI suggestions are not available right now.",
      });
    }

    // The payer is the site owner, and since s51 the owner must hold a plan
    // for any AI spend on the site (ADR 041): credits already bought are kept,
    // but a credits-only or lapsed owner's editors spend nothing. One helper
    // answers both "who pays" and "may they", so the two cannot disagree.
    // 402, never 401/403: the widget shows the message either way, and the
    // editing routes it shares a session with must not look terminal.
    const ownerCanEdit = await checkOwnerCanEdit(siteId.value);
    if (!ownerCanEdit.ok) {
      if (ownerCanEdit.reason === "no_owner") {
        // A site with no `admin` row is a data inconsistency. Refused rather
        // than charged to the caller (who may have no account at all), and
        // logged because an ownerless site is a bug worth seeing.
        console.error(
          `[ai/suggest] site ${siteId.value} has no admin row; refusing AI spend`,
        );
        return fail(request, 403, { error: NO_PAYER_MESSAGE });
      }
      return cors(ownerCanEditRefusal(ownerCanEdit), request);
    }
    const ownerId = ownerCanEdit.ownerId;
    const service = createServiceRoleClient();

    const usageResult = await consumeFeatureUsage(
      ownerId,
      "ai_suggestion",
      {
        siteId: siteId.value,
        editor: access.email ?? access.userId ?? access.kind,
        originalText: text.value.substring(0, USAGE_SAMPLE_LENGTH), // Store sample for analytics
        context: context.value,
        tone: effectiveTone,
        goal,
      },
      service,
    );

    if (!usageResult.success) {
      const isOwner = access.userId === ownerId;
      return fail(request, 403, {
        error: isOwner ? usageResult.error : EDITOR_DENIED_MESSAGE,
        requiresUpgrade: true,
      });
    }
    charge = usageResult.charge ?? null;
    chargedSiteId = siteId.value;

    // Generate content suggestions
    const result = await aiService.generateContentSuggestion({
      originalText: text.value,
      context: context.value,
      tone: effectiveTone ?? "professional",
      goal: goal ?? "improve",
    });

    if (!result.success) {
      // Credits were charged before the model was called, so a provider failure
      // would otherwise bill the owner for nothing.
      //
      // The provider's sentence goes to the log, never to the page. It used to
      // be returned verbatim: SDK and upstream messages name environment
      // variables, quotas and models, which is our business and not the
      // visitor's — and "rate limit exceeded" told an editor nothing they could
      // act on.
      console.error(
        `[ai/suggest] provider failed for site ${siteId.value}; refunding the owner:`,
        result.error,
      );
      const failedCharge = charge;
      charge = null;
      // No receipt means nothing was taken, which is "not charged" too.
      const isRefunded = failedCharge
        ? await refundOwner(failedCharge, siteId.value)
        : true;
      return fail(request, 502, {
        error: isRefunded ? NOT_CHARGED_MESSAGE : REFUND_FAILED_MESSAGE,
      });
    }

    return cors(
      NextResponse.json({
        success: true,
        suggestions: result.data,
        tokensUsed: result.tokensUsed,
        originalText: text.value,
      }),
      request,
    );
  } catch (error) {
    console.error("Content suggestion API error:", error);
    if (charge) {
      await refundOwner(charge, chargedSiteId);
    }
    return fail(request, 500, { error: "Internal server error" });
  }
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request, CORS_METHODS);
}
