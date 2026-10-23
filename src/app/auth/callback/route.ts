import { freezeVerifiedSignup } from "@/lib/analytics/google-analytics/conversions";
import { bindAnalyticsContext } from "@/lib/analytics/google-analytics/context-server";
import { readDataFastVisitorId } from "@/lib/analytics/datafast-attribution";
import { recordDataFastSession } from "@/lib/analytics/datafast-server";
import { createClient } from "@/lib/supabase/server";
import { after, NextResponse } from "next/server";
import { sanitizeNext } from "../sanitize-next";
import { resolvePublicOrigin } from "../public-origin";
import { ensureTrialStarted } from "@/lib/billing/trial";
import { reportAuthError } from "@/lib/monitoring/auth-error-report";

/**
 * DataFast (ADR 074): remember this browser's visitor id for the account and,
 * when this session started the trial, send `signup` + `app_trial_started`.
 * Read the cookie now; deliver after the redirect has gone. Inert without
 * DATAFAST_API_KEY, and it cannot throw into the sign-in.
 */
function scheduleDataFastSession(
  request: Request,
  userId: string,
  trial: Awaited<ReturnType<typeof ensureTrialStarted>>,
): void {
  try {
    const visitorId = readDataFastVisitorId(request.headers.get("cookie"));
    if (!visitorId) return;
    after(() => recordDataFastSession({ userId, visitorId, trial }));
  } catch {
    // Attribution is never worth a failed sign-in.
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const hasAuthError = searchParams.has("error");
  const next = sanitizeNext(searchParams.get("next"));

  // Resolved once and reused for both the success and error redirects, so the
  // two cannot disagree about which origin is public. Previously this route
  // redirected to an unvalidated `x-forwarded-host` — attacker-controllable,
  // and applied AFTER the session cookie was set.
  const origin = resolvePublicOrigin(request);

  // Supabase can return both an error and stale transport parameters. The
  // explicit provider error is authoritative; attempting an exchange or
  // accepting an existing session here would turn a rejected link into a
  // successful-looking redirect.
  if (hasAuthError) {
    return NextResponse.redirect(`${origin}/auth/error`);
  }

  const supabase = await createClient();

  if (code) {
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
          error: userError,
        } = await supabase.auth.getUser();
        if (user && !userError) {
          // PKCE proves sign-in, not initial confirmation; retain that explicit
          // provenance gap instead of counting a returning login as a signup.
          await freezeVerifiedSignup(request, user.id, "pkce");
          const trial = await ensureTrialStarted(supabase, user.id);
          scheduleDataFastSession(request, user.id, trial);
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
    reportAuthError("exchangeCodeForSession", error);
    return NextResponse.redirect(`${origin}/auth/error`);
  }

  // The email template now confirms the OTP in /auth/confirm before arriving
  // here. That leaves no PKCE code, but it does leave a server-readable session
  // cookie. On 2026-09-24 this exact successful sign-in was sent to the error
  // page. Accept only getUser's verified user response; lookup errors, throws,
  // and an absent user keep the old fail-closed result. Trial creation remains
  // exclusively on the two session-establishment paths above and in confirm.
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (user && !error) {
      await bindAnalyticsContext(request, user.id);
      scheduleDataFastSession(request, user.id, null);
      return NextResponse.redirect(`${origin}${next}`);
    }
  } catch (sessionError) {
    console.error(
      "[auth] session lookup failed without callback code",
      sessionError,
    );
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/error`);
}
