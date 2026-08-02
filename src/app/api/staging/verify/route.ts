/**
 * Staging Email Verification API
 * POST: Verify email with code OR capture email for link-based access
 */

import { NextRequest, NextResponse } from "next/server";
import { StagingAccessManager } from "@/lib/auth/staging-access";
import {
  rateLimiter,
  createRateLimitConfig,
} from "@/lib/security/rate-limiter";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { readStagingDeviceFingerprint } from "@/lib/auth/staging-device";
import { sendStagingVerificationEmail } from "@/lib/email/resend";
import { publicOptions, withPublicCors } from "@/lib/http/public-cors";

/**
 * Cap verification-code attempts per token. The code is only 6 digits (10^6 space)
 * with a 10-minute lifetime; without a limit an attacker could exhaust it. 10
 * attempts / 15 min per token makes brute force infeasible within the code's TTL.
 */
async function verifyAttemptAllowed(token: string): Promise<boolean> {
  try {
    const config = createRateLimitConfig(
      token,
      "api_key",
      "IP_AUTH",
      "staging-verify",
    );
    const result = await rateLimiter.checkLimit(config);
    return result.allowed;
  } catch (err) {
    // Fail closed: if the limiter backend is unavailable, deny rather than open the
    // brute-force window. Staging verification is low-volume, so this is safe.
    console.error("Verify rate-limit check failed:", err);
    return false;
  }
}

/**
 * Throttle resends on both axes that matter.
 *
 * A resend mails a code to an address the *caller does not choose* — it is
 * whoever the token was issued to. Unthrottled, anyone holding a staging token
 * (forwarded link, leaked Referer, shared-machine history) can loop this
 * endpoint and aim an unbounded stream of mail at a named person's inbox while
 * burning the sending domain's reputation and the Resend quota.
 *
 * Same shape as `limitCodeRequests` in src/lib/auth/editor-request.ts: per
 * recipient, because the inbox is the thing under attack, AND per IP, so one
 * source cannot walk a set of tokens. Both fail CLOSED — losing Redis must not
 * remove the only control standing between an attacker and an editor's inbox,
 * and resends are low-volume enough that refusing during an outage costs little.
 */
async function limitResendRequests(
  request: NextRequest,
  recipient: string | null,
): Promise<NextResponse | null> {
  if (recipient) {
    const perRecipient = await enforceRateLimit(request, {
      limit: "USER_DOMAIN_VERIFY",
      endpoint: "staging/verify:resend-recipient",
      identifier: recipient.toLowerCase(),
      identifierType: "user",
      onStoreFailure: "deny",
      message: "Too many codes requested for this address. Try again shortly.",
    });
    if (perRecipient) return perRecipient;
  }

  return enforceRateLimit(request, {
    limit: "IP_AUTH",
    endpoint: "staging/verify:resend-ip",
    identifierType: "ip",
    onStoreFailure: "deny",
    message: "Too many code requests. Try again shortly.",
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      token,
      code,
      email,
      action,
    }: {
      token: string;
      code?: string;
      email?: string;
      action?: "verify" | "capture" | "resend";
    } = body;

    if (!token) {
      return withPublicCors(
        NextResponse.json({ error: "Missing token" }, { status: 400 }),
        request,
      );
    }

    // Determine action
    const actionType = action || (code ? "verify" : email ? "capture" : null);

    if (!actionType) {
      return withPublicCors(
        NextResponse.json(
          {
            error: "Must provide either code (to verify) or email (to capture)",
          },
          { status: 400 },
        ),
        request,
      );
    }

    if (actionType === "capture") {
      // Capture email for link-based access
      if (!email) {
        return withPublicCors(
          NextResponse.json(
            { error: "Email is required for capture action" },
            { status: 400 },
          ),
          request,
        );
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return withPublicCors(
          NextResponse.json({ error: "Invalid email format" }, { status: 400 }),
          request,
        );
      }

      const result = await StagingAccessManager.captureEmail(token, email);

      if (!result.success) {
        return withPublicCors(
          NextResponse.json(
            { error: result.error || "Failed to capture email" },
            { status: 400 },
          ),
          request,
        );
      }

      // Deliver the code only via email — never in the response body.
      if (result.verificationCode) {
        const mail = await sendStagingVerificationEmail(
          email,
          result.verificationCode,
        );
        if (!mail.sent) {
          return withPublicCors(
            NextResponse.json(
              { error: "Could not send verification email. Try again later." },
              { status: 502 },
            ),
            request,
          );
        }
      }

      return withPublicCors(
        NextResponse.json({
          success: true,
          message: "Verification code sent to email",
        }),
        request,
      );
    }

    if (actionType === "verify") {
      // Verify email with code
      if (!code) {
        return withPublicCors(
          NextResponse.json(
            { error: "Verification code is required" },
            { status: 400 },
          ),
          request,
        );
      }

      // Throttle attempts BEFORE checking the code to prevent brute force.
      if (!(await verifyAttemptAllowed(token))) {
        return withPublicCors(
          NextResponse.json(
            { error: "Too many attempts. Try again later." },
            { status: 429 },
          ),
          request,
        );
      }

      // Bind the result to the browser that passed the check. This request is
      // the only moment we know a human with access to the invited inbox is
      // present, so it is the only honest moment to record what that device
      // looks like.
      const result = await StagingAccessManager.verifyEmail(
        token,
        code,
        readStagingDeviceFingerprint(request),
      );

      if (!result.success) {
        return withPublicCors(
          NextResponse.json(
            { error: result.error || "Verification failed" },
            { status: 400 },
          ),
          request,
        );
      }

      return withPublicCors(
        NextResponse.json({
          success: true,
          verified: true,
          email: result.access?.email,
          permissions: result.access?.permissions,
          expiresAt: result.access?.expires_at,
        }),
        request,
      );
    }

    if (actionType === "resend") {
      // Resolve the recipient BEFORE sending so the limit can be keyed on the
      // inbox under attack. A null recipient (unknown/revoked/expired token)
      // still falls through to the per-IP limit below — it is not a bypass.
      const recipient = await StagingAccessManager.getResendRecipient(token);

      const limited = await limitResendRequests(request, recipient);
      if (limited) return withPublicCors(limited, request);

      // Resend verification code
      const result = await StagingAccessManager.resendVerificationCode(token);

      if (!result.success) {
        return withPublicCors(
          NextResponse.json(
            { error: result.error || "Failed to resend code" },
            { status: 400 },
          ),
          request,
        );
      }

      // Deliver the code only via email — never in the response body.
      if (result.verificationCode && result.email) {
        const mail = await sendStagingVerificationEmail(
          result.email,
          result.verificationCode,
        );
        if (!mail.sent) {
          return withPublicCors(
            NextResponse.json(
              { error: "Could not send verification email. Try again later." },
              { status: 502 },
            ),
            request,
          );
        }
      }

      return withPublicCors(
        NextResponse.json({
          success: true,
          message: "Verification code resent",
        }),
        request,
      );
    }

    return withPublicCors(
      NextResponse.json({ error: "Invalid action" }, { status: 400 }),
      request,
    );
  } catch (error) {
    console.error("Error in staging verification:", error);
    return withPublicCors(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      request,
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request, "POST,OPTIONS");
}
