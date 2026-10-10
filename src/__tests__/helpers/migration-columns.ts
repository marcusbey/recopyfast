/**
 * Each table's columns, as `supabase/migrations/` builds them.
 *
 * Test doubles need to know what a table really has. A hand-kept list drifts
 * the way the stub behind the v1 rate limiter did (s44): it accepted columns no
 * migration ever created, so a limiter that could not run in production passed
 * every test. Reading the migrations means a column the code names but no
 * migration creates is unknown here too.
 *
 * Deliberately small: it understands what this repository's migrations use —
 * the first `CREATE TABLE` of a table in ledger order (later `IF NOT EXISTS`
 * re-creations are no-ops in Postgres, and so here), then
 * `ALTER TABLE … ADD / DROP / RENAME COLUMN`. Only unqualified and `public.`
 * tables are read. Dynamic SQL inside `EXECUTE` strings is invisible to it.
 * `schema-strict-supabase.test.ts` anchors the result to production's columns.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

const TABLE_NAME = String.raw`((?:"?\w+"?\s*\.\s*)?"?\w+"?)`;

const CREATE_TABLE = new RegExp(
  String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${TABLE_NAME}\s*\(`,
  "gi",
);

const ALTER_TABLE = new RegExp(
  String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${TABLE_NAME}\s+([^;]*);`,
  "gi",
);

/** Table-level items in a CREATE TABLE body that are not columns. */
const TABLE_CONSTRAINT =
  /^(constraint|primary\s+key|unique|check|foreign\s+key|exclude|like)\b/i;

/** ADD forms that add a constraint rather than a column. */
const ADD_CONSTRAINT =
  /^add\s+(constraint|primary|unique|check|foreign|exclude)\b/i;

function unquote(identifier: string): string {
  return identifier.replace(/"/g, "").toLowerCase();
}

/** `public.x` and `x` name the same table; any other schema is not ours. */
function publicTableName(qualified: string): string | null {
  const parts = qualified.split(".").map((part) => unquote(part.trim()));
  if (parts.length === 1) return parts[0];
  return parts[0] === "public" ? parts[1] : null;
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Split on commas that are not inside parentheses or quotes. */
function splitTopLevel(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";

  for (const char of body) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) items.push(current.trim());
  return items;
}

/** The text between the `(` at `openIndex` and its matching `)`. */
function balancedBody(sql: string, openIndex: number): string {
  let depth = 0;
  let quote: string | null = null;

  for (let index = openIndex; index < sql.length; index += 1) {
    const char = sql[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) return sql.slice(openIndex + 1, index);
    }
  }

  throw new Error(`Unbalanced CREATE TABLE body at offset ${openIndex}`);
}

function firstIdentifier(item: string): string {
  const match = /^("[^"]+"|\w+)/.exec(item);
  return match ? unquote(match[1]) : "";
}

function applyAlter(columns: Set<string>, actions: string): void {
  for (const action of splitTopLevel(actions)) {
    if (ADD_CONSTRAINT.test(action)) continue;

    const added =
      /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?("[^"]+"|\w+)/i.exec(
        action,
      );
    if (added) {
      columns.add(unquote(added[1]));
      continue;
    }

    const dropped = /^drop\s+column\s+(?:if\s+exists\s+)?("[^"]+"|\w+)/i.exec(
      action,
    );
    if (dropped) {
      columns.delete(unquote(dropped[1]));
      continue;
    }

    const renamed =
      /^rename\s+(?:column\s+)?("[^"]+"|\w+)\s+to\s+("[^"]+"|\w+)/i.exec(
        action,
      );
    if (renamed && !/^rename\s+(to|constraint)\b/i.test(action)) {
      columns.delete(unquote(renamed[1]));
      columns.add(unquote(renamed[2]));
    }
  }
}

type Statement =
  | { index: number; kind: "create"; table: string; columns: string[] }
  | { index: number; kind: "alter"; table: string; actions: string };

function statementsIn(sql: string): Statement[] {
  const statements: Statement[] = [];

  for (const match of sql.matchAll(CREATE_TABLE)) {
    const table = publicTableName(match[1]);
    if (!table || match.index === undefined) continue;

    const body = balancedBody(sql, match.index + match[0].length - 1);
    const columns = splitTopLevel(body)
      .filter((item) => !TABLE_CONSTRAINT.test(item))
      .map(firstIdentifier)
      .filter(Boolean);

    statements.push({ index: match.index, kind: "create", table, columns });
  }

  for (const match of sql.matchAll(ALTER_TABLE)) {
    const table = publicTableName(match[1]);
    if (!table || match.index === undefined) continue;
    statements.push({
      index: match.index,
      kind: "alter",
      table,
      actions: match[2],
    });
  }

  return statements.sort((a, b) => a.index - b.index);
}

function buildSchema(): Map<string, Set<string>> {
  const schema = new Map<string, Set<string>>();
  // Lexical order is ledger order — src/__tests__/migrations/ledger-order.test.ts.
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = stripComments(
      readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"),
    );

    for (const statement of statementsIn(sql)) {
      const existing = schema.get(statement.table);

      if (statement.kind === "create") {
        if (!existing) schema.set(statement.table, new Set(statement.columns));
      } else if (existing) {
        applyAlter(existing, statement.actions);
      }
    }
  }

  return schema;
}

let cachedSchema: Map<string, Set<string>> | null = null;

/** The table's columns, or `undefined` when no migration creates it. */
export function migrationColumns(
  table: string,
): ReadonlySet<string> | undefined {
  cachedSchema ??= buildSchema();
  return cachedSchema.get(table.toLowerCase());
}
