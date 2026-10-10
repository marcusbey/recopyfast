/** Real PostgreSQL ownership/commit proof for ADR060; never calls a provider. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDailyDraft } from "@/lib/blog/drafts";
import { describeDb } from "./db-harness";

interface SqlClient {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

const RPC_ARGUMENTS: Record<string, string[]> = {
  claim_daily_blog_generation: ["p_generated_on", "p_owner_token"],
  complete_daily_blog_generation: [
    "p_generated_on",
    "p_owner_token",
    "p_title",
    "p_slug",
    "p_content",
    "p_excerpt",
    "p_category",
  ],
  fail_daily_blog_generation: ["p_generated_on", "p_owner_token"],
};

// Only adapts the Supabase wire shape; all ownership, reads and writes execute
// the real migration functions in separate PostgreSQL sessions. row_to_json
// preserves PostgREST's date strings rather than node-postgres Date objects.
function database(client: SqlClient, onClaim?: () => void): SupabaseClient {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      const keys = RPC_ARGUMENTS[name];
      if (!keys) throw new Error(`Unexpected test RPC: ${name}`);
      const placeholders = keys.map((_, index) => `$${index + 1}`).join(",");
      try {
        const { rows } = await client.query(
          name === "fail_daily_blog_generation"
            ? `SELECT public.${name}(${placeholders}) AS data`
            : `SELECT row_to_json(result) AS data FROM public.${name}(${placeholders}) AS result`,
          keys.map((key) => args[key]),
        );
        if (name === "claim_daily_blog_generation") onClaim?.();
        return {
          data:
            name === "fail_daily_blog_generation"
              ? rows[0].data
              : rows.map((row) => row.data),
          error: null,
        };
      } catch (error) {
        return { data: null, error };
      }
    },
    from(table: string) {
      if (!["blog_posts", "blog_generation_claims"].includes(table))
        throw new Error("Unexpected read table");
      let projection = "";
      let column = "";
      let value: unknown;
      const query = {
        select(columns: string) {
          if (!/^[a-z_, ]+$/.test(columns))
            throw new Error("Unsafe test projection");
          projection = columns;
          return query;
        },
        eq(key: string, input: unknown) {
          if (!["generated_on", "id"].includes(key))
            throw new Error("Unexpected read key");
          column = key;
          value = input;
          return query;
        },
        async maybeSingle() {
          const { rows } = await client.query(
            `SELECT row_to_json(result) AS data FROM (SELECT ${projection} FROM public.${table} WHERE ${column}=$1) AS result`,
            [value],
          );
          if (rows.length > 1) throw new Error("Expected at most one row");
          return { data: rows[0]?.data ?? null, error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const DAY = "2050-01-03";

describeDb("s89: durable generation claim", ({ withClient }) => {
  test("two service-role sessions call the generator once and return the same draft", async () => {
    await withClient(async (leader) =>
      withClient(async (follower) => {
        const started = deferred();
        const release = deferred();
        const followerClaimed = deferred();
        const generate = jest.fn(async () => {
          started.resolve();
          await release.promise;
          return `# Claim fixture ${randomUUID()}\n\nSynthetic content only.`;
        });
        const runs: Array<Promise<unknown>> = [];
        try {
          await leader.query("SET ROLE service_role");
          await follower.query("SET ROLE service_role");
          const first = createDailyDraft({
            db: database(leader),
            now: new Date(`${DAY}T12:00:00Z`),
            generate,
          });
          runs.push(first);
          await Promise.race([
            started.promise,
            first.then(() => {
              throw new Error("Leader finished without entering generation");
            }),
          ]);
          const second = createDailyDraft({
            db: database(follower, followerClaimed.resolve),
            now: new Date(`${DAY}T12:00:00Z`),
            generate,
            followerWaitMs: 2000,
            followerPollMs: 10,
          });
          runs.push(second);
          await Promise.race([
            followerClaimed.promise,
            second.then(() => {
              throw new Error("Follower finished without reading its claim");
            }),
          ]);
          expect(generate).toHaveBeenCalledTimes(1);
          release.resolve();
          const [created, repeated] = await Promise.all([first, second]);
          expect(created.created).toBe(true);
          expect(repeated.created).toBe(false);
          expect(repeated.draft.id).toBe(created.draft.id);
          expect(repeated.draft.status).toBe("draft");
          expect(repeated.draft.published_at).toBeNull();
          expect(generate).toHaveBeenCalledTimes(1);
        } finally {
          release.resolve();
          await Promise.allSettled(runs);
          await leader.query("RESET ROLE");
          await follower.query("RESET ROLE");
          await leader.query(
            "DELETE FROM blog_generation_claims WHERE generated_on=$1",
            [DAY],
          );
          await leader.query("DELETE FROM blog_posts WHERE generated_on=$1", [
            DAY,
          ]);
        }
      }),
    );
  }, 15_000);

  test("a completion error rolls back the inserted post and claim update together", async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const token = randomUUID();
        await client.query("SELECT * FROM claim_daily_blog_generation($1,$2)", [
          DAY,
          token,
        ]);
        await client.query(
          `CREATE FUNCTION pg_temp.reject_claim_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic completion failure'; END $$`,
        );
        await client.query(
          `CREATE TRIGGER reject_claim_completion BEFORE UPDATE ON blog_generation_claims FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_claim_completion()`,
        );
        await client.query("SAVEPOINT before_completion");
        await expect(
          client.query(
            "SELECT * FROM complete_daily_blog_generation($1,$2,$3,$4,$5,$6,$7)",
            [
              DAY,
              token,
              "Fixture",
              `fixture-${token}`,
              "Body",
              "Excerpt",
              "development",
            ],
          ),
        ).rejects.toThrow("synthetic completion failure");
        await client.query("ROLLBACK TO SAVEPOINT before_completion");
        expect(
          (
            await client.query(
              "SELECT status,post_id FROM blog_generation_claims WHERE generated_on=$1",
              [DAY],
            )
          ).rows,
        ).toEqual([{ status: "pending", post_id: null }]);
        expect(
          (
            await client.query(
              "SELECT id FROM blog_posts WHERE generated_on=$1",
              [DAY],
            )
          ).rows,
        ).toEqual([]);
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });

  test("failed and old pending claims cannot be automatically reclaimed", async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const token = randomUUID();
        await client.query("SELECT * FROM claim_daily_blog_generation($1,$2)", [
          DAY,
          token,
        ]);
        await client.query(
          "UPDATE blog_generation_claims SET created_at=now()-interval '1 year' WHERE generated_on=$1",
          [DAY],
        );
        const pending = await client.query(
          "SELECT * FROM claim_daily_blog_generation($1,$2)",
          [DAY, randomUUID()],
        );
        expect(pending.rows[0]).toMatchObject({
          outcome: "existing",
          claim_status: "pending",
        });
        expect(
          (
            await client.query(
              "SELECT fail_daily_blog_generation($1,$2) AS failed",
              [DAY, randomUUID()],
            )
          ).rows[0].failed,
        ).toBe(false);
        expect(
          (
            await client.query(
              "SELECT fail_daily_blog_generation($1,$2) AS failed",
              [DAY, token],
            )
          ).rows[0].failed,
        ).toBe(true);
        const failed = await client.query(
          "SELECT * FROM claim_daily_blog_generation($1,$2)",
          [DAY, randomUUID()],
        );
        expect(failed.rows[0]).toMatchObject({
          outcome: "existing",
          claim_status: "failed",
        });
        expect(
          (
            await client.query(
              "SELECT id FROM blog_posts WHERE generated_on=$1",
              [DAY],
            )
          ).rows,
        ).toEqual([]);
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });

  test("replay retains completed claims, removes stale column grants and reuses a legacy post", async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const token = randomUUID();
        await client.query("SELECT * FROM claim_daily_blog_generation($1,$2)", [
          DAY,
          token,
        ]);
        await client.query("SAVEPOINT wrong_owner");
        await expect(
          client.query(
            "SELECT * FROM complete_daily_blog_generation($1,$2,$3,$4,$5,$6,$7)",
            [
              DAY,
              randomUUID(),
              "Fixture",
              `fixture-${token}`,
              "Body",
              "Excerpt",
              "development",
            ],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await client.query("ROLLBACK TO SAVEPOINT wrong_owner");
        const completed = await client.query(
          "SELECT * FROM complete_daily_blog_generation($1,$2,$3,$4,$5,$6,$7)",
          [
            DAY,
            token,
            "Fixture",
            `fixture-${token}`,
            "Body",
            "Excerpt",
            "development",
          ],
        );
        const before = await client.query(
          "SELECT row_to_json(claim) AS data FROM blog_generation_claims claim WHERE generated_on=$1",
          [DAY],
        );
        // Table REVOKE alone must not leave an old column ACL readable via PUBLIC.
        await client.query(
          "GRANT SELECT(owner_token) ON blog_generation_claims TO PUBLIC",
        );
        await client.query(
          readFileSync(
            path.join(
              process.cwd(),
              "supabase/migrations/20261010120000_blog_generation_claims.sql",
            ),
            "utf8",
          ),
        );
        expect(
          (
            await client.query(
              "SELECT row_to_json(claim) AS data FROM blog_generation_claims claim WHERE generated_on=$1",
              [DAY],
            )
          ).rows,
        ).toEqual(before.rows);
        for (const role of ["anon", "authenticated"]) {
          expect(
            (
              await client.query(
                "SELECT has_column_privilege($1,'public.blog_generation_claims','owner_token','SELECT') AS permitted",
                [role],
              )
            ).rows[0].permitted,
          ).toBe(false);
        }
        await client.query(
          "DELETE FROM blog_generation_claims WHERE generated_on=$1",
          [DAY],
        );
        const legacy = await client.query(
          "SELECT * FROM claim_daily_blog_generation($1,$2)",
          [DAY, randomUUID()],
        );
        expect(legacy.rows[0]).toMatchObject({
          outcome: "existing",
          claim_status: "succeeded",
          post_id: completed.rows[0].id,
        });
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });

  test("claims and RPCs are private to the service role, with RLS enabled", async () => {
    await withClient(async (client) => {
      expect(
        (
          await client.query(
            "SELECT relrowsecurity FROM pg_class WHERE oid='public.blog_generation_claims'::regclass",
          )
        ).rows[0].relrowsecurity,
      ).toBe(true);
      for (const role of ["anon", "authenticated"]) {
        const table = await client.query(
          "SELECT has_table_privilege($1,'public.blog_generation_claims','SELECT,INSERT,UPDATE,DELETE') AS permitted",
          [role],
        );
        expect(table.rows[0].permitted).toBe(false);
      }
      for (const signature of [
        "claim_daily_blog_generation(date,uuid)",
        "complete_daily_blog_generation(date,uuid,text,text,text,text,text)",
        "fail_daily_blog_generation(date,uuid)",
      ]) {
        for (const role of ["anon", "authenticated", "service_role"]) {
          expect(
            (
              await client.query(
                "SELECT has_function_privilege($1,$2,'EXECUTE') AS permitted",
                [role, signature],
              )
            ).rows[0].permitted,
          ).toBe(role === "service_role");
        }
      }
    });
  });
});
