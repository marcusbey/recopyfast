import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { auditLogger } from "@/lib/audit/logger";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    // searchParams.get returns string | null; getLogs filters expect string | undefined.
    const resourceType = searchParams.get("resourceType") ?? undefined;
    const resourceId = searchParams.get("resourceId") ?? undefined;
    const action = searchParams.get("action") ?? undefined;
    const startDate = searchParams.get("startDate") ?? undefined;
    const endDate = searchParams.get("endDate") ?? undefined;
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => req.cookies.get(name)?.value,
          set: () => {},
          remove: () => {},
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user has admin role or appropriate permissions.
    // raw_user_meta_data / user_metadata is caller-writable and MUST NOT be used
    // for server-side authorization. Trust only:
    //   1. ADMIN_EMAILS env-var allowlist (server-managed)
    //   2. app_metadata.role set server-side via the Supabase Admin SDK
    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const isAdmin =
      (user.email != null && adminEmails.includes(user.email.toLowerCase())) ||
      user.app_metadata?.role === "admin";

    if (!isAdmin) {
      // Non-admin users can only see their own audit logs
      const { logs, total } = await auditLogger.getLogs({
        userId: user.id,
        resourceType,
        resourceId,
        action,
        startDate,
        endDate,
        limit,
        offset,
      });

      return NextResponse.json({ logs, total });
    }

    // Admin users can see all logs with filters
    const { logs, total } = await auditLogger.getLogs({
      resourceType,
      resourceId,
      action,
      startDate,
      endDate,
      limit,
      offset,
    });

    return NextResponse.json({ logs, total });
  } catch (error) {
    console.error("Get audit logs error:", error);
    return NextResponse.json(
      { error: "Failed to fetch audit logs" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, resourceType, resourceId, metadata } = body;

    if (!action || !resourceType) {
      return NextResponse.json(
        { error: "Missing required fields: action, resourceType" },
        { status: 400 },
      );
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => req.cookies.get(name)?.value,
          set: () => {},
          remove: () => {},
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Extract client info
    // NextRequest no longer exposes .ip (removed in Next 15+); derive from headers.
    const forwarded = req.headers.get("x-forwarded-for");
    const ipAddress = forwarded
      ? forwarded.split(",")[0]
      : (req.headers.get("x-real-ip") ?? undefined);
    const userAgent = req.headers.get("user-agent") ?? undefined;

    await auditLogger.log({
      userId: user?.id,
      action,
      resourceType,
      resourceId,
      ipAddress,
      userAgent,
      metadata,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Log audit event error:", error);
    return NextResponse.json(
      { error: "Failed to log audit event" },
      { status: 500 },
    );
  }
}
