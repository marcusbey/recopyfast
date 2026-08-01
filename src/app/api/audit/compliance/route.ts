import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { auditLogger } from "@/lib/audit/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { report_type, site_id, start_date, end_date } = body;

    if (!report_type || !start_date || !end_date) {
      return NextResponse.json(
        { error: "Missing required fields: report_type, start_date, end_date" },
        { status: 400 },
      );
    }

    const validReportTypes = ["gdpr", "soc2", "hipaa", "custom"];
    if (!validReportTypes.includes(report_type)) {
      return NextResponse.json(
        { error: "Invalid report type" },
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
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user has admin permissions or site access
    if (site_id) {
      const { data: permission } = await supabase
        .from("site_permissions")
        .select("permission")
        .eq("site_id", site_id)
        .eq("user_id", user.id)
        .single();

      if (!permission || permission.permission !== "admin") {
        return NextResponse.json(
          { error: "Insufficient permissions" },
          { status: 403 },
        );
      }
    } else {
      // For global reports, check if user is admin.
      // raw_user_meta_data is caller-writable and MUST NOT be used for authz.
      // Trust only app_metadata (server-managed) and ADMIN_EMAILS env-var allowlist.
      const adminEmails = (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

      const isGlobalAdmin =
        (user.email != null &&
          adminEmails.includes(user.email.toLowerCase())) ||
        user.app_metadata?.role === "admin";

      if (!isGlobalAdmin) {
        return NextResponse.json(
          { error: "Admin privileges required" },
          { status: 403 },
        );
      }
    }

    // Generate compliance report
    const report = await auditLogger.generateComplianceReport({
      siteId: site_id,
      reportType: report_type,
      startDate: start_date,
      endDate: end_date,
      generatedBy: user.id,
    });

    return NextResponse.json(report);
  } catch (error) {
    console.error("Generate compliance report error:", error);
    return NextResponse.json(
      { error: "Failed to generate compliance report" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("siteId");
    const reportType = searchParams.get("reportType");

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

    // Check permissions
    if (siteId) {
      const { data: permission } = await supabase
        .from("site_permissions")
        .select("permission")
        .eq("site_id", siteId)
        .eq("user_id", user.id)
        .single();

      if (!permission || permission.permission !== "admin") {
        return NextResponse.json(
          { error: "Insufficient permissions" },
          { status: 403 },
        );
      }
    }

    // Build query
    let query = supabase
      .from("compliance_reports")
      .select("*")
      .order("created_at", { ascending: false });

    if (siteId) {
      query = query.eq("site_id", siteId);
    }

    if (reportType) {
      query = query.eq("report_type", reportType);
    }

    // Limit to user's reports if not admin.
    // raw_user_meta_data is caller-writable; trust only app_metadata + ADMIN_EMAILS.
    const adminEmailsGet = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const isAdminGet =
      (user.email != null &&
        adminEmailsGet.includes(user.email.toLowerCase())) ||
      user.app_metadata?.role === "admin";

    if (!isAdminGet) {
      query = query.eq("generated_by", user.id);
    }

    const { data: reports, error } = await query.limit(50);

    if (error) {
      throw error;
    }

    return NextResponse.json(reports || []);
  } catch (error) {
    console.error("Get compliance reports error:", error);
    return NextResponse.json(
      { error: "Failed to fetch compliance reports" },
      { status: 500 },
    );
  }
}
