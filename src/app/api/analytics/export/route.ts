import { NextRequest, NextResponse } from "next/server";
import { analytics } from "@/lib/analytics/tracker";
import {
  authorizeSiteReadAccess,
  requireAuthenticatedUser,
} from "@/lib/security/ingest-auth";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { requireUuid } from "@/lib/api/validation";
import type { AnalyticsDashboardData } from "@/types";

/**
 * Analytics export.
 *
 * Serves the same dashboard payload as GET /api/analytics/track, but as a
 * downloadable file. Authorization is deliberately identical to the read path —
 * exporting must never widen access beyond what the caller can already see on
 * screen. Unlike the ingest endpoints there is no site-token path here: only a
 * signed-in user with a permission row may export.
 */

const EXPORT_FORMATS = ["json", "csv"] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

function isExportFormat(value: string | null): value is ExportFormat {
  return (
    value !== null && (EXPORT_FORMATS as readonly string[]).includes(value)
  );
}

/**
 * Escape one CSV field.
 *
 * Beyond RFC-4180 quoting, a leading =, +, - or @ is prefixed with a single
 * quote: spreadsheet software treats those as formulas, so an attacker-supplied
 * domain like `=cmd|...` would execute on open. Domains and dates are the only
 * free-form values here, but they come from user-registered sites.
 */
function csvField(value: string | number): string {
  const raw = String(value);
  const guarded = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function csvRow(fields: Array<string | number>): string {
  return fields.map(csvField).join(",");
}

/**
 * Flatten the nested dashboard shape into one CSV.
 *
 * A single table cannot express overview/trends/top_sites/performance without
 * losing structure, so each row carries its own `section` and `metric` label.
 * This keeps the file trivially filterable in a spreadsheet.
 */
function generateCSV(data: AnalyticsDashboardData): string {
  const header = csvRow(["section", "metric", "date", "value"]);
  const rows: string[] = [];

  for (const [metric, value] of Object.entries(data.overview)) {
    rows.push(csvRow(["overview", metric, "", value]));
  }

  for (const [metric, value] of Object.entries(data.performance)) {
    rows.push(csvRow(["performance", metric, "", value]));
  }

  for (const [metric, points] of Object.entries(data.trends)) {
    for (const point of points) {
      rows.push(csvRow(["trends", metric, point.date, point.value]));
    }
  }

  for (const site of data.top_sites) {
    rows.push(
      csvRow(["top_sites", `${site.domain} page_views`, "", site.page_views]),
    );
    rows.push(csvRow(["top_sites", `${site.domain} edits`, "", site.edits]));
  }

  return [header, ...rows].join("\n");
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const formatParam = searchParams.get("format");
    const siteIdParam = searchParams.get("siteId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (!isExportFormat(formatParam)) {
      return NextResponse.json(
        { error: `format must be one of: ${EXPORT_FORMATS.join(", ")}` },
        { status: 400 },
      );
    }

    // siteId is optional — the dashboard's "all sites" view omits it, matching
    // the read endpoint's behaviour.
    let siteId: string | undefined;
    if (siteIdParam) {
      const parsed = requireUuid({ siteId: siteIdParam }, "siteId");
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      siteId = parsed.value;
    }

    const auth = siteId
      ? await authorizeSiteReadAccess(siteId)
      : await requireAuthenticatedUser();

    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Export assembles the full dataset per call, so it is more expensive than a
    // dashboard read. It shares the general user bucket rather than getting its
    // own, keeping one budget across a user's dashboard activity.
    const limited = await enforceRateLimit(req, {
      limit: "USER_GENERAL",
      endpoint: "analytics/export",
      identifier: auth.userId!,
      identifierType: "user",
      onStoreFailure: "allow",
    });
    if (limited) return limited;

    const dateRange =
      startDate && endDate ? { start: startDate, end: endDate } : undefined;
    const data = await analytics.getDashboardData(siteId, dateRange);

    const stamp = new Date().toISOString().split("T")[0];
    const filename = `analytics-${siteId ?? "all-sites"}-${stamp}.${formatParam}`;
    const body =
      formatParam === "csv" ? generateCSV(data) : JSON.stringify(data, null, 2);

    return new NextResponse(body, {
      headers: {
        "Content-Type":
          formatParam === "csv"
            ? "text/csv; charset=utf-8"
            : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Analytics export error:", error);
    return NextResponse.json(
      { error: "Failed to export analytics" },
      { status: 500 },
    );
  }
}
