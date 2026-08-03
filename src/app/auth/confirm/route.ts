import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { sanitizeNext } from "../sanitize-next";
import { resolvePublicOrigin } from "../public-origin";

/**
 * Email-link confirmation via one-time token hash.
 *
 * This is the cross-device counterpart to `/auth/callback`. The PKCE code
 * exchange in that route needs the code-verifier cookie that the browser set
 * when the link was requested, so it fails when a user requests a magic link
 * on their laptop and opens the email on their phone. `verifyOtp` carries no
 * such requirement, so it is what makes the wrong-device case work at all.
 *
 * Reaching this route requires pointing the Supabase email templates at
 * `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=...&next=...`.
 * The `next` param matters: AuthContext builds `/auth/callback?next=<dest>` to
 * carry the `redirectedFrom` destination middleware set, and this route honours
 * `next` too — but only if the configured template actually passes it through,
 * otherwise every confirmation lands on the default destination. Until
 * that change is made the default templates keep using `/auth/callback`.
 */

/**
 * Email link types we are willing to confirm here. `recovery` is deliberately
 * absent: this product is passwordless, so a password-recovery link is never
 * issued and accepting the type would only widen the surface.
 */
const ALLOWED_OTP_TYPES: readonly EmailOtpType[] = [
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

/**
 * Where to send the user after the link is confirmed.
 *
 * Two spellings arrive here and both have to work. Our own code builds `next`
 * with a relative path. The Supabase email template passes `{{ .RedirectTo }}`
 * as `redirect_to`, which renders an **absolute** URL — so it fails
 * `sanitizeNext`'s leading-slash rule and silently became `/dashboard`. The
 * template was the one thing standing between a magic link and working
 * cross-device, and once repointed here it would have signed people in
 * correctly and then dropped wherever they were going, every time.
 *
 * An absolute value is reduced to its path, and only when it is on our own
 * origin. That keeps `sanitizeNext` as the single open-redirect guard rather
 * than adding a second, weaker one beside it: anything cross-origin, or
 * unparseable, falls back exactly as before.
 */
function resolveDestination(
  searchParams: URLSearchParams,
  origin: string,
): string {
  const next = searchParams.get("next");
  if (next) return sanitizeNext(next);

  const redirectTo = searchParams.get("redirect_to");
  if (!redirectTo) return sanitizeNext(null);

  try {
    const target = new URL(redirectTo, origin);
    if (target.origin !== new URL(origin).origin) return sanitizeNext(null);
    return sanitizeNext(`${target.pathname}${target.search}${target.hash}`);
  } catch {
    return sanitizeNext(null);
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // Same validated origin as /auth/callback — see ../public-origin.ts. Shared so
  // the two confirmation routes cannot disagree about the public hostname.
  const origin = resolvePublicOrigin(request);
  const tokenHash = searchParams.get("token_hash");
  const type = parseOtpType(searchParams.get("type"));
  const next = resolveDestination(searchParams, origin);

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
