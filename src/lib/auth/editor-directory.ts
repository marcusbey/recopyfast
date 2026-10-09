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

export interface SiteEditorActivation {
  editor: SiteEditor;
  didActivate: boolean;
}

export class EditorActivationUnavailableError extends Error {
  readonly code = "ACTIVATION_RPC_UNAVAILABLE";

  constructor() {
    super("activate_site_editor is unavailable");
    this.name = "EditorActivationUnavailableError";
  }
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
 * The WHATWG HTML "valid e-mail address" with a dotted domain whose last label
 * has two characters or more, at most 254 characters. The character set and
 * the label shape are the ones Supabase Auth applies to its own users
 * (docs/research/s72-edit-board-history-xss.md, "Supabase Auth"): no `<`, `>`,
 * `"`, whitespace or non-ASCII.
 */
const EMAIL_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])$/;

/**
 * Practical email validation. Deliberately not RFC 5322 — the address only has
 * to be deliverable, and the emailed code is the real check on whether it is
 * the right one.
 *
 * TOMBSTONE (s72). The rule was `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`: anything
 * but whitespace around an `@`. It accepted `<svg/onload=alert(1)>@x.co` — no
 * whitespace needed — and quoted local parts, empty and hyphen-led labels and
 * non-ASCII. A site admin chooses the addresses of staging invites and site
 * editors, a staging invite's address becomes a version's `created_by`, and the
 * embed's History tab rendered that as markup on the customer's origin (s70a
 * review F1). The embed renders it as text now; this rule keeps the address an
 * address, for every route that calls it: staging invites, adding an editor,
 * requesting and submitting a code. Length is checked first, so the pattern
 * never runs on an unbounded string.
 */
