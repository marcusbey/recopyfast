/** @jest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

interface QueryResult<R> {
  rows: R[];
}

interface PgPool {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
  end(): Promise<void>;
}

interface PgPoolConstructor {
  new (config: { connectionString: string; max: number }): PgPool;
}

interface PgClient {
  connect(): Promise<void>;
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
  end(): Promise<void>;
}

interface PgClientConstructor {
  new (config: { connectionString: string }): PgClient;
}

// The repository intentionally has no @types/pg; match the established DB
// harness and load it through a structural type.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client, Pool } = require("pg") as {
  Client: PgClientConstructor;
  Pool: PgPoolConstructor;
};

const bootstrapConnectionString = process.env.RCF_S29_DB_URL;
const bootstrapUrl = bootstrapConnectionString
  ? new URL(bootstrapConnectionString)
  : null;
const isLoopback =
  bootstrapUrl?.hostname === "127.0.0.1" ||
  bootstrapUrl?.hostname === "localhost";
const migration = readFileSync(
  path.resolve(
    __dirname,
    "../../../supabase/migrations/20260924000000_atomic_editor_activation.sql",
  ),
  "utf8",
);

const describeWithDatabase = isLoopback ? describe : describe.skip;

describeWithDatabase("atomic editor activation migration", () => {
  let bootstrapPool: PgPool;
  let pool: PgPool;
  let databaseConnectionString: string;
  const databaseName = `recopyfast_s29_test_${process.pid}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const siteId = "11111111-1111-4111-8111-111111111111";
  const inviterId = "22222222-2222-4222-8222-222222222222";

  beforeAll(async () => {
    // Never apply fixture DDL to the supplied database. The environment value
    // is only a loopback bootstrap connection; this suite creates, owns, and
    // later drops a uniquely named disposable database.
    bootstrapPool = new Pool({
      connectionString: bootstrapConnectionString!,
      max: 1,
    });
    await bootstrapPool.query(`CREATE DATABASE ${databaseName}`);

    const databaseUrl = new URL(bootstrapConnectionString!);
    databaseUrl.pathname = `/${databaseName}`;
    databaseConnectionString = databaseUrl.toString();
    pool = new Pool({ connectionString: databaseConnectionString, max: 8 });
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS public.sites (id UUID PRIMARY KEY, name TEXT, domain TEXT);
      CREATE TABLE IF NOT EXISTS public.site_editors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        permissions TEXT[] NOT NULL DEFAULT ARRAY['edit']::TEXT[],
        invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_site_editors_site_email_unique
        ON public.site_editors(site_id, lower(email));
      ALTER TABLE public.site_editors ENABLE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT, UPDATE ON public.site_editors TO service_role;
      CREATE POLICY "Service role can manage site editors fixture"
        ON public.site_editors
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
      INSERT INTO auth.users (id) VALUES ('${inviterId}') ON CONFLICT DO NOTHING;
      INSERT INTO public.sites (id, name, domain)
        VALUES ('${siteId}', 'Concurrency fixture', 'fixture.invalid')
        ON CONFLICT DO NOTHING;
    `);

    // A forward migration must remain safe when a deploy retries after losing
    // its acknowledgement. Applying it twice proves the CREATE/ACL sequence is
    // idempotent against a real PostgreSQL parser and catalogue.
    await pool.query(migration);
    await pool.query(migration);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (bootstrapPool) {
      await bootstrapPool.query(`DROP DATABASE IF EXISTS ${databaseName}`);
      await bootstrapPool.end();
    }
  });

  async function activate(email: string) {
    const { rows } = await pool.query<{ did_activate: boolean }>(
      `SELECT did_activate
         FROM public.activate_site_editor($1, $2, $3, $4)`,
      [siteId, email, ["view", "edit"], inviterId],
    );
    return rows[0].did_activate;
  }

  it("reports one activation across concurrent enrol and restore calls", async () => {
    const first = await Promise.all([
      activate("editor@example.com"),
      activate("editor@example.com"),
    ]);
    expect(first.sort()).toEqual([false, true]);

    expect(await activate("editor@example.com")).toBe(false);

    await pool.query(
      "UPDATE public.site_editors SET revoked_at = NOW() WHERE site_id = $1 AND email = $2",
      [siteId, "editor@example.com"],
    );
    const restored = await Promise.all([
      activate("editor@example.com"),
      activate("editor@example.com"),
    ]);
    expect(restored.sort()).toEqual([false, true]);
  });

  it("exposes the RPC only to the service role", async () => {
    const { rows } = await pool.query<{
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(`
      SELECT
        has_function_privilege('anon', 'public.activate_site_editor(uuid,text,text[],uuid)', 'EXECUTE') AS anon,
        has_function_privilege('authenticated', 'public.activate_site_editor(uuid,text,text[],uuid)', 'EXECUTE') AS authenticated,
        has_function_privilege('service_role', 'public.activate_site_editor(uuid,text,text[],uuid)', 'EXECUTE') AS service_role
    `);

    expect(rows[0]).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
    });

    for (const refusedRole of ["anon", "authenticated"]) {
      const client = new Client({ connectionString: databaseConnectionString });
      await client.connect();
      try {
        await client.query(`SET ROLE ${refusedRole}`);
        await expect(
          client.query(
            "SELECT * FROM public.activate_site_editor($1, $2, $3, $4)",
            [siteId, `${refusedRole}@example.com`, ["edit"], inviterId],
          ),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await client.end();
      }
    }

    const serviceClient = new Client({
      connectionString: databaseConnectionString,
    });
    await serviceClient.connect();
    try {
      await serviceClient.query("SET ROLE service_role");
      const serviceResult = await serviceClient.query<{
        did_activate: boolean;
      }>(
        "SELECT did_activate FROM public.activate_site_editor($1, $2, $3, $4)",
        [siteId, "service-role@example.com", ["edit"], inviterId],
      );
      expect(serviceResult.rows[0].did_activate).toBe(true);
    } finally {
      await serviceClient.end();
    }
  });
});

if (!isLoopback) {
  test("[gated] set a loopback RCF_S29_DB_URL to verify atomic editor activation", () => {
    expect(isLoopback).not.toBe(true);
  });
}
