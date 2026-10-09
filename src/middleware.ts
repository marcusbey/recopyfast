import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  hasAnyEntitlement,
  resolveEntitlement,
} from "@/lib/billing/effective-plan";
import {
  isForwardableTunnelRequest,
  isSentryTunnelPath,
} from "@/lib/monitoring/sentry-tunnel-guard";

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
 * on auth uptime. `/try` is the public cold-start path used in outbound demos,
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
 * Every spelling the rewrite accepts (`isSentryTunnelPath`: any case, trailing
 * slash, percent-encoded), not just the exact one — the rewrite forwards
 * `/Monitoring` too. Anything under the path is not the tunnel.
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
    isSentryTunnelPath(pathname)
  );
}

export async function middleware(request: NextRequest) {
  // This middleware now focuses on auth and page-level security
  // API-level security is handled within individual API routes

  // The Sentry tunnel forwards only our own browser's envelopes (s84). Until
  // then the rewrite behind this path relayed to ANY Sentry project named in
  // its query string — see `sentry-tunnel-guard.ts`. This runs before that
  // rewrite, so a refusal here means nothing leaves for Sentry. Still served
  // with the security headers, still no session work. Never `=== "/monitoring"`:
  // the rewrite also accepts `/MONITORING`, and an exact match let the s84
  // review relay a stranger's envelope through it (`isSentryTunnelPath`).
  if (isSentryTunnelPath(request.nextUrl.pathname)) {
    const isForwardable = await isForwardableTunnelRequest(
      {
        method: request.method,
        searchParams: request.nextUrl.searchParams,
        readBody: () => request.text(),
      },
      process.env.NEXT_PUBLIC_SENTRY_DSN,
    );
    if (!isForwardable) {
      return withSecurityHeaders(
        NextResponse.json({ error: "Invalid tunnel request" }, { status: 400 }),
      );
    }
  }

  // Headers, but no session work. Deliberately before the Supabase client is
  // even constructed: the point is that nothing on this path can reach GoTrue.
  if (isSessionlessPath(request.nextUrl.pathname)) {
    return withSecurityHeaders(NextResponse.next({ request }));
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

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
          supabaseResponse = NextResponse.next({
            request,
          });
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

  return withSecurityHeaders(supabaseResponse);
}

/**
 * The security headers every response leaving this app carries.
 *
 * Separated from the auth block above so a path that must not pay for a session
 * can still be given headers — see `isSessionlessPath`. Redirects are the one
 * exception: they carry no body to protect, and the destination they point at
 * comes back through here.
 */
function withSecurityHeaders(response: NextResponse): NextResponse {
  // Security headers
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );

  // Content Security Policy
  // In development keep 'unsafe-eval' so Next.js HMR / React DevTools work.
  // In production drop it to prevent arbitrary code execution.
  const isDev = process.env.NODE_ENV !== "production";
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

  // connect-src must allowlist every origin the client opens XHR/fetch/WebSocket to,
  // or the browser silently blocks them. 'self' alone breaks Supabase (REST + wss
  // realtime) and the Socket.io server. Derive the exact origins from env so we
  // don't widen the policy to a blanket https:/wss:.
  //
  // Sentry does not need an entry of its own: since s46 the browser SDK posts to
  // the same-origin `SENTRY_TUNNEL_ROUTE`, which 'self' covers. The DSN origin is
  // still added below for the one case the SDK skips the tunnel — a DSN that is
  // not a sentry.io SaaS host. It was already here before s46, which is how we
  // know the CSP was never what kept events from arriving.
  const connectSrc = new Set<string>(["'self'"]);
  const addOrigin = (raw?: string) => {
    if (!raw) return;
    try {
      const { protocol, host } = new URL(raw);
      // Supabase exposes REST over https and realtime over wss on the same host.
      if (protocol === "https:" || protocol === "http:") {
        connectSrc.add(`https://${host}`);
        connectSrc.add(`wss://${host}`);
      } else if (protocol === "wss:" || protocol === "ws:") {
        connectSrc.add(`wss://${host}`);
        connectSrc.add(`https://${host}`);
      }
      // Keep the scheme as configured too. Socket.io opens its handshake over
      // plain HTTP polling before upgrading, so a local `http://host:4001` WS
      // URL needs http:/ws: allowed or the connection dies at the first XHR.
      // Only in dev — production env values are https/wss and stay that way.
      if (isDev && (protocol === "http:" || protocol === "ws:")) {
        connectSrc.add(`http://${host}`);
        connectSrc.add(`ws://${host}`);
      }
    } catch {
      // ignore malformed env values
    }
  };
  addOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  addOrigin(process.env.NEXT_PUBLIC_WS_URL);
  addOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN);
  if (isDev) connectSrc.add("ws://localhost:*");

  const csp = [
    "default-src 'self'",
    scriptSrc,
    // Browsers fall back to script-src when script-src-elem is absent, so this
    // is not a tightening — it just stops the fallback from being implicit, and
    // makes the "which directive blocked me" console message unambiguous.
    scriptSrc.replace("script-src", "script-src-elem"),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' https:",
    `connect-src ${Array.from(connectSrc).join(" ")}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    // CSP equivalent of the X-Frame-Options: DENY header set above. Kept in
    // sync with it; frame-ancestors is what modern browsers actually honour.
    "frame-ancestors 'none'",
  ].join("; ");

  response.headers.set("Content-Security-Policy", csp);

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
     * sitemap.xml and the Sentry tunnel are deliberately NOT excluded here.
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
