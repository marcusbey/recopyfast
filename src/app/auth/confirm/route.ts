import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { sanitizeNext } from "../sanitize-next";

/**
 * Email-link confirmation via one-time token hash.
 *
 * This is the cross-device counterpart to `/auth/callback`. The PKCE code
 * exchange in that route needs the code-verifier cookie that the browser set
 * when the link was requested, so it fails when a user requests a reset on
 * their laptop and opens the email on their phone. `verifyOtp` carries no
 * such requirement.
 *
 * Reaching this route requires pointing the Supabase email templates at
 * `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=...`. Until
 * that change is made the default templates keep using `/auth/callback`.
 */

/** Email link types we are willing to confirm here. */
const ALLOWED_OTP_TYPES: readonly EmailOtpType[] = [
  "recovery",
  "signup",
  "invite",
  "magiclink",
  "email_change",
  "email",
];

function parseOtpType(value: string | null): EmailOtpType | null {
  if (!value) return null;
  return ALLOWED_OTP_TYPES.includes(value as EmailOtpType)
    ? (value as EmailOtpType)
    : null;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = parseOtpType(searchParams.get("type"));
  const next = sanitizeNext(searchParams.get("next"));

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/auth/error`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  if (error) {
    console.error("[auth] verifyOtp failed", { type, message: error.message });
    return NextResponse.redirect(`${origin}/auth/error`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
