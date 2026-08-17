/**
 * Authorization for webhook configuration.
 *
 * The same `site_permissions` lookup was copy-pasted five times across
 * `src/app/api/webhooks/route.ts` (once per verb) and
 * `src/app/api/webhooks/test/route.ts`. Five copies of a permission check is
 * four opportunities for one of them to drift — and the one that drifts is the
 * one nobody reads.
 *
 * Site ownership is an `admin` row in `site_permissions`, never a column on
 * `sites`: counting via `sites.user_id` returns 0 and passes every check, a bug
 * that has already shipped in this codebase.
 */

import type { createClient } from "@/lib/supabase/server";

type UserScopedClient = Awaited<ReturnType<typeof createClient>>;

/** Permission levels that may configure a site's webhooks. */
const WEBHOOK_WRITE_PERMISSIONS = ["edit", "admin"];

export async function requireWebhookSitePermission(
  supabase: UserScopedClient,
  siteId: string,
  userId: string,
): Promise<boolean> {
  const { data: permission } = await supabase
    .from("site_permissions")
    .select("permission")
    .eq("site_id", siteId)
    .eq("user_id", userId)
    .single();

  return Boolean(
    permission &&
      typeof permission.permission === "string" &&
      WEBHOOK_WRITE_PERMISSIONS.includes(permission.permission),
  );
}
