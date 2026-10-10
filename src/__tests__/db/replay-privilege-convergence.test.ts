/**
 * @jest-environment node
 */

/**
 * s68a — a replayed database converges on production's privileges (M9, H2).
 *
 * WHAT BROKE (M9). `20260731008000_rls_policies_for_locked_tables.sql` aborted
 * in production, so its write policies never existed there — but every
 * database REPLAYED from `supabase/migrations` (local, CI, a branch database, a
 * disaster recovery) has them, and three are self-escalations, reproduced on a
 * fresh replay on 2026-10-08 with role-switched SQL:
 *
 *   - "Team managers can add members" lets ANY signed-in user insert
 *     themselves as `owner` of any team (`user_id = auth.uid() OR …`).
 *   - "Invitees and managers can update invitations"
 *     (20260801200000:956-968, also live in production, inert there) lets an
 *     invitee rewrite their own invitation to `role = 'manager'` on another
 *     team.
 *   - "Site admins can update site permissions" lets a collaborator `admin`
 *     run an unscoped `UPDATE site_permissions SET granted_by = <self>` and
 *     stamp the creator's row — erasing the `granted_by IS NULL` creator
 *     marker that 20260813140000 and the share route rely on.
 *
 * 20261008110000_converge_replay_privileges.sql drops those policies (and the
 * other replay-only member writes beside them) and recreates the invitation
 * UPDATE for managers and owners only.
 *
 * WHAT IT ALSO ASSERTS (H2). The same migration carries the
 * `function-grants.test.ts` invariant as an apply-time postcondition, so a
 * production push aborts if a SECURITY DEFINER function is executable by
 * PUBLIC/anon or by `authenticated` outside the three RLS predicates. The
 * negative control below runs that exact block — extracted from the file
 * between its marker comments — against a planted offender, so a block that
 * silently stopped matching cannot pass.
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
  "20261008110000_converge_replay_privileges.sql",
);

const POSTCONDITION_PATTERN =
  /-- BEGIN definer-grant postcondition\n([\s\S]*?)-- END definer-grant postcondition/;

interface PgClientLike {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

async function actAs(
  client: PgClientLike,
  userId: string,
  email?: string,
): Promise<void> {
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated", email }),
  ]);
}

/**
 * A refusal is either an error (42501: no privilege, or a row-level security
 * violation) or a statement that matched nothing. Both are acceptable; a write
 * that lands is not. The caller reads the row back either way.
 */
async function expectRefusedOrNoRows(
  client: PgClientLike,
  savepoint: string,
  sql: string,
  values: unknown[],
): Promise<void> {
  let outcome: { rowCount: number | null } | { code: unknown };
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    const result = await client.query(sql, values);
    outcome = { rowCount: result.rowCount };
  } catch (error) {
    outcome = { code: (error as { code?: unknown }).code };
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  }

  expect([{ rowCount: 0 }, { code: "42501" }]).toContainEqual(outcome);
}

