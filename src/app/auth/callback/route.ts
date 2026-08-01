import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { sanitizeNext } from "../sanitize-next";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Behind a load balancer (Vercel) `request.url` carries the internal
      // origin, so redirecting to it would send the user somewhere that isn't
      // the public hostname. `x-forwarded-host` holds the origin the browser
      // actually asked for. Locally there is no proxy, so `origin` is correct.
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";
      if (!isLocalEnv && forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
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
