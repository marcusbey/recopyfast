import { createBrowserClient } from "@supabase/ssr";

// Placeholder credentials used ONLY while prerendering on the server, where no
// Supabase call is ever made (every call site lives inside a useEffect or an
// event handler, neither of which runs during prerender). They are syntactically
// valid so createBrowserClient can construct, and functionally inert because
// nothing dials them.
const PRERENDER_URL = "http://localhost:54321";
const PRERENDER_ANON_KEY = "prerender-placeholder-anon-key";

/**
 * Browser-side Supabase client.
 *
 * `AuthProvider` calls this during render, and the root layout wraps every
 * route — so this also runs while Next statically prerenders pages like
 * `/_not-found` and `/auth/error`. `createBrowserClient` throws outright on
 * empty credentials ("Your project's URL and API key are required"), which
 * failed the Vercel build for any environment that does not expose the
 * NEXT_PUBLIC_SUPABASE_* vars at build time.
 *
 * So: on the server, fall back to inert placeholders and let the prerender
 * finish. In the browser — where a missing key means the app genuinely cannot
 * authenticate anyone — throw loudly rather than hand back a client that will
 * fail every request with a confusing 401.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    if (typeof window === "undefined") {
      return createBrowserClient(PRERENDER_URL, PRERENDER_ANON_KEY);
    }

    throw new Error(
      "Supabase browser client is unconfigured. Set NEXT_PUBLIC_SUPABASE_URL " +
        "and NEXT_PUBLIC_SUPABASE_ANON_KEY. Note these are inlined at build " +
        "time, so they must be present in the build environment, not just at " +
        "runtime.",
    );
  }

  return createBrowserClient(url, anonKey);
}
