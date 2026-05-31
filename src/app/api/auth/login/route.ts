import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  rateLimiter,
  createRateLimitConfig,
} from "@/lib/security/rate-limiter";

export async function POST(request: NextRequest) {
  // Rate limiting — protect against credential stuffing (API_AUTH: 5 req / 15 min per IP)
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const rateLimitResult = await rateLimiter.checkLimit(
    createRateLimitConfig(ip, "ip", "API_AUTH", "auth/login"),
  );

  if (!rateLimitResult.allowed) {
    const retryAfterSec = Math.ceil(
      (rateLimitResult.resetTime - Date.now()) / 1000,
    );
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Limit": "5",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(rateLimitResult.resetTime),
        },
      },
    );
  }

  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    const supabase = await createClient();

    // Sign in the user
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json({
      user: data.user,
      session: data.session,
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
