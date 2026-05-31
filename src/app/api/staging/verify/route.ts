/**
 * Staging Email Verification API
 * POST: Verify email with code OR capture email for link-based access
 */

import { NextRequest, NextResponse } from "next/server";
import { StagingAccessManager } from "@/lib/auth/staging-access";

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
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    // Determine action
    const actionType = action || (code ? "verify" : email ? "capture" : null);

    if (!actionType) {
      return NextResponse.json(
        { error: "Must provide either code (to verify) or email (to capture)" },
        { status: 400 },
      );
    }

    if (actionType === "capture") {
      // Capture email for link-based access
      if (!email) {
        return NextResponse.json(
          { error: "Email is required for capture action" },
          { status: 400 },
        );
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return NextResponse.json(
          { error: "Invalid email format" },
          { status: 400 },
        );
      }

      const result = await StagingAccessManager.captureEmail(token, email);

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || "Failed to capture email" },
          { status: 400 },
        );
      }

      // TODO: deliver code via transactional email (Resend/SendGrid)
      // result.verificationCode is available server-side; never expose it in the response.

      return NextResponse.json({
        success: true,
        message: "Verification code sent to email",
      });
    }

    if (actionType === "verify") {
      // Verify email with code
      if (!code) {
        return NextResponse.json(
          { error: "Verification code is required" },
          { status: 400 },
        );
      }

      const result = await StagingAccessManager.verifyEmail(token, code);

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || "Verification failed" },
          { status: 400 },
        );
      }

      return NextResponse.json({
        success: true,
        verified: true,
        email: result.access?.email,
        permissions: result.access?.permissions,
        expiresAt: result.access?.expires_at,
      });
    }

    if (actionType === "resend") {
      // Resend verification code
      const result = await StagingAccessManager.resendVerificationCode(token);

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || "Failed to resend code" },
          { status: 400 },
        );
      }

      // TODO: deliver code via transactional email (Resend/SendGrid)
      // result.verificationCode is available server-side; never expose it in the response.

      return NextResponse.json({
        success: true,
        message: "Verification code resent",
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Error in staging verification:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
