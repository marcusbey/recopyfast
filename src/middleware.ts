import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  hasAnyEntitlement,
  resolveEntitlement,
} from "@/lib/billing/effective-plan";
import { SENTRY_TUNNEL_ROUTE } from "@/lib/monitoring/sentry-tunnel";
import {
  buildContentSecurityPolicy,
  createCspNonce,
  usesNoncePolicy,
} from "@/lib/security/content-security-policy";

// Use Node.js runtime for full API compatibility
export const runtime = "nodejs";

/**
 * The one page an account without a plan can still reach.
 *
 * It is where Stripe Checkout returns to — on success *and* on cancel — so it
 * cannot be gated: at the moment a customer comes back from a successful
 * payment the webhook has usually not landed yet, and they are still
 * unentitled. Gating it would bounce them off their own receipt and lose the
 * `session_id` the page reconciles against. It is also the way out of an
 * abandoned checkout.
 */
const CHECKOUT_PATH = "/dashboard/billing";

/**
 * Is this session's account entitled to nothing at all?
 *
 * Deliberately `resolveEntitlement` + `hasAnyEntitlement` rather than a
 * condition of its own: the router must not hold a second opinion about who is
 * let in, or the paywall and the feature gates drift and one of them is wrong.
 * A credit holder passes here, deliberately: their balance is kept, and their
 * dashboard still reads and exports. What they cannot do is write — since s51
 * every content write and AI spend, and every credential issuance but handoff
 * redemption, asks `checkOwnerCanEdit` (`@/lib/billing/owner-can-edit`, ADR
 * 041) for the SITE OWNER's plan, and credits are not a plan. Routing does not
 * repeat that rule.
 *
 * Fails open. A Supabase blip must not lock a paying customer out of their own
 * dashboard, and this gate is routing, not authorisation — the write side
 * resolves the owner's entitlement independently and fails CLOSED there, so the
 * worst a false negative here costs is a rendered shell with nothing behind it.
 */
async function isUnentitled(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  try {
    return !hasAnyEntitlement(await resolveEntitlement(supabase, userId));
  } catch (error) {
    console.error("[middleware] entitlement check failed", error);
    return false;
  }
}

/**
 * Paths whose response does not depend on a session, so asking about one is
 * pure cost.
 *
 * Everything under `embed/` is a static file in `public/` fetched by every
 * visitor to every customer site that has installed the widget — third parties
 * on someone else's domain who have no session cookie and could not have one.
 * This middleware runs on the Node runtime and awaits `supabase.auth.getUser()`,
 * so letting those paths through the auth block spends a GoTrue round trip per
 * widget load and couples widget availability to GoTrue's. A directory rule
 * rather than a file list, so the next asset type added there does not have to
 * be rediscovered in production. robots.txt and sitemap.xml are the same trade
 * at lower volume: no session is possible, and indexability should not depend
 * on auth uptime; `/llms.txt` (s88), the site map AI search reads, is the same
 * kind of caller. `/try` is the public cold-start path used in outbound demos,
 * and its exact cross-origin runtime path has the same no-session property as
 * the production embed. Keeping both exact avoids turning sibling `/try/*`
 * routes into an accidental auth bypass.
 *
 * `SENTRY_TUNNEL_ROUTE` (s46) is where the browser posts its Sentry events; a
 * rewrite added by `withSentryConfig` forwards them to Sentry's ingest *after*
 * this middleware runs. It is not a protected route, so it was never blocked —
 * but every error event paid a GoTrue round trip, and a rotated session cookie
 * could land on Sentry's response. Sentry's docs say to drop the tunnel from the
 * matcher; this file keeps it matched, for the headers, like every path here.
 * Exact match: with `trailingSlash` off, `/monitoring/` is redirected before it
 * gets here, and anything under the path is not the tunnel.
 *
 * The installation guide and its Markdown handoff are public documentation.
 * A visitor may happen to carry a session cookie, but it changes neither
 * response. Sending those reads through GoTrue would make the help needed to
 * complete an installation depend on authentication being available, which
 * defeats the public route contract introduced by s59.
 *
 * `/api/published/` is s65a's published-copy snapshot (ADR 046): an
 * unauthenticated read that only works because Vercel's CDN caches it. Vercel
 * refuses to cache any response carrying `set-cookie`, and `getUser()` below
 * can rotate a session cookie onto whatever response it touches — so without
 * this entry, a visitor who is also signed in to ReCopyFast would turn the
 * snapshot into an uncacheable origin hit and a GoTrue round trip on a host's
 * render path. The response depends on no session; the route reads no cookie.
 * A prefix, because the site id is a path segment; the sibling `/api/published`
 * and every other `/api/*` path keep the session-aware path.
 *
 * These paths stay *in* `config.matcher`. Skipping the middleware entirely
 * would also skip the security headers below, and `/embed/recopyfast.js` is
 * executable JavaScript loaded cross-origin onto every customer site — the one
 * response on this domain that can least afford to be served without `nosniff`.
 */
function isSessionlessPath(pathname: string): boolean {
  return (
    pathname.startsWith("/embed/") ||
    pathname.startsWith("/api/published/") ||
    pathname === "/docs/install" ||
    pathname === "/docs/install/agent-instructions.md" ||
    pathname === "/try" ||
    pathname === "/try/rcf-try.js" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/llms.txt" ||
    pathname === SENTRY_TUNNEL_ROUTE
  );
}

