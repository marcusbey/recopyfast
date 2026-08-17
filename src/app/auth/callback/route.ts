import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { sanitizeNext } from "../sanitize-next";
import { resolvePublicOrigin } from "../public-origin";
import { ensureTrialStarted } from "@/lib/billing/trial";

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
      // The 14-day trial starts here because there is nowhere earlier: sign-up
      // is passwordless `signInWithOtp`, so there is no signup route and no
      // "email confirmed" event — this and /auth/confirm are the only two
      // moments the server sees a session come into existence.
      //
      // This route also runs on the tenth sign-in and the hundredth, so
      // `ensureTrialStarted` is idempotent by design; it reads the account's
      // entitlement first and writes nothing unless there is genuinely nothing
      // there. It already swallows its own failures, and the belt-and-braces
      // catch is here because the one thing this must never do is turn a
      // working sign-in into /auth/error over a free trial.
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          await ensureTrialStarted(supabase, user.id);
        }
      } catch (trialError) {
        console.error("[auth] trial start failed after sign-in", trialError);
      }

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