describeDb(
  "s68a — replayed databases converge on production's privileges (M9, H2)",
  ({ query, withClient, createSite }) => {
    describe("role-switched, with real JWT claims", () => {
      const ids = {
        stranger: randomUUID(),
        invitee: randomUUID(),
        manager: randomUUID(),
        otherOwner: randomUUID(),
        creator: randomUUID(),
        collaborator: randomUUID(),
      };
      const inviteeEmail = `s68a-invitee-${ids.invitee}@example.invalid`;
      let teamId: string;
      let otherTeamId: string;
      let invitationId: string;
      let siteId: string;

      beforeAll(async () => {
        for (const [label, id] of Object.entries(ids)) {
          await query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
            id,
            id === ids.invitee
              ? inviteeEmail
              : `s68a-${label}-${id}@example.invalid`,
          ]);
        }
        const { rows: teams } = await query<{ id: string; slug: string }>(
          `INSERT INTO teams (name, slug, owner_id)
         VALUES ('s68a team', $1, $3), ('s68a other team', $2, $4)
         RETURNING id, slug`,
          [
            `s68a-team-${ids.manager}`,
            `s68a-other-${ids.otherOwner}`,
            ids.manager,
            ids.otherOwner,
          ],
        );
        teamId = teams.find((team) => team.slug.startsWith("s68a-team-"))!.id;
        otherTeamId = teams.find((team) =>
          team.slug.startsWith("s68a-other-"),
        )!.id;
        await query(
          `INSERT INTO team_members (team_id, user_id, role)
         VALUES ($1, $2, 'manager'), ($3, $4, 'owner')`,
          [teamId, ids.manager, otherTeamId, ids.otherOwner],
        );
        const {
          rows: [invitation],
        } = await query<{ id: string }>(
          `INSERT INTO team_invitations (team_id, inviter_id, email, role)
         VALUES ($1, $2, $3, 'viewer') RETURNING id`,
          [teamId, ids.manager, inviteeEmail],
        );
        invitationId = invitation.id;

        siteId = await createSite("s68a-creator-marker");
        await query(
          `INSERT INTO site_permissions (site_id, user_id, permission, granted_by)
         VALUES ($1, $2, 'admin', NULL), ($1, $3, 'admin', $2)`,
          [siteId, ids.creator, ids.collaborator],
        );
      });

      afterAll(async () => {
        await query("DELETE FROM teams WHERE id = ANY($1::uuid[])", [
          [teamId, otherTeamId].filter(Boolean),
        ]);
        await query("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [
          Object.values(ids),
        ]);
      });

      test("a stranger cannot insert themselves as owner of a team", async () => {
        await withClient(async (client) => {
          await client.query("BEGIN");
          try {
            await actAs(client, ids.stranger);
            await expect(
              client.query(
                "INSERT INTO public.team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')",
                [teamId, ids.stranger],
              ),
            ).rejects.toMatchObject({ code: "42501" });
          } finally {
            await client.query("ROLLBACK");
          }

          const { rows } = await query(
            "SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2",
            [teamId, ids.stranger],
          );
          expect(rows).toEqual([]);
        });
      });

      test("an invitee cannot rewrite their invitation to manager on another team", async () => {
        await withClient(async (client) => {
          await client.query("BEGIN");
          try {
            await actAs(client, ids.invitee, inviteeEmail);
            await expectRefusedOrNoRows(
              client,
              "invitee_rewrite",
              "UPDATE public.team_invitations SET role = 'manager', team_id = $1 WHERE id = $2",
              [otherTeamId, invitationId],
            );

            await client.query("RESET ROLE");
            const { rows } = await client.query(
              "SELECT team_id, role FROM public.team_invitations WHERE id = $1",
              [invitationId],
            );
            expect(rows).toEqual([{ team_id: teamId, role: "viewer" }]);
          } finally {
            await client.query("ROLLBACK");
          }
        });
      });

      test("guard: the team's manager still updates the invitation", async () => {
        await withClient(async (client) => {
          await client.query("BEGIN");
          try {
            await actAs(client, ids.manager);
            const updated = await client.query(
              "UPDATE public.team_invitations SET role = 'editor' WHERE id = $1",
              [invitationId],
            );

            expect(updated.rowCount).toBe(1);
          } finally {
            await client.query("ROLLBACK");
          }
        });
      });

      test("a collaborator admin's unscoped UPDATE cannot stamp the creator's row", async () => {
        await withClient(async (client) => {
          await client.query("BEGIN");
          try {
            await actAs(client, ids.collaborator);
            await expectRefusedOrNoRows(
              client,
              "stamp_creator",
              "UPDATE public.site_permissions SET granted_by = $1",
              [ids.collaborator],
            );

            await client.query("RESET ROLE");
            const { rows } = await client.query(
              "SELECT granted_by FROM public.site_permissions WHERE site_id = $1 AND user_id = $2",
              [siteId, ids.creator],
            );
            expect(rows).toEqual([{ granted_by: null }]);
          } finally {
            await client.query("ROLLBACK");
          }
        });
      });

      test("guard: the per-row revoke policy of 20260813140000 survives", async () => {
        const { rows } = await query<{ polname: string }>(`
        SELECT polname FROM pg_policy
        WHERE polrelid = 'public.site_permissions'::regclass AND polcmd = 'd'
      `);

        expect(rows.map((row) => row.polname)).toContain(
          "Site admins can revoke non-creator permissions",
        );
      });

      test("postcondition refuses a definer function executable by anon, naming it", async () => {
        const migrationSql = readFileSync(MIGRATION_FILE, "utf8");
        const postcondition = POSTCONDITION_PATTERN.exec(migrationSql)?.[1];
        expect(postcondition).toEqual(
          expect.stringContaining("RAISE EXCEPTION"),
        );

        await withClient(async (client) => {
          await client.query("BEGIN");
          try {
            await client.query(`
            CREATE FUNCTION public.s68a_planted_definer()
            RETURNS integer
            LANGUAGE sql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS 'SELECT 1'
          `);
            await client.query(
              "GRANT EXECUTE ON FUNCTION public.s68a_planted_definer() TO anon",
            );

            await expect(client.query(postcondition!)).rejects.toThrow(
              /s68a_planted_definer\(\) -> anon/,
            );
          } finally {
            await client.query("ROLLBACK");
          }
        });
      });
    });
  },
);