export async function middleware(request: NextRequest) {
  // This middleware now focuses on auth and page-level security
  // API-level security is handled within individual API routes

  // One policy per request, decided before anything else (s79, ADR 059). On
  // the app surface it carries a fresh nonce, and the SAME string must reach
  // Next on the request: Next reads the nonce it stamps on its scripts from
  // the request's Content-Security-Policy header, never from the response's.
  // A nonce on the response alone blocks every Next script on the page.
  const nonce = usesNoncePolicy(request.nextUrl.pathname)
    ? createCspNonce()
    : undefined;
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV !== "production",
    // Named one by one, as before s79: these are the origins connect-src is
    // derived from, and nothing else in the environment reaches the policy.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
      NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    },
  });

  /**
   * `NextResponse.next` with the request Next should render. Built at call
   * time, not once: Supabase's `setAll` below writes refreshed cookies onto
   * `request` and rebuilds the response, and the rebuilt one must forward
   * those cookies AND the policy. On a nonce route the caller's own
   * Content-Security-Policy request header, if any, is overwritten — the
   * nonce Next uses is ours.
   */
  const forward = () => {
    const headers = new Headers(request.headers);
    if (nonce) headers.set("content-security-policy", contentSecurityPolicy);
    return NextResponse.next({ request: { headers } });
  };

  // Headers, but no session work. Deliberately before the Supabase client is
  // even constructed: the point is that nothing on this path can reach GoTrue.
  if (isSessionlessPath(request.nextUrl.pathname)) {
    return withSecurityHeaders(forward(), contentSecurityPolicy);
  }

  let supabaseResponse = forward();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = forward();
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh session if expired - required for Server Components
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Define protected routes.
  // "/sites" is deliberately absent: no such page exists (site management lives
  // at /dashboard/sites). Gating it only turned a 404 into a login redirect that
  // then 404s anyway.
  const protectedRoutes = ["/dashboard", "/settings"];
  const authRoutes = ["/login", "/signup"];
  const isProtectedRoute = protectedRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route),
  );
  const isAuthRoute = authRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route),
  );

  // Redirect to login if accessing protected route without auth
  if (isProtectedRoute && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirectedFrom", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Redirect to dashboard if accessing auth routes while logged in
  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Signing up does not make an account usable — paying does. An authenticated
  // session with no plan gets one destination, the checkout page, and typing a
  // dashboard URL does not get round it.
  //
  // Only page routes are gated. API routes are under /api and never reach this
  // branch. Their entitlement is enforced where the write happens: every content
  // write and AI spend, and every credential issuance but handoff redemption,
  // calls `checkOwnerCanEdit` (s51, ADR 041) after authorising its caller.
  // Public reads are deliberately ungated and must stay so — the embed, GET
  // /api/content/[siteId], discovery, GET /api/v1/content, bulk export, the
  // three validate routes and the WebSocket broadcast serve a lapsed owner's
  // visitors exactly as before.
  if (
    user &&
    isProtectedRoute &&
    !request.nextUrl.pathname.startsWith(CHECKOUT_PATH) &&
    (await isUnentitled(supabase, user.id))
  ) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = CHECKOUT_PATH;
    redirectUrl.search = "";
    redirectUrl.searchParams.set("checkout", "required");
    redirectUrl.searchParams.set("redirectedFrom", request.nextUrl.pathname);

    // Carry over any refreshed session cookie. `supabase.auth.getUser()` above
    // can rotate the token, and dropping the new one here would sign the user
    // out on the way to being asked to pay.
    const redirect = NextResponse.redirect(redirectUrl);
    for (const cookie of supabaseResponse.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  return withSecurityHeaders(supabaseResponse, contentSecurityPolicy);
}

/**
 * The security headers every response leaving this app carries.
 *
 * Separated from the auth block above so a path that must not pay for a session
 * can still be given headers — see `isSessionlessPath`. Redirects are the one
 * exception: they carry no body to protect, and the destination they point at
 * comes back through here.
 *
 * The policy itself is built in `@/lib/security/content-security-policy`
 * (ADR 059): a per-request nonce on the app surface, today's static policy on
 * the marketing surface. connect-src is derived from env there, exactly as it
 * was here.
 *
 * TOMBSTONE — `X-XSS-Protection: 1; mode=block` was set here until s79 (s69
 * L19). Browsers removed the auditor it configured, and where it still exists
 * `mode=block` has been used for cross-site leaks; the CSP is the protection.
 * Do not re-add it. HSTS is not here: it is set once, in `next.config.ts`, so
 * static assets the matcher skips send the same policy (a browser keeps the
 * last one it saw).
 */
function withSecurityHeaders(
  response: NextResponse,
  contentSecurityPolicy: string,
): NextResponse {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public static assets
     *
     * API routes ARE included so they receive security headers
     * (X-Content-Type-Options, X-Frame-Options, etc.).
     *
     * `embed/`, `/docs/install`, `/try`, its exact runtime asset, robots.txt,
     * sitemap.xml, llms.txt and the Sentry tunnel are deliberately NOT excluded
     * here.
     * They must not pay for a session — but the matcher is all-or-nothing, and
     * excluding them would drop the security headers too. The widget script is
     * executable JavaScript loaded cross-origin onto every customer site, so
     * serving it without `nosniff` is the worst place on this domain to save a
     * round trip. The saving is made inside the middleware instead, by
     * `isSessionlessPath`, which returns headers without touching GoTrue.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