export function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
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

  // Throw, never `[]`. An empty list is a statement — "this address edits
  // nothing" — and the hub renders it as "No sites yet … ask the site owner".
  // s39 made /edit read this on every load, so a transient Supabase error
  // told real editors they had been removed (s39 review M1). Every caller
  // (sites, submit-code, request-code) already turns a throw into a 500, and a
  // failed read fails the same way for known and unknown addresses, so
  // request-code's no-oracle rule holds.
  if (error) {
    console.error("[editor-directory] site list failed:", error.message);
    throw new Error(`[editor-directory] site list failed: ${error.message}`);
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
 * Atomically add, restore, or update an editor and report whether access moved
 * from inactive to active in this transaction.
 *
 * Email delivery must key off `didActivate`, never a lookup performed before
 * this call. Two simultaneous requests can both observe no active row, and the
 * old lookup also deliberately returns null on database errors. The RPC
 * serializes the site/address pair so only the transaction that inserts or
 * restores the row earns the invitation send.
 */
export async function activateSiteEditor(params: {
  siteId: string;
  email: string;
  permissions: EditorPermission[];
  invitedBy: string | null;
}): Promise<SiteEditorActivation | null> {
  const supabase = createServiceRoleClient();
  const email = normalizeEmail(params.email);
  const permissions = normalizePermissions(params.permissions);

  if (permissions.length === 0) {
    console.error(
      "[editor-directory] refusing to activate an empty permission set",
    );
    return null;
  }

  const { data, error } = await supabase
    .rpc("activate_site_editor", {
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
      did_activate: boolean;
    }>();

  if (error?.code === "PGRST202" || error?.code === "42883") {
    // The application route depends on the additive migration. Treat a missing
    // function as a release-order failure with a stable signal so the route can
    // fail closed and tell operators what must happen before deployment.
    throw new EditorActivationUnavailableError();
  }

  if (error) {
    console.error("[editor-directory] activation failed:", error.message);
    return null;
  }

  return {
    editor: {
      id: data.id,
      siteId: data.site_id,
      email: data.email,
      permissions: normalizePermissions(data.permissions),
      createdAt: new Date(data.created_at),
    },
    didActivate: data.did_activate,
  };
}

/**
 * Revoke an editor and, in the same breath, every device grant beneath them
 * and every staging invite to their address on that site.
 *
 * The grant sweep is the point. Marking the editor revoked alone would leave
 * live grants that stop working only at their own expiry, which is up to seven
 * days of access after the owner clicked "remove". Validation re-checks the
 * parent row on every call as a second line of defence, so an interrupted sweep
 * still fails closed — but the sweep is what makes existing sessions die now.
 *
 * The invite sweep (s76, s69 R4) is the same idea for `staging_access`. Every
 * staging validator already refuses an address with a revoked directory row
 * (s68c, `isEditorRevoked`), so it is not load-bearing for access; it is what
 * makes the dashboard, and the table, stop calling those invites live. Read
 * before the update so a retry — clicking remove again after an interrupted
 * sweep — still finds the editor's site and address and finishes the job.
 */
export async function revokeSiteEditor(params: {
  siteEditorId: string;
}): Promise<{
  revoked: boolean;
  grantsKilled: number;
  stagingInvitesRevoked: number;
}> {
  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();

  const { data: editor, error: readError } = await supabase
    .from("site_editors")
    .select("site_id, email")
    .eq("id", params.siteEditorId)
    .maybeSingle<{ site_id: string; email: string | null }>();

  if (readError) {
    // Not fatal: revoking the row below is what denies access. Only the
    // invite sweep needs the address, and it is skipped.
    console.error(
      "[editor-directory] editor read before revoke failed:",
      readError.message,
    );
  }

  const { error: editorError } = await supabase
    .from("site_editors")
    .update({ revoked_at: now })
    .eq("id", params.siteEditorId)
    .is("revoked_at", null);

  if (editorError) {
    console.error("[editor-directory] revoke failed:", editorError.message);
    return { revoked: false, grantsKilled: 0, stagingInvitesRevoked: 0 };
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

  const stagingInvitesRevoked =
    editor?.site_id && editor.email
      ? await revokeStagingInvites(editor.site_id, editor.email, now)
      : 0;

  return { revoked: true, grantsKilled, stagingInvitesRevoked };
}

/**
 * Rows asked for per read of a site's invites: PostgREST's `max_rows`
 * (supabase/config.toml). The sweep advances by the rows actually returned,
 * so a server that caps lower still reads every row, just in more requests.
 */
const INVITE_PAGE_SIZE = 1000;

/**
 * Invite ids per update. They travel in the URL (`id=in.(…)`), about 40
 * bytes each once encoded: a hundred stays near 4 KB, under the 8 KB request
 * line common proxies allow.
 */
const INVITE_UPDATE_BATCH = 100;

/**
 * Deactivate the active `staging_access` invites to one address on one site.
 * Best effort, like the grant sweep: logs and reports what landed (0 when
 * nothing did).
 *
 * Matched in code with `normalizeEmail`, never with a PostgREST `ilike`:
 * `staging_access.email` keeps the case it was typed in, and in a LIKE pattern
 * `_` and `%` are wildcards — `bob_x@…` would match, and end, `bobzx@…`'s
 * access. Nor `imatch`: a regex would not reproduce `normalizeEmail`'s trim
 * and case rule exactly, and an over-match ends somebody else's access.
 *
 * TOMBSTONE (s76 Devin fix pass). The read was one request, and PostgREST
 * caps every response at `max_rows`: on a site with more active invites than
 * that, an invite past the first page was never read and stayed active. Every
 * page is read first, in a total order (the primary key), until an empty
 * page; only then is anything written, so the sweep's own updates never
 * shift a later page.
 */
async function revokeStagingInvites(
  siteId: string,
  email: string,
  now: string,
): Promise<number> {
  const ids = await readStagingInviteIds(siteId, normalizeEmail(email));
  if (!ids) return 0;

  const supabase = createServiceRoleClient();
  let revoked = 0;

  for (let start = 0; start < ids.length; start += INVITE_UPDATE_BATCH) {
    const { data, error } = await supabase
      .from("staging_access")
      .update({ is_active: false, revoked_at: now })
      .in("id", ids.slice(start, start + INVITE_UPDATE_BATCH))
      // The ids come from a site-scoped read; the fence keeps it so.
      .eq("site_id", siteId)
      .eq("is_active", true)
      .select("id");

    if (error) {
      console.error("[editor-directory] invite sweep failed:", error.message);
      return revoked;
    }
    revoked += data?.length ?? 0;
  }

  return revoked;
}

/**
 * The ids of the site's active invites to `address`, every page read; null
 * when a read fails (nothing is written then).
 */
async function readStagingInviteIds(
  siteId: string,
  address: string,
): Promise<string[] | null> {
  const supabase = createServiceRoleClient();
  const ids: string[] = [];

  for (let offset = 0; ; ) {
    const { data, error } = await supabase
      .from("staging_access")
      .select("id, email")
      .eq("site_id", siteId)
      .eq("is_active", true)
      .order("id")
      .range(offset, offset + INVITE_PAGE_SIZE - 1);

    if (error) {
      console.error("[editor-directory] invite read failed:", error.message);
      return null;
    }

    const page = (data ?? []) as Array<{ id: string; email: string | null }>;
    if (page.length === 0) return ids;

    for (const invite of page) {
      if (
        typeof invite.email === "string" &&
        normalizeEmail(invite.email) === address
      ) {
        ids.push(invite.id);
      }
    }
    offset += page.length;
  }
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
