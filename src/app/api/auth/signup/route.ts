import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  rateLimiter,
  createRateLimitConfig,
} from "@/lib/security/rate-limiter";

export async function POST(request: NextRequest) {
  // Rate limiting — protect against automated mass-registration (API_AUTH: 5 req / 15 min per IP)
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const rateLimitResult = await rateLimiter.checkLimit(
    createRateLimitConfig(ip, "ip", "API_AUTH", "auth/signup"),
  );

  if (!rateLimitResult.allowed) {
    const retryAfterSec = Math.ceil(
      (rateLimitResult.resetTime - Date.now()) / 1000,
    );
    return NextResponse.json(
      { error: "Too many signup attempts. Please try again later." },
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
    const { email, password, metadata } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    const supabase = await createClient();

    // Sign up the user
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata || {},
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      user: data.user,
      message: "Check your email to confirm your account",
    });
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
