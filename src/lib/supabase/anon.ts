import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client acting as `anon`: the public key, RLS on, and no
 * session — nothing read from cookies, nothing persisted, nothing refreshed.
 *
 * For server code that has no user and reads only rows RLS already makes
 * public. Its one caller is `src/app/sitemap.ts`, reading published blog posts
 * under the `"Published blog posts are public"` policy (`FOR SELECT USING
 * (status = 'published')`, migration 20260818000000), which is exactly the set
 * the sitemap may list.
 *
 * Why not the other three (s88):
 * - `supabase/server.ts` reads the caller's cookies. The sitemap ran on it
 *   until s88: the read ran as whoever happened to request it, and `cookies()`
 *   forced the route to render — and query the database — on every crawler
 *   fetch.
 * - `supabase/service.ts` bypasses RLS. A published-only filter would then be
 *   the only thing standing between drafts and a public file, and AGENTS.md
 *   reserves the service role for `authorize*` paths and named ADR exceptions.
 * - `supabase/client.ts` is the browser client, with inert placeholder
 *   credentials on the server.
 *
 * Never use this for anything a user owns: as `anon` it sees only what every
 * stranger may see, which is the point.
 */
export function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase anon client is unconfigured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set",
    );
  }

  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
