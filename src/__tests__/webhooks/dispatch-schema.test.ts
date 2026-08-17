/**
 * Schema contract for out-of-band webhook dispatch (ADR 010).
 *
 * The dispatch engine is two-phase: a publish marks a coalescing window on
 * `webhooks`, a cron sweeps the due ones and the due retries on
 * `webhook_deliveries`. Every one of those steps reads or writes a column that
 * did not exist before this story, so a missing column does not fail loudly —
 * PostgREST answers with an error the manager logs and swallows, and deliveries
 * silently stop. That is the same class of failure as the `setTimeout` retry
 * this replaces, which never fired in production and never said so.
 *
 * These are source assertions over `supabase/migrations`, deliberately not
 * database tests: `src/__tests__/db/*` gate themselves out when no Postgres is
 * reachable, and this contract has to hold on every laptop and in CI.
 */

import fs from "fs";
import path from "path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

function migrationSql(): string {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"))
    .join("\n");
}

/** Every `ALTER TABLE <table> ADD COLUMN ...` fragment across the set. */
function addedColumns(table: string): string[] {
  const pattern = new RegExp(
    `ALTER TABLE\\s+(?:public\\.)?${table}\\s+ADD COLUMN(?: IF NOT EXISTS)?\\s+([^;]+);`,
    "gi",
  );
  return [...migrationSql().matchAll(pattern)].map((match) =>
    match[1].replace(/\s+/g, " ").trim(),
  );
}

function columnDefinition(table: string, column: string): string | undefined {
  return addedColumns(table).find((definition) =>
    new RegExp(`^${column}\\b`, "i").test(definition),
  );
}

describe("webhook dispatch schema", () => {
  describe("webhooks — coalescing window state", () => {
    it("adds a secret_prefix for show-once display", () => {
      expect(columnDefinition("webhooks", "secret_prefix")).toMatch(/TEXT/i);
    });

    it("adds coalesce_window_seconds defaulting to 30 and never null", () => {
      const definition = columnDefinition(
        "webhooks",
        "coalesce_window_seconds",
      );

      expect(definition).toMatch(/INTEGER/i);
      expect(definition).toMatch(/NOT NULL/i);
      expect(definition).toMatch(/DEFAULT 30\b/i);
    });

    it("adds the pending-dispatch triple the sweep reads", () => {
      expect(columnDefinition("webhooks", "pending_event_type")).toMatch(
        /TEXT/i,
      );
      expect(columnDefinition("webhooks", "pending_payload")).toMatch(/JSONB/i);
      expect(columnDefinition("webhooks", "pending_dispatch_at")).toMatch(
        /TIMESTAMPTZ|TIMESTAMP WITH TIME ZONE/i,
      );
    });
  });

  describe("webhook_deliveries — persisted retry state", () => {
    it("adds a status constrained to the four dispatch states", () => {
      const definition = columnDefinition("webhook_deliveries", "status");

      expect(definition).toMatch(/TEXT/i);
      expect(definition).toMatch(/NOT NULL/i);
      expect(definition).toMatch(/DEFAULT 'delivered'/i);
      for (const state of ["pending", "delivered", "retrying", "failed"]) {
        expect(definition).toContain(`'${state}'`);
      }
    });

    it("adds next_retry_at so a backoff survives the invocation that scheduled it", () => {
      expect(columnDefinition("webhook_deliveries", "next_retry_at")).toMatch(
        /TIMESTAMPTZ|TIMESTAMP WITH TIME ZONE/i,
      );
    });
  });

  it("leaves the migration that created the tables untouched (forward-only)", () => {
    const original = fs.readFileSync(
      path.join(
        MIGRATIONS_DIR,
        "20260731004000_missing_tables_integrations.sql",
      ),
      "utf8",
    );

    expect(original).not.toMatch(/pending_dispatch_at|next_retry_at/);
  });
});
