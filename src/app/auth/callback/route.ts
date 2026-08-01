import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { sanitizeNext } from "../sanitize-next";
import { resolvePublicOrigin } from "../public-origin";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNext(searchParams.get("next"));

  // Resolved once and reused for both the success and error redirects, so the
  // two cannot disagree about which origin is public. Previously this route
  // redirected to an unvalidated `x-forwarded-host` — attacker-controllable,
  // and applied AFTER the session cookie was set.
  const origin = resolvePublicOrigin(request);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    // The exchange fails when the link is expired, already consumed, or was
    // opened in a different browser than the one that requested it (the PKCE
    // code verifier lives in a cookie). Log it rather than losing the reason.
    console.error("[auth] exchangeCodeForSession failed", error.message);
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/error`);
}
