/**
 * `public.tool_reports` through the service role — the only way in (s96, ADR
 * 062). No web principal holds a grant on the table, so this module is the
 * whole read and write surface, and its projections are fixed:
 *
 * - the scan route reads `id` for a cache hit and inserts one row;
 * - the report page reads ONE row, by id, `id, tool, report, created_at,
 *   expires_at`, and only while it has not expired.
 *
 * A database error is thrown as `ReportStoreError` (no message from the
 * database reaches a caller); "no row" is null.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const CACHE_WINDOW_MS = 24 * 60 * 60 * 1000;
const TABLE = "tool_reports";

export class ReportStoreError extends Error {
  constructor(operation: string) {
    super(`tool_reports ${operation} failed`);
    this.name = "ReportStoreError";
  }
}

export interface StoredReportRow {
  id: string;
  tool: string;
  report: unknown;
  createdAt: string;
  expiresAt: string;
}

export interface NewReport {
  tool: string;
  cacheKey: string;
  url: string;
  report: object;
}

export interface ReportStore {
  /** The newest unexpired report for this key from the last 24 h, if any. */
  findCachedReportId(cacheKey: string, now: Date): Promise<string | null>;
  insertReport(row: NewReport): Promise<string>;
  getReportById(id: string, now: Date): Promise<StoredReportRow | null>;
}

export function createReportStore(client: SupabaseClient): ReportStore {
  return {
    async findCachedReportId(cacheKey, now) {
      const { data, error } = await client
        .from(TABLE)
        .select("id")
        .eq("cache_key", cacheKey)
        .gt(
          "created_at",
          new Date(now.getTime() - CACHE_WINDOW_MS).toISOString(),
        )
        .gt("expires_at", now.toISOString())
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) {
        console.error("[tools/report-store] cache lookup failed:", error.code);
        throw new ReportStoreError("cache lookup");
      }
      const row = (data ?? [])[0] as { id?: unknown } | undefined;
      return typeof row?.id === "string" ? row.id : null;
    },

    async insertReport({ tool, cacheKey, url, report }) {
      const { data, error } = await client
        .from(TABLE)
        .insert({ tool, cache_key: cacheKey, url, report })
        .select("id")
        .single();
      if (error || typeof (data as { id?: unknown } | null)?.id !== "string") {
        console.error("[tools/report-store] insert failed:", error?.code);
        throw new ReportStoreError("insert");
      }
      return (data as { id: string }).id;
    },

    async getReportById(id, now) {
      const { data, error } = await client
        .from(TABLE)
        .select("id, tool, report, created_at, expires_at")
        .eq("id", id)
        .gt("expires_at", now.toISOString())
        .maybeSingle();
      if (error) {
        console.error("[tools/report-store] read failed:", error.code);
        throw new ReportStoreError("read");
      }
      if (!data) return null;
      const row = data as {
        id: string;
        tool: string;
        report: unknown;
        created_at: string;
        expires_at: string;
      };
      return {
        id: row.id,
        tool: row.tool,
        report: row.report,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      };
    },
  };
}
