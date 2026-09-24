/**
 * s27 / A-26 — href and alt must survive the complete database lifecycle.
 *
 * This suite deliberately builds the smallest pre-s27 schema in a disposable
 * database and then executes the real forward migration. A mocked Supabase
 * client can prove that a route asked for a write; it cannot prove that the
 * deployed functions publish an attribute-only change, snapshot it, restore it
 * to staging, preserve unrelated JSON, or remain closed to browser roles.
 *
 * The database URL is opt-in and loopback-only. In particular, port 54322 is
 * refused: that is the repository's ordinary Supabase port and may contain a
 * developer's full local stack. This test owns a scratch database, not that
 * stack and never any remote database.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

interface QueryResult<R> {
  rows: R[];
  rowCount: number | null;
}

interface PgPool {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
  end(): Promise<void>;
}

interface PgPoolConstructor {
  new (config: { connectionString: string; max?: number }): PgPool;
}

// `pg` is already a runtime dependency but has no declarations in this repo.
// Keep the structural type local, matching the established db-harness pattern.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Pool } = require("pg") as { Pool: PgPoolConstructor };

let routeDatabase: PgPool | undefined;

type Filter = { column: string; value: unknown };

/**
 * The narrow supabase-js surface used by the four handlers in the route-level
 * test. Transport is adapted to the scratch Postgres; route logic, SQL
 * functions, stored rows, and returned projections remain real.
 */
class SqlTableQuery implements PromiseLike<{ data: unknown; error: null }> {
  private operation: "select" | "update" | "insert" = "select";
  private columns = "*";
  private payload: Record<string, unknown> = {};
  private readonly filters: Filter[] = [];

  constructor(private readonly table: string) {}

  select(columns = "*"): this {
    this.operation = "select";
    this.columns = columns;
    return this;
  }

  update(payload: Record<string, unknown>): this {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  insert(payload: Record<string, unknown>): this {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value });
    return this;
  }

  async single(): Promise<{ data: unknown; error: null }> {
    const result = await this.execute(true);
    return { data: (result.data as unknown[])[0] ?? null, error: null };
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: unknown;
          error: null;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute(false).then(onfulfilled, onrejected);
  }

  private async execute(
    single: boolean,
  ): Promise<{ data: unknown; error: null }> {
    if (!routeDatabase) throw new Error("route database used before setup");

    const values: unknown[] = [];
    const bind = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };
    const where = this.filters.length
      ? ` WHERE ${this.filters
          .map(
            ({ column, value }) =>
              `${quoteIdentifier(column)} = ${bind(value)}`,
          )
          .join(" AND ")}`
      : "";

    if (this.operation === "select") {
      // Route column lists are static source text, not caller input. Quote each
      // identifier so this adapter cannot accidentally widen the projection.
      const projection =
        this.columns === "*"
          ? "*"
          : this.columns
              .split(",")
              .map((column) => quoteIdentifier(column.trim()))
              .join(", ");
      const result = await routeDatabase.query(
        `SELECT ${projection} FROM ${quoteIdentifier(this.table)}${where}${
          single ? " LIMIT 1" : ""
        }`,
        values,
      );
      return { data: result.rows, error: null };
    }

    const entries = Object.entries(this.payload);
    if (this.operation === "update") {
      const set = entries
        .map(([column, value]) => `${quoteIdentifier(column)} = ${bind(value)}`)
        .join(", ");
      await routeDatabase.query(
        `UPDATE ${quoteIdentifier(this.table)} SET ${set}${where}`,
        values,
      );
      return { data: null, error: null };
    }

    const columns = entries
      .map(([column]) => quoteIdentifier(column))
      .join(", ");
    const parameters = entries.map(([, value]) => bind(value)).join(", ");
    await routeDatabase.query(
      `INSERT INTO ${quoteIdentifier(this.table)} (${columns}) VALUES (${parameters})`,
      values,
    );
    return { data: null, error: null };
  }
}

