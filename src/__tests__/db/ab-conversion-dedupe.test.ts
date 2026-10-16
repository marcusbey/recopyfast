/**
 * s69a — conversion deduplication is atomic at the database boundary.
 *
 * The track route used to read for an existing conversion and insert later.
 * Two requests could both observe zero and both insert, so a Jest mock of the
 * route cannot prove this fix: the race has to run through PostgreSQL's unique
 * index and the same RPC the service-role client calls.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describeDb } from "./db-harness";

const MIGRATION_FILE = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
  "20261012121000_atomic_ab_conversion_dedupe.sql",
);
const MIGRATION = readFileSync(MIGRATION_FILE, "utf8");

const FUNCTION_IDENTITY = "public.insert_ab_test_events(jsonb)";
const UNIQUE_INDEX = "ab_test_results_one_conversion_per_visitor";

interface PgClientLike {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

interface InsertedEvent {
  id: string;
  test_id: string;
  variant_id: string;
  visitor_id: string;
  event_type: "view" | "click" | "conversion";
}

interface Fixture {
  testId: string;
  variantId: string;
}

function event(
  fixture: Fixture,
  eventType: InsertedEvent["event_type"],
  visitorId: string,
) {
  return {
    test_id: fixture.testId,
    variant_id: fixture.variantId,
    visitor_id: visitorId,
    session_id: null,
    event_type: eventType,
    value: 1,
    metadata: eventType === "conversion" ? { event_name: "signup" } : {},
    geo_country: null,
    geo_region: null,
  };
}

async function createFixture(
  query: <R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: R[]; rowCount: number | null }>,
  siteId: string,
): Promise<Fixture> {
  const { rows: tests } = await query<{ id: string }>(
    `INSERT INTO public.ab_tests (site_id, name, status)
     VALUES ($1, 's69a atomic conversion test', 'active')
     RETURNING id`,
    [siteId],
  );
  const { rows: variants } = await query<{ id: string }>(
    `INSERT INTO public.ab_test_variants (test_id, name, content_changes, is_control)
     VALUES ($1, 'control', '{}'::jsonb, true)
     RETURNING id`,
    [tests[0].id],
  );
  return { testId: tests[0].id, variantId: variants[0].id };
}

async function callInsert(
  client: PgClientLike,
  events: Array<Record<string, unknown>>,
): Promise<InsertedEvent[]> {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE service_role");
    const { rows } = await client.query<InsertedEvent>(
      `SELECT * FROM ${FUNCTION_IDENTITY.split("(")[0]}($1::jsonb)`,
      [JSON.stringify(events)],
    );
    await client.query("COMMIT");
    return rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function sqlState(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

async function waitForBlockedInsert(
  query: <R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: R[]; rowCount: number | null }>,
  backendPid: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { rows } = await query<{
      wait_event_type: string | null;
      wait_event: string | null;
    }>(
      `SELECT wait_event_type, wait_event
       FROM pg_stat_activity
       WHERE pid = $1`,
      [backendPid],
    );
    if (rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("concurrent A/B insert never waited on the migration lock");
}

describeDb(
  "s69a — atomic A/B conversion dedupe",
  ({ query, withClient, createSite }) => {
    let fixture: Fixture;

    beforeAll(async () => {
      fixture = await createFixture(
        query,
        await createSite("s69a-conversions"),
      );
    });

    test("two concurrent conversion calls return and store exactly one row", async () => {
      const visitorId = `s69a-race-${randomUUID()}`;
      const payload = [event(fixture, "conversion", visitorId)];

      const [first, second] = await Promise.all([
        withClient((client) => callInsert(client, payload)),
        withClient((client) => callInsert(client, payload)),
      ]);

      expect(first.length + second.length).toBe(1);
      const { rows } = await query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM public.ab_test_results
         WHERE test_id = $1 AND visitor_id = $2 AND event_type = 'conversion'`,
        [fixture.testId, visitorId],
      );
      expect(rows[0].count).toBe("1");
    });

    test("a conversion conflict does not lose valid events, while clicks and views stay repeatable", async () => {
      const visitorId = `s69a-mixed-${randomUUID()}`;
      const payload = [
        event(fixture, "conversion", visitorId),
        event(fixture, "click", visitorId),
        event(fixture, "view", visitorId),
      ];

      const first = await withClient((client) => callInsert(client, payload));
      const second = await withClient((client) => callInsert(client, payload));

      expect(first.map((row) => row.event_type).sort()).toEqual([
        "click",
        "conversion",
        "view",
      ]);
      expect(second.map((row) => row.event_type).sort()).toEqual([
        "click",
        "view",
      ]);

      const { rows } = await query<{ event_type: string; count: string }>(
        `SELECT event_type, count(*)::text AS count
         FROM public.ab_test_results
         WHERE test_id = $1 AND visitor_id = $2
         GROUP BY event_type
         ORDER BY event_type`,
        [fixture.testId, visitorId],
      );
      expect(rows).toEqual([
        { event_type: "click", count: "2" },
        { event_type: "conversion", count: "1" },
        { event_type: "view", count: "2" },
      ]);
    });

    test("the RPC refuses an empty or over-50 batch before writing", async () => {
      const tooMany = Array.from({ length: 51 }, (_, index) =>
        event(fixture, "click", `s69a-bound-${index}-${randomUUID()}`),
      );

      await withClient(async (client) => {
        expect(await sqlState(() => callInsert(client, []))).toBe("22023");
        expect(await sqlState(() => callInsert(client, tooMany))).toBe("22023");
      });

      const { rows } = await query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM public.ab_test_results
         WHERE visitor_id LIKE 's69a-bound-%'`,
      );
      expect(rows[0].count).toBe("0");
    });

    test("the RPC is invoker-only, pins search_path, and only service_role may execute it", async () => {
      const { rows } = await query<{
        is_definer: boolean;
        config: string[];
        public_execute: boolean;
        anon_execute: boolean;
        authenticated_execute: boolean;
        service_execute: boolean;
      }>(
        `SELECT p.prosecdef AS is_definer,
                COALESCE(p.proconfig, ARRAY[]::text[]) AS config,
                has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
                has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
         FROM pg_proc p
         WHERE p.oid = $1::regprocedure`,
        [FUNCTION_IDENTITY],
      );

      expect(rows[0]).toEqual(
        expect.objectContaining({
          is_definer: false,
          public_execute: false,
          anon_execute: false,
          authenticated_execute: false,
          service_execute: true,
        }),
      );
      expect(rows[0].config).toContain("search_path=public, pg_temp");
    });

    test.each(["anon", "authenticated"])(
      "%s cannot call the event insert RPC",
      async (role) => {
        await withClient(async (client) => {
          await client.query("BEGIN");
          try {
            await client.query(`SET LOCAL ROLE ${role}`);
            expect(
              await sqlState(() =>
                client.query(
                  `SELECT * FROM ${FUNCTION_IDENTITY.split("(")[0]}($1::jsonb)`,
                  [JSON.stringify([event(fixture, "click", randomUUID())])],
                ),
              ),
            ).toBe("42501");
          } finally {
            await client.query("ROLLBACK");
          }
        });
      },
    );

    test("migration lock blocks a concurrent result insert until the migration transaction ends", async () => {
      const lockSql = MIGRATION.match(
        /LOCK TABLE public\.ab_test_results IN SHARE ROW EXCLUSIVE MODE;/,
      )?.[0];
      expect(lockSql).toBeDefined();

      await withClient(async (migrationClient) => {
        await withClient(async (writerClient) => {
          let migrationOpen = false;
          let writerOpen = false;
          let insertPromise: Promise<unknown> | null = null;
          try {
            await migrationClient.query("BEGIN");
            migrationOpen = true;
            await migrationClient.query(lockSql!);

            await writerClient.query("BEGIN");
            writerOpen = true;
            const { rows: backends } = await writerClient.query<{
              pid: number;
            }>("SELECT pg_backend_pid() AS pid");
            insertPromise = writerClient.query(
              `INSERT INTO public.ab_test_results
                 (test_id, variant_id, visitor_id, event_type)
               VALUES ($1, $2, $3, 'click')`,
              [fixture.testId, fixture.variantId, `s69a-lock-${randomUUID()}`],
            );

            await waitForBlockedInsert(query, backends[0].pid);

            let insertSettled = false;
            void insertPromise.then(
              () => {
                insertSettled = true;
              },
              () => {
                insertSettled = true;
              },
            );
            expect(insertSettled).toBe(false);

            await migrationClient.query("COMMIT");
            migrationOpen = false;
            await insertPromise;
            await writerClient.query("ROLLBACK");
            writerOpen = false;
          } finally {
            if (migrationOpen) await migrationClient.query("ROLLBACK");
            if (insertPromise) await insertPromise.catch(() => undefined);
            if (writerOpen) await writerClient.query("ROLLBACK");
          }
        });
      });
    });

    test("migration cleanup keeps earliest recorded_at then id and recreates the unique index", async () => {
      const visitorId = `s69a-history-${randomUUID()}`;
      const survivor = "11111111-1111-4111-8111-111111111111";

      await withClient(async (client) => {
        await client.query("BEGIN");
        try {
          await client.query(`DROP INDEX public.${UNIQUE_INDEX}`);
          await client.query(
            `INSERT INTO public.ab_test_results
               (id, test_id, variant_id, visitor_id, event_type, recorded_at)
             VALUES
               ('33333333-3333-4333-8333-333333333333', $1, $2, $3, 'conversion', '2026-10-12T12:00:01Z'),
               ('22222222-2222-4222-8222-222222222222', $1, $2, $3, 'conversion', '2026-10-12T12:00:00Z'),
               ($4, $1, $2, $3, 'conversion', '2026-10-12T12:00:00Z')`,
            [fixture.testId, fixture.variantId, visitorId, survivor],
          );

          await client.query(MIGRATION);

          const { rows } = await client.query<{ id: string }>(
            `SELECT id::text AS id
             FROM public.ab_test_results
             WHERE test_id = $1 AND visitor_id = $2 AND event_type = 'conversion'`,
            [fixture.testId, visitorId],
          );
          expect(rows).toEqual([{ id: survivor }]);

          const { rows: indexes } = await client.query<{ unique: boolean }>(
            `SELECT i.indisunique AS unique
             FROM pg_index i
             WHERE i.indexrelid = $1::regclass`,
            [`public.${UNIQUE_INDEX}`],
          );
          expect(indexes).toEqual([{ unique: true }]);
        } finally {
          await client.query("ROLLBACK");
        }
      });
    });
  },
);
