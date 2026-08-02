/**
 * The durable half of editor access: who is allowed to edit which site.
 *
 * Nothing here proves identity — that is `editor-verification` and
 * `editor-grants`. This module answers only "is this address on the allowlist,
 * and with what permissions", which is the question a site owner controls from
 * the dashboard and which survives across devices, sessions and code entries.
 */

import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  normalizePermissions,
  type EditorPermission,
} from "@/lib/auth/editor-access";
import { revokeAllGrantsForEditor } from "@/lib/auth/editor-grants";

export interface SiteEditor {
  id: string;
  siteId: string;
  email: string;
  permissions: EditorPermission[];
  createdAt: Date;
}

export interface EditorSiteSummary {
  siteEditorId: string;
  siteId: string;
  siteName: string;
  siteDomain: string;
  permissions: EditorPermission[];
}

/** Single place that decides what "the same person" means. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Practical email validation. Deliberately not RFC 5322 — the address only has
 * to be deliverable, and the emailed code is the real check on whether it is
 * the right one.
 */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

/**
 * Look up a live editor row. Returns null for unknown addresses AND for revoked
 * ones — callers must not be able to tell those apart, because the difference
 * leaks whether an address was ever an editor of the site.
 */
export async function findActiveSiteEditor(
  siteId: string,
  email: string,
): Promise<SiteEditor | null> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("site_editors")
    .select("id, site_id, email, permissions, created_at")
    .eq("site_id", siteId)
    .eq("email", normalizeEmail(email))
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    console.error("[editor-directory] lookup failed:", error.message);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id,
    siteId: data.site_id,
    email: data.email,
    permissions: normalizePermissions(data.permissions),
    createdAt: new Date(data.created_at),
  };
}

/** The hub's cold-start answer: every site this address may edit. */
export async function listSitesForEditor(
  email: string,
): Promise<EditorSiteSummary[]> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("site_editors")
    .select("id, site_id, permissions, sites!inner(id, name, domain)")
    .eq("email", normalizeEmail(email))
    .is("revoked_at", null);

  if (error) {
    console.error("[editor-directory] site list failed:", error.message);
    return [];
  }

  type Row = {
    id: string;
    site_id: string;
    permissions: string[] | null;
    sites: { id: string; name: string; domain: string } | null;
  };

  return ((data ?? []) as unknown as Row[])
    .filter((row) => row.sites !== null)
    .map((row) => ({
      siteEditorId: row.id,
      siteId: row.site_id,
      siteName: row.sites!.name,
      siteDomain: row.sites!.domain,
      permissions: normalizePermissions(row.permissions),
    }))
    .sort((a, b) => a.siteName.localeCompare(b.siteName));
}

/**
 * Add or restore an editor.
 *
 * Re-inviting someone who was revoked clears `revoked_at` on the existing row
 * rather than creating a second one — the unique index on (site_id,
 * lower(email)) guarantees the question "is this person an editor" never has two
 * answers. Their old device grants stay revoked: re-authorisation restores the
 * standing permission, not the proof of identity, so they verify again.
 */
export async function upsertSiteEditor(params: {
  siteId: string;
  email: string;
  permissions: EditorPermission[];
  invitedBy: string | null;
}): Promise<SiteEditor | null> {
  const supabase = createServiceRoleClient();
  const email = normalizeEmail(params.email);
  const permissions = normalizePermissions(params.permissions);

  if (permissions.length === 0) {
    console.error(
      "[editor-directory] refusing to grant an empty permission set",
    );
    return null;
  }

  // Via RPC rather than PostgREST upsert: the uniqueness is over
  // (site_id, lower(email)), an expression index that `onConflict` cannot name.
  const { data, error } = await supabase
    .rpc("upsert_site_editor", {
      p_site_id: params.siteId,
      p_email: email,
      p_permissions: permissions,
      p_invited_by: params.invitedBy,
    })
    .single<{
      id: string;
      site_id: string;
      email: string;
      permissions: string[] | null;
      created_at: string;
    }>();

  if (error) {
    console.error("[editor-directory] upsert failed:", error.message);
    return null;
  }

  return {
    id: data.id,
    siteId: data.site_id,
    email: data.email,
    permissions: normalizePermissions(data.permissions),
    createdAt: new Date(data.created_at),
  };
}

/**
 * Revoke an editor and, in the same breath, every device grant beneath them.
 *
 * The grant sweep is the point. Marking the editor revoked alone would leave
 * live grants that stop working only at their own expiry, which is up to seven
 * days of access after the owner clicked "remove". Validation re-checks the
 * parent row on every call as a second line of defence, so an interrupted sweep
 * still fails closed — but the sweep is what makes existing sessions die now.
 */
export async function revokeSiteEditor(params: {
  siteEditorId: string;
}): Promise<{ revoked: boolean; grantsKilled: number }> {
  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();

  const { error: editorError } = await supabase
    .from("site_editors")
    .update({ revoked_at: now })
    .eq("id", params.siteEditorId)
    .is("revoked_at", null);

  if (editorError) {
    console.error("[editor-directory] revoke failed:", editorError.message);
    return { revoked: false, grantsKilled: 0 };
  }

  // Delegated rather than repeated inline: this is the same sweep
  // `revokeAllGrantsForEditor` performs, and keeping one implementation means
  // "remove an editor" and an operator-initiated sign-out cannot drift apart.
  // It logs its own failures and reports 0 when the sweep does not land — the
  // editor is revoked either way, so access is already denied; the leftover rows
  // only mislead the dashboard's device count.
  const grantsKilled = await revokeAllGrantsForEditor(
    params.siteEditorId,
    "editor_revoked",
  );

  return { revoked: true, grantsKilled };
}

/** Editors of a site, for the dashboard. Includes revoked rows for audit. */
export async function listSiteEditors(
  siteId: string,
): Promise<
  Array<SiteEditor & { revokedAt: Date | null; activeDevices: number }>
> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("site_editors")
    .select("id, site_id, email, permissions, created_at, revoked_at")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[editor-directory] list failed:", error.message);
    return [];
  }

  const editorIds = (data ?? []).map((row) => row.id);
  const deviceCounts = new Map<string, number>();

  if (editorIds.length > 0) {
    const { data: grants } = await supabase
      .from("editor_device_grants")
      .select("site_editor_id")
      .in("site_editor_id", editorIds)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString());

    for (const grant of grants ?? []) {
      deviceCounts.set(
        grant.site_editor_id,
        (deviceCounts.get(grant.site_editor_id) ?? 0) + 1,
      );
    }
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    siteId: row.site_id,
    email: row.email,
    permissions: normalizePermissions(row.permissions),
    createdAt: new Date(row.created_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    activeDevices: deviceCounts.get(row.id) ?? 0,
  }));
}