function sqlBackedServiceClient() {
  return {
    from: (table: string) => new SqlTableQuery(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (!routeDatabase) throw new Error("route database used before setup");

      if (name === "publish_staging_content_atomic") {
        const result = await routeDatabase.query(
          "SELECT * FROM publish_staging_content_atomic($1, $2, $3, $4)",
          [
            args.p_site_id,
            args.p_element_ids,
            args.p_published_by,
            args.p_user_email,
          ],
        );
        return { data: result.rows, error: null };
      }
      if (name === "restore_content_version") {
        const result = await routeDatabase.query<{ restored: unknown }>(
          "SELECT restore_content_version($1, $2) AS restored",
          [args.p_version_id, args.p_restored_by],
        );
        return { data: result.rows[0].restored, error: null };
      }
      throw new Error(`Unexpected RPC in SQL route adapter: ${name}`);
    },
  };
}

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => sqlBackedServiceClient()),
}));

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: { id: "route-user", email: "owner@example.com" } },
      })),
    },
  })),
}));

jest.mock("@/lib/auth/editor-access", () => ({
  authorizeFirstPartyEditorAccess: jest.fn(async () => ({
    kind: "user",
    userId: null,
    email: "owner@example.com",
    permissions: ["view", "edit", "publish", "admin"],
    stagingAccessId: null,
  })),
  requireEditorPermission: jest.fn(() => true),
  validateEditorTokenFromRequest: jest.fn(),
}));

jest.mock("@/lib/security/site-auth", () => {
  const actual = jest.requireActual("@/lib/security/site-auth");
  return {
    ...actual,
    authorizeFirstPartySiteRequest: jest.fn(async () => ({
      allowedOrigin: "https://owner.example.com",
    })),
    authorizeSiteRequest: jest.fn(),
    authorizeSiteOrigin: jest.fn(),
  };
});

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(async () => null),
}));

jest.mock("@/lib/sites/site-status", () => ({
  markSiteLive: jest.fn(async () => undefined),
  recordSiteReport: jest.fn(async () => undefined),
}));

jest.mock("@/lib/auth/staging-access", () => ({
  StagingAccessManager: { validateStagingAccess: jest.fn() },
}));

jest.mock("@/lib/auth/staging-device", () => ({
  readStagingDeviceFingerprint: jest.fn(() => null),
}));

jest.mock("@/lib/webhooks/manager", () => ({
  WEBHOOK_EVENTS: { CONTENT_UPDATED: "content.updated" },
  webhookManager: { recordQualifyingEvent: jest.fn() },
}));

jest.mock("next/server", () => {
  class MockNextRequest {
    url: string;
    nextUrl: URL;
    method: string;
    headers: Headers;
    private readonly body?: string;

    constructor(
      url: string,
      init?: { method?: string; headers?: HeadersInit; body?: string },
    ) {
      this.url = url;
      this.nextUrl = new URL(url);
      this.method = init?.method ?? "GET";
      this.headers = new Headers(init?.headers);
      this.body = init?.body;
    }

    async json() {
      return JSON.parse(this.body ?? "{}");
    }
  }

  class MockNextResponse {
    status: number;
    headers: Headers;
    ok: boolean;

    constructor(
      private readonly value: unknown = null,
      init?: { status?: number },
    ) {
      this.status = init?.status ?? 200;
      this.headers = new Headers();
      this.ok = this.status >= 200 && this.status < 300;
    }

    static json(value: unknown, init?: { status?: number }) {
      return new MockNextResponse(value, init);
    }

    async json() {
      return this.value;
    }
  }

  return {
    NextRequest: MockNextRequest,
    NextResponse: MockNextResponse,
    after: jest.fn(),
  };
});

