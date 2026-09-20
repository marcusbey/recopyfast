import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  assertLocalMutationTargets,
  assertMutatingRunEnabled,
} from "./local-targets";

type MutatingFlag = "RUN_RECOPYFAST_CORE_E2E" | "RUN_RECOPYFAST_PARITY";

export function createLocalServiceRoleClient(
  flagName: MutatingFlag,
): SupabaseClient {
  assertMutatingRunEnabled(flagName);
  const targets = assertLocalMutationTargets();

  return createClient(
    targets.supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function deleteExactRows(
  client: SupabaseClient,
  table: string,
  column: string,
  value: string,
): Promise<void> {
  const { error } = await client.from(table).delete().eq(column, value);
  if (error) throw error;
}

/**
 * Both mutating specs create a fresh UUID for every run. Before s24 the parity
 * cleanup deleted every site whose domain matched `e2e-parity-%.invalid`, which
 * meant one run could erase another concurrent run's fixture. Cleanup is now
 * deliberately boring and exact: only the UUID captured by this process and
 * its known children are touched. The final site delete owns cascade cleanup
 * for any widget-created child we did not have to know about.
 */
export async function deleteCapturedSiteFixture(
  client: SupabaseClient,
  siteId: string,
): Promise<void> {
  await deleteExactRows(client, "staging_access", "site_id", siteId);
  await deleteExactRows(client, "edit_sessions", "site_id", siteId);
  await deleteExactRows(client, "content_elements", "site_id", siteId);
  await deleteExactRows(client, "sites", "id", siteId);
}
