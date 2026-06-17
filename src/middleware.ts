import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Use Node.js runtime for full API compatibility
export const runtime = "nodejs";

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

  // Define protected routes
  const protectedRoutes = ["/dashboard", "/sites", "/settings"];
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
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' https:",
    `connect-src ${Array.from(connectSrc).join(" ")}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
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
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
