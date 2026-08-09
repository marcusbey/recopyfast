/**
 * Resolving `auth.users` identities from application code.
 *
 * PostgREST only serves the schemas it is configured to expose, and `auth` is
 * not one of them. So neither `.from("auth.users")` nor an embed of the form
 * `user:auth.users!some_fkey(email, raw_user_meta_data)` can ever resolve — they
 * are not slow or partial queries, they are a hard PGRST200 "could not find a
 * relationship" that fails the whole select. Every handler that wanted a
 * member's email that way answered 500 to every caller.
 *
 * The Admin API is the supported route to that table, and it needs the
 * service-role key — hence the dedicated client. This module exists so the fix
 * lives in one place: `sites/[siteId]/share/route.ts` had already worked it out
 * privately while five Teams handlers still shipped the broken embed.
 *
 * Reading identities with the service role does not widen access. The caller has
 * already been authorised against the row it is decorating, and the only fields
 * exposed are the display identity the feature is about.
 */

import { createServiceRoleClient } from "@/lib/supabase/service";

export interface UserIdentity {
  email: string;
  name: string;
}

/**
 * One user's email and display name, or null when the id resolves to nothing.
 *
 * Null is a real answer, not only an error: a row may point at a deleted user.
 * Callers must render around that rather than failing the whole response.
 */
export async function resolveUserIdentity(
  userId: string,
): Promise<UserIdentity | null> {
  const service = createServiceRoleClient();
  const { data, error } = await service.auth.admin.getUserById(userId);

  if (error || !data?.user?.email) {
    if (error) {
      console.error("Error resolving target user:", error.message);
    }
    return null;
  }

  const metadata = data.user.user_metadata as
    | Record<string, unknown>
    | undefined;
  const name = typeof metadata?.name === "string" ? metadata.name : null;

  return { email: data.user.email, name: name ?? data.user.email };
}

/**
 * Identities for a set of ids, keyed by id. Unresolvable ids are absent from the
 * map rather than present-and-null, so `map.get(id) ?? null` is the whole
 * caller-side contract.
 *
 * One request per distinct id: the Admin API has no batch-by-id call. The lists
 * this decorates are a team's members, a site's permission rows and a page of
 * activity — all small and already bounded by the query that produced them. If
 * one ever is not, the answer is a `profiles` table in `public`, not a wider
 * query here.
 */
export async function resolveUserIdentities(
  userIds: readonly (string | null | undefined)[],
): Promise<Map<string, UserIdentity>> {
  const distinct = Array.from(
    new Set(
      userIds.filter((id): id is string => typeof id === "string" && !!id),
    ),
  );

  const identities = new Map<string, UserIdentity>();

  for (const userId of distinct) {
    const identity = await resolveUserIdentity(userId);
    if (identity) {
      identities.set(userId, identity);
    } else {
      console.warn(`Could not resolve the identity of user ${userId}`);
    }
  }

  return identities;
}

/**
 * Attach `user`/`inviter` identities to a list of rows.
 *
 * Kept generic over the key so the members, activity and invitation lists share
 * one implementation — they differ only in which column holds the id and what
 * the decorated field is called.
 */
export async function attachUserIdentities<
  Row extends Record<string, unknown>,
  Field extends string,
>(
  rows: readonly Row[],
  idColumn: keyof Row & string,
  field: Field,
): Promise<Array<Row & { [K in Field]: UserIdentity | null }>> {
  const identities = await resolveUserIdentities(
    rows.map((row) => row[idColumn] as string | null | undefined),
  );

  return rows.map((row) => {
    const id = row[idColumn];
    return {
      ...row,
      [field]: typeof id === "string" ? (identities.get(id) ?? null) : null,
    } as Row & { [K in Field]: UserIdentity | null };
  });
}
