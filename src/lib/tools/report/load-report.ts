/**
 * The report page's one read (s96, ADR 062): validate the id, the slug and the
 * stored JSON, or answer null (the page then 404s).
 *
 * - A non-UUID never reaches Postgres: `uuid = 'x'` raises 22P02, which would
 *   be a 500, not a 404.
 * - The slug must be a scan tool in the catalogue AND equal the row's tool,
 *   so one report cannot be shown under another tool's name.
 * - The row is read through the service role with a fixed projection — no web
 *   principal can read `tool_reports` at all — and only while unexpired.
 * - The stored JSON is re-validated (`parseStoredReport`); a row that fails is
 *   logged and treated as missing, never rendered.
 *
 * A database error is thrown, not swallowed: an outage is a 500 from the error
 * boundary, not a "this report doesn't exist" that would be untrue.
 */

import { requireUuid } from "@/lib/api/validation";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { isScanTool } from "@/lib/tools/catalogue";
import { parseStoredReport, type ToolReport } from "./report-schema";
import { createReportStore } from "./report-store";

export async function loadReport(
  slug: string,
  id: string,
  now: Date = new Date(),
): Promise<ToolReport | null> {
  const uuid = requireUuid({ id }, "id");
  if (!uuid.ok) return null;
  if (!isScanTool(slug)) return null;

  const row = await createReportStore(createServiceRoleClient()).getReportById(
    uuid.value,
    now,
  );
  if (!row || row.tool !== slug) return null;

  const report = parseStoredReport(row.report);
  if (!report || report.tool !== slug) {
    console.error(
      "[tools/report] stored report failed validation:",
      uuid.value,
    );
    return null;
  }
  return report;
}
