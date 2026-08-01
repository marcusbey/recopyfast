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

      const result = await StagingAccessManager.verifyEmail(token, code);

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
