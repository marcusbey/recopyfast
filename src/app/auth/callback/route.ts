import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Validate the `next` redirect target so it can only be a same-origin
 * relative path.  Rules:
 *   - Must start with a single '/'
 *   - Must NOT start with '//' (protocol-relative URL — cross-origin)
 *   - Must NOT start with '/\' (IE-era cross-origin bypass)
 * Anything else falls back to '/dashboard'.
 */
function sanitizeNext(value: string | null): string {
  const fallback = "/dashboard";
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.startsWith("/\\")) return fallback;
  return value;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/error`);
}