import { NextRequest } from "next/server";
import { PUT as putStagingContent } from "@/app/api/staging/content/[siteId]/route";
import { POST as publishStagingContent } from "@/app/api/staging/publish/route";
import { GET as getPublicContent } from "@/app/api/content/[siteId]/route";
import { POST as restoreContentVersion } from "@/app/api/edit-board/history/[versionId]/route";

const DB_URL = process.env.RCF_TEST_DB_URL;
const TEST_TIMEOUT_MS = 60_000;
const MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20260924010000_content_attributes_lifecycle.sql",
);

function validateScratchTarget(connectionString: string): URL {
  const target = new URL(connectionString);
  const isLoopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
    target.hostname,
  );

  if (target.protocol !== "postgresql:" && target.protocol !== "postgres:") {
    throw new Error("RCF_TEST_DB_URL must be a PostgreSQL URL");
  }
  if (!isLoopback) {
    throw new Error(
      `Refusing non-loopback RCF_TEST_DB_URL host: ${target.hostname}`,
    );
  }
  if (!target.port || target.port === "54322") {
    throw new Error(
      "RCF_TEST_DB_URL must name an explicit scratch port other than 54322",
    );
  }
  return target;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

if (!DB_URL) {
  describe("content attribute SQL lifecycle (s27 / A-26)", () => {
    test("[gated] RCF_TEST_DB_URL was not provided — SQL lifecycle not checked", () => {
      console.warn(
        "Set RCF_TEST_DB_URL to an explicit loopback scratch Postgres port to run this suite.",
      );
      expect(DB_URL).toBeUndefined();
    });
  });
} else {
  const adminTarget = validateScratchTarget(DB_URL);
  const databaseName = `rcf_s27_${process.pid}_${Date.now()}`;
  const databaseTarget = new URL(adminTarget.toString());
  databaseTarget.pathname = `/${databaseName}`;

  describe("content attribute SQL lifecycle (s27 / A-26)", () => {
    let admin: PgPool;
    let db: PgPool;
    let priorPublishEvidence: {
      returnedRows: number;
      metadata: Record<string, unknown>;
    };

    const query = <R = Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ): Promise<QueryResult<R>> => db.query<R>(sql, values);

    beforeAll(async () => {
      admin = new Pool({ connectionString: adminTarget.toString(), max: 1 });

      // Supabase supplies these roles. The scratch cluster is intentionally a
      // plain Postgres 16 instance, so create only the roles the migration's
      // ACL statements require. They are cluster-wide and harmless to reuse.
      await admin.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            CREATE ROLE anon NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            CREATE ROLE authenticated NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
            CREATE ROLE service_role NOLOGIN;
          END IF;
        END
        $$;
      `);
      await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);

      db = new Pool({ connectionString: databaseTarget.toString(), max: 4 });
      routeDatabase = db;
      await query(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;

        CREATE TABLE sites (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          domain TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE content_elements (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          element_id TEXT NOT NULL,
          selector TEXT NOT NULL,
          original_content TEXT,
          current_content TEXT,
          published_content TEXT,
          staging_content TEXT,
          staging_updated_at TIMESTAMPTZ,
          published_at TIMESTAMPTZ,
          published_by UUID,
          language TEXT DEFAULT 'en',
          variant TEXT DEFAULT 'default',
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now(),
          UNIQUE(site_id, element_id, language, variant)
        );

        CREATE TABLE staging_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          content_element_id UUID REFERENCES content_elements(id) ON DELETE CASCADE,
          staging_access_id UUID,
          previous_content TEXT,
          new_content TEXT,
          user_email TEXT NOT NULL,
          action TEXT CHECK (action IN ('create', 'update', 'publish', 'revert')) DEFAULT 'update',
          created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE content_versions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          version_number INT NOT NULL,
          snapshot JSONB NOT NULL,
          created_by TEXT,
          description TEXT,
          elements_changed INT DEFAULT 0,
          change_type TEXT CHECK (change_type IN ('manual', 'style_apply', 'language_switch', 'theme_apply', 'restore', 'bulk_edit')),
          created_at TIMESTAMPTZ DEFAULT now(),
          UNIQUE(site_id, version_number)
        );
      `);

      // RED evidence from the actual pre-s27 publish RPC. With unchanged text,
      // a pending href is ignored: the function returns no row and leaves the
      // draft nested instead of publishing it. Capture that behavior before the
      // forward migration replaces the function, then remove the fixture.
      await query(
        readFileSync(
          path.join(
            process.cwd(),
            "supabase/migrations/20260803020000_restore_atomic_publish.sql",
          ),
          "utf8",
        ),
      );
      const { rows: priorSites } = await query<{ id: string }>(
        "INSERT INTO sites (domain, name) VALUES ('s27-prior-rpc.invalid', 'prior RPC') RETURNING id",
      );
      const priorSiteId = priorSites[0].id;
      await query(
        `INSERT INTO content_elements
           (site_id, element_id, selector, original_content, current_content,
            published_content, staging_content, metadata)
         VALUES ($1, 'rcf-prior-link', 'a', 'Same', 'Same', 'Same', 'Same',
           '{"href":"/old","staging_attributes":{"href":"/new"}}'::jsonb)`,
        [priorSiteId],
      );
      const priorPublish = await query(
        "SELECT * FROM publish_staging_content_atomic($1, NULL, NULL, 'db-test')",
        [priorSiteId],
      );
      const { rows: priorRows } = await query<{
        metadata: Record<string, unknown>;
      }>("SELECT metadata FROM content_elements WHERE site_id = $1", [
        priorSiteId,
      ]);
      priorPublishEvidence = {
        returnedRows: priorPublish.rows.length,
        metadata: priorRows[0].metadata,
      };
      await query("DELETE FROM sites WHERE id = $1", [priorSiteId]);

      const migrationSql = readFileSync(MIGRATION, "utf8");
      await query(migrationSql);
      // The operator may need to replay a forward migration after a partially
      // failed deploy. The file promises idempotence, so execute that promise.
      await query(migrationSql);
    }, TEST_TIMEOUT_MS);

    afterAll(async () => {
      routeDatabase = undefined;
      if (db) await db.end();
      if (admin) {
        await admin.query(
          `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
        );
        await admin.end();
      }
    }, TEST_TIMEOUT_MS);

    async function seedElement(metadata: Record<string, unknown>): Promise<{
      siteId: string;
      rowId: string;
    }> {
      const { rows: sites } = await query<{ id: string }>(
        "INSERT INTO sites (domain, name) VALUES ($1, 's27 SQL lifecycle') RETURNING id",
        [`s27-${Date.now()}-${Math.random()}.invalid`],
      );
      const siteId = sites[0].id;
      const { rows } = await query<{ id: string }>(
        `INSERT INTO content_elements
           (site_id, element_id, selector, original_content, current_content,
            published_content, metadata)
         VALUES ($1, 'rcf-nav-link', 'nav a', 'Documentation', 'Documentation',
                 'Documentation', $2::jsonb)
         RETURNING id`,
        [siteId, JSON.stringify(metadata)],
      );
      return { siteId, rowId: rows[0].id };
    }

    async function stageAttributes(
      rowId: string,
      attributes: Record<string, string>,
    ): Promise<void> {
      const { rows } = await query<{
        previous_content: string | null;
        previous_metadata: Record<string, unknown>;
        new_metadata: Record<string, unknown>;
      }>(
        `UPDATE content_elements
            SET staging_content = published_content,
                staging_updated_at = now(),
                metadata = metadata || jsonb_build_object(
                  'staging_attributes',
                  COALESCE(metadata->'staging_attributes', '{}'::jsonb) || $2::jsonb
                ),
                updated_at = now()
          WHERE id = $1
        RETURNING published_content AS previous_content,
                  metadata - 'staging_attributes' AS previous_metadata,
                  metadata AS new_metadata`,
        [rowId, JSON.stringify(attributes)],
      );

      const staged = rows[0];
      await query(
        `INSERT INTO staging_history
           (content_element_id, previous_content, new_content, user_email,
            action, previous_metadata, new_metadata)
         VALUES ($1, $2, $2, 'db-test@example.com', 'update', $3, $4)`,
        [
          rowId,
          staged.previous_content,
          JSON.stringify(staged.previous_metadata),
          JSON.stringify(staged.new_metadata),
        ],
      );
    }

    async function snapshot(
      siteId: string,
      description: string,
    ): Promise<string> {
      const { rows } = await query<{ id: string }>(
        "SELECT create_content_version($1, 'db-test@example.com', $2, 'manual') AS id",
        [siteId, description],
      );
      return rows[0].id;
    }

    async function publish(siteId: string): Promise<void> {
      const { rows } = await query<{ element_id: string; content: string }>(
        `SELECT * FROM publish_staging_content_atomic(
          $1, NULL, NULL, 'db-test@example.com'
        )`,
        [siteId],
      );
      expect(rows).toEqual([
        { element_id: "rcf-nav-link", content: "Documentation" },
      ]);
    }

    async function publishedRow(siteId: string): Promise<{
      content: string;
      metadata: Record<string, unknown>;
    }> {
      // This is the storage projection consumed by the public content route:
      // published text plus published metadata, never staging_attributes.
      const { rows } = await query<{
        content: string;
        metadata: Record<string, unknown>;
      }>(
        `SELECT published_content AS content,
                metadata - 'staging_attributes' AS metadata
           FROM content_elements
          WHERE site_id = $1 AND element_id = 'rcf-nav-link'`,
        [siteId],
      );
      return rows[0];
    }

    test("the real migration is idempotent and adds metadata history columns", async () => {
      const { rows } = await query<{ column_name: string }>(`
        SELECT column_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'staging_history'
           AND column_name IN ('previous_metadata', 'new_metadata')
         ORDER BY column_name
      `);

      expect(rows.map((row) => row.column_name)).toEqual([
        "new_metadata",
        "previous_metadata",
      ]);
    });

    test("guard: the actual pre-s27 RPC drops an attribute-only publish", () => {
      expect(priorPublishEvidence).toEqual({
        returnedRows: 0,
        metadata: {
          href: "/old",
          staging_attributes: { href: "/new" },
        },
      });
    });

    test("save, attribute-only publish, fresh read, restore and republish preserve the full lifecycle", async () => {
      const original = {
        type: "a",
        analytics_key: "keep-me",
        href: "/docs",
        alt: "Original documentation link",
      };
      const { siteId, rowId } = await seedElement(original);
      const originalVersionId = await snapshot(siteId, "original attributes");

      await stageAttributes(rowId, {
        href: "https://docs.example.com/v2",
        alt: "Updated documentation link",
      });

      // Saving a draft does not leak it to a fresh visitor.
      expect(await publishedRow(siteId)).toEqual({
        content: "Documentation",
        metadata: original,
      });

      // Text is deliberately unchanged: this proves attribute-only publish.
      await publish(siteId);
      const edited = {
        type: "a",
        analytics_key: "keep-me",
        href: "https://docs.example.com/v2",
        alt: "Updated documentation link",
      };
      expect(await publishedRow(siteId)).toEqual({
        content: "Documentation",
        metadata: edited,
      });

      const { rows: publishHistory } = await query<{
        previous_metadata: Record<string, unknown>;
        new_metadata: Record<string, unknown>;
      }>(
        `SELECT previous_metadata, new_metadata
           FROM staging_history
          WHERE content_element_id = $1 AND action = 'publish'
          ORDER BY created_at`,
        [rowId],
      );
      expect(publishHistory).toHaveLength(1);
      expect(publishHistory[0]).toEqual({
        previous_metadata: original,
        new_metadata: edited,
      });

      await query("SELECT restore_content_version($1, 'db-test@example.com')", [
        originalVersionId,
      ]);

      // Restore is staged. A fresh visitor keeps seeing the current publish.
      expect(await publishedRow(siteId)).toEqual({
        content: "Documentation",
        metadata: edited,
      });
      const { rows: restoredDraft } = await query<{
        staging_attributes: Record<string, string>;
      }>(
        `SELECT metadata->'staging_attributes' AS staging_attributes
           FROM content_elements WHERE id = $1`,
        [rowId],
      );
      expect(restoredDraft[0].staging_attributes).toEqual({
        href: "/docs",
        alt: "Original documentation link",
      });

      // restore_content_version writes a pre-restore snapshot. It must retain
      // the value being replaced so the restore itself can be undone.
      const { rows: versions } = await query<{
        snapshot: Record<string, { attributes?: Record<string, string> }>;
      }>(
        `SELECT snapshot FROM content_versions
          WHERE site_id = $1 ORDER BY version_number DESC LIMIT 1`,
        [siteId],
      );
      expect(versions[0].snapshot["rcf-nav-link"].attributes).toEqual({
        href: "https://docs.example.com/v2",
        alt: "Updated documentation link",
      });

      await publish(siteId);
      expect(await publishedRow(siteId)).toEqual({
        content: "Documentation",
        metadata: original,
      });

      const { rows: historyAfterRestore } = await query<{
        previous_metadata: Record<string, unknown>;
        new_metadata: Record<string, unknown>;
      }>(
        `SELECT previous_metadata, new_metadata
           FROM staging_history
          WHERE content_element_id = $1 AND action = 'publish'
          ORDER BY created_at`,
        [rowId],
      );
      expect(historyAfterRestore).toHaveLength(2);
      expect(historyAfterRestore[1]).toEqual({
        previous_metadata: edited,
        new_metadata: original,
      });
    });

    test("actual save, publish, visitor read and restore routes share the SQL attribute lifecycle", async () => {
      const original = {
        type: "a",
        analytics_key: "route-kept",
        href: "/route-original",
        alt: "Route original alt",
      };
      const { siteId } = await seedElement(original);
      const originalVersionId = await snapshot(siteId, "route original");

      const saveResponse = await putStagingContent(
        new NextRequest(
          `https://owner.example.com/api/staging/content/${siteId}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              elementId: "rcf-nav-link",
              content: "Documentation",
              href: "https://route.example.com/new",
              alt: "Route updated alt",
            }),
          },
        ),
        { params: Promise.resolve({ siteId }) },
      );
      expect(saveResponse.status).toBe(200);

      const visitorRequest = () =>
        new NextRequest(`https://owner.example.com/api/content/${siteId}`);
      const readVisitor = async () => {
        const response = await getPublicContent(visitorRequest(), {
          params: Promise.resolve({ siteId }),
        });
        expect(response.status).toBe(200);
        return (await response.json()) as Array<{
          current_content: string;
          metadata: Record<string, unknown>;
        }>;
      };

      // The real public GET strips the pending patch before publish.
      expect(await readVisitor()).toEqual([
        expect.objectContaining({
          current_content: "Documentation",
          metadata: original,
        }),
      ]);

      const publishRequest = () =>
        new NextRequest("https://owner.example.com/api/staging/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ siteId }),
        });
      const firstPublish = await publishStagingContent(publishRequest());
      expect(firstPublish.status).toBe(200);

      const edited = {
        type: "a",
        analytics_key: "route-kept",
        href: "https://route.example.com/new",
        alt: "Route updated alt",
      };
      expect(await readVisitor()).toEqual([
        expect.objectContaining({
          current_content: "Documentation",
          metadata: edited,
        }),
      ]);

      const restoreResponse = await restoreContentVersion(
        new NextRequest(
          `https://owner.example.com/api/edit-board/history/${originalVersionId}`,
          { method: "POST" },
        ),
        { params: Promise.resolve({ versionId: originalVersionId }) },
      );
      expect(restoreResponse.status).toBe(200);

      // Restore is deliberately staged; a visitor sees the last publish until
      // the second real publish route promotes it.
      expect(await readVisitor()).toEqual([
        expect.objectContaining({ metadata: edited }),
      ]);

      const restoredPublish = await publishStagingContent(publishRequest());
      expect(restoredPublish.status).toBe(200);
      expect(await readVisitor()).toEqual([
        expect.objectContaining({ metadata: original }),
      ]);
    });

    test("a new snapshot with no href/alt clears later additions without losing unrelated metadata", async () => {
      const { siteId, rowId } = await seedElement({
        type: "a",
        analytics_key: "keep-me",
      });
      const emptyVersionId = await snapshot(siteId, "no authored attributes");

      await stageAttributes(rowId, {
        href: "/later",
        alt: "Added later",
      });
      await publish(siteId);
      await query("SELECT restore_content_version($1, 'db-test@example.com')", [
        emptyVersionId,
      ]);

      const { rows } = await query<{
        staging_attributes: Record<string, string>;
      }>(
        `SELECT metadata->'staging_attributes' AS staging_attributes
           FROM content_elements WHERE id = $1`,
        [rowId],
      );
      expect(rows[0].staging_attributes).toEqual({ href: "", alt: "" });

      await publish(siteId);
      expect(await publishedRow(siteId)).toEqual({
        content: "Documentation",
        metadata: {
          type: "a",
          analytics_key: "keep-me",
          href: "",
          alt: "",
        },
      });
    });

    test("a legacy snapshot without an attributes property preserves current href and alt", async () => {
      const { siteId, rowId } = await seedElement({
        type: "a",
        analytics_key: "keep-me",
        href: "/current",
        alt: "Current alt",
      });
      const { rows: inserted } = await query<{ id: string }>(
        `INSERT INTO content_versions
           (site_id, version_number, snapshot, created_by, description,
            elements_changed, change_type)
         VALUES ($1, 1,
           jsonb_build_object('rcf-nav-link', jsonb_build_object(
             'content', 'Legacy text', 'elementType', 'a', 'selector', 'nav a'
           )),
           'legacy', 'pre-s27 snapshot', 1, 'manual')
         RETURNING id`,
        [siteId],
      );

      await query("SELECT restore_content_version($1, 'db-test@example.com')", [
        inserted[0].id,
      ]);
      const { rows } = await query<{
        staging_attributes: Record<string, string> | null;
        metadata: Record<string, unknown>;
      }>(
        `SELECT metadata->'staging_attributes' AS staging_attributes, metadata
           FROM content_elements WHERE id = $1`,
        [rowId],
      );

      expect(rows[0].staging_attributes).toBeNull();
      expect(rows[0].metadata).toMatchObject({
        analytics_key: "keep-me",
        href: "/current",
        alt: "Current alt",
      });
    });

    test.each([
      "publish_staging_content_atomic(uuid,text[],uuid,text)",
      "create_content_version(uuid,text,text,text)",
      "restore_content_version(uuid,text)",
      "revert_staging_content(uuid,uuid[])",
    ])("%s is executable only by service_role", async (identity) => {
      const { rows } = await query<{
        public_exec: boolean;
        anon_exec: boolean;
        authenticated_exec: boolean;
        service_exec: boolean;
      }>(
        `SELECT has_function_privilege('public', $1, 'EXECUTE') AS public_exec,
                has_function_privilege('anon', $1, 'EXECUTE') AS anon_exec,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated_exec,
                has_function_privilege('service_role', $1, 'EXECUTE') AS service_exec`,
        [identity],
      );

      expect(rows[0]).toEqual({
        public_exec: false,
        anon_exec: false,
        authenticated_exec: false,
        service_exec: true,
      });
    });
  });
}
