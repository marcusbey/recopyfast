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

type ActivationOutcome =
  | { ok: true; didActivate: boolean }
  | { ok: false; error: unknown };

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

  async function activateWithClient(client: PgClient, email: string) {
    const { rows } = await client.query<{ did_activate: boolean }>(
      `SELECT did_activate
         FROM public.activate_site_editor($1, $2, $3, $4)`,
      [siteId, email, ["view", "edit"], inviterId],
    );
    return rows[0].did_activate;
  }

  async function waitForDatabaseLock(backendPid: number) {
    const deadline = Date.now() + 5_000;

    while (Date.now() < deadline) {
      const { rows } = await pool.query<{
        wait_event_type: string | null;
        wait_event: string | null;
      }>(
        `SELECT wait_event_type, wait_event
           FROM pg_stat_activity
          WHERE pid = $1`,
        [backendPid],
      );

      if (rows[0]?.wait_event_type === "Lock") return rows[0].wait_event;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(
      `Timed out waiting for PostgreSQL backend ${backendPid} to block`,
    );
  }

  async function activateWithForcedOverlap(email: string) {
    const firstClient = new Client({
      connectionString: databaseConnectionString,
    });
    const secondClient = new Client({
      connectionString: databaseConnectionString,
    });
    let firstTransactionOpen = false;
    let secondActivation: Promise<ActivationOutcome> | null = null;

    await Promise.all([firstClient.connect(), secondClient.connect()]);
    try {
      await firstClient.query("BEGIN");
      firstTransactionOpen = true;
      const firstDidActivate = await activateWithClient(firstClient, email);
      const { rows: backendRows } = await secondClient.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );

      // Keep the first activation uncommitted while the second one enters the
      // function. Pool scheduling used to serialize these calls before they
      // overlapped, so deleting the advisory lock still left the test green.
      // PostgreSQL exposes the exact lock class being awaited: the committed
      // function must block here on `advisory`; without it the insert path
      // reaches the unique index and waits on a transaction id instead.
      secondActivation = activateWithClient(secondClient, email).then(
        (didActivate): ActivationOutcome => ({ ok: true, didActivate }),
        (error: unknown): ActivationOutcome => ({ ok: false, error }),
      );
      expect(await waitForDatabaseLock(backendRows[0].pid)).toBe("advisory");

      await firstClient.query("COMMIT");
      firstTransactionOpen = false;
      const secondOutcome = await secondActivation;
      if (!secondOutcome.ok) throw secondOutcome.error;

      return [firstDidActivate, secondOutcome.didActivate];
    } finally {
      if (firstTransactionOpen) {
        await firstClient.query("ROLLBACK").catch(() => undefined);
      }
      if (secondActivation) await secondActivation;
      await Promise.all([firstClient.end(), secondClient.end()]);
    }
  }

  it("reports one activation across concurrent enrol and restore calls", async () => {
    const first = await activateWithForcedOverlap("editor@example.com");
    expect(first.sort()).toEqual([false, true]);

    expect(await activate("editor@example.com")).toBe(false);

    await pool.query(
      "UPDATE public.site_editors SET revoked_at = NOW() WHERE site_id = $1 AND email = $2",
      [siteId, "editor@example.com"],
    );
    const restored = await activateWithForcedOverlap("editor@example.com");
    expect(restored.sort()).toEqual([false, true]);
  }, 15_000);

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
