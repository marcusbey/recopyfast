import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  hasAnyEntitlement,
  resolveEntitlement,
} from "@/lib/billing/effective-plan";

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
 * A credit holder passes here — they bought something that works, and bouncing
 * them to checkout would put the thing they paid for behind a wall.
 *
 * Fails open. A Supabase blip must not lock a paying customer out of their own
 * dashboard, and this gate is routing, not authorisation — every API route and
 * feature gate resolves entitlement independently, so the worst a false
 * negative here costs is a rendered shell with nothing behind it.
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

export async function middleware(request: NextRequest) {
  // This middleware now focuses on auth and page-level security
  // API-level security is handled within individual API routes

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
  // Only page routes are gated. API routes are under /api and enforce their own
  // entitlement, so they never reach this branch and never pay for the query.
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

  // Add security headers to all responses
  const response = supabaseResponse;

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
  // realtime), the Socket.io server, and Sentry ingest. Derive the exact origins
  // from env so we don't widen the policy to a blanket https:/wss:.
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
     * - embed/ (the widget, see below)
     * - robots.txt, sitemap.xml (crawler fetches)
     * - public static assets
     *
     * API routes ARE included so they receive security headers
     * (X-Content-Type-Options, X-Frame-Options, etc.).
     *
     * `embed/` is excluded as a whole directory rather than by extension.
     * Everything under it is a static file in `public/` fetched by every
     * visitor to every customer site that has installed the widget — third
     * parties on someone else's domain who have no session cookie and could
     * not have one. This middleware runs on the Node runtime and awaits
     * `supabase.auth.getUser()`, so leaving those paths in the matcher spent a
     * GoTrue round trip per widget load and coupled widget availability to
     * GoTrue's. A directory rule also means the next asset type added there
     * does not have to be rediscovered in production.
     *
     * robots.txt and sitemap.xml are the same trade at lower volume: no
     * session is possible, and indexability should not depend on auth uptime.
     */
    "/((?!_next/static|_next/image|favicon.ico|embed/|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
