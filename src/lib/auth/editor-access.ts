import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  StagingAccessManager,
  type StagingPermission,
} from "@/lib/auth/staging-access";
import {
  readStagingDeviceFingerprint,
  type StagingDeviceFingerprint,
} from "@/lib/auth/staging-device";
import type { DeviceContext } from "@/lib/auth/editor-grants";
import { readDeviceContext } from "@/lib/auth/editor-request";

export type EditorAccessKind = "staging" | "edit-session" | "device-grant";
export type EditorPermission = "view" | "edit" | "publish" | "admin";

/**
 * The one and only channel a device grant may arrive on.
 *
 * Header, never a URL parameter, never a body field. A grant authorises writes
 * to a customer's live page; put it in a URL and it is in browser history, in
 * the `Referer` sent to every third-party asset on that page, and in every
 * access log between here and there. The `staging_access` token still travels
 * in a hand-delivered URL, and migration `20260801100000_editor_access_2fa.sql`
 * exists precisely because that entry URL was deliberately made to carry no
 * secret — copying the older pattern here would reverse that decision.
 *
 * Also add it to `ALLOW_HEADERS` in `src/lib/http/public-cors.ts` if that ever
 * gets rewritten: a header the preflight does not allow is stripped by the
 * browser, which fails silently on every customer domain while passing every
 * server-side test.
 */
export const EDITOR_GRANT_HEADER = "X-RCF-Editor-Grant";

export interface EditorToken {
  kind: EditorAccessKind;
  token: string;
}

export interface EditorAccess {
  kind: EditorAccessKind;
  siteId: string;
  token: string;
  permissions: EditorPermission[];
  email?: string | null;
  userId?: string | null;
  expiresAt?: Date | null;
  verified?: boolean;
  stagingAccessId?: string | null;
  editSessionId?: string | null;
}

export interface EditorAccessValidation {
  valid: boolean;
  access?: EditorAccess;
  error?: string;
  status?: number;
  requiresEmail?: boolean;
  requiresVerification?: boolean;
}

type EditorTokenRequest = Pick<Request, "headers" | "url"> & {
  nextUrl?: {
    searchParams: URLSearchParams;
  };
};

const PERMISSION_ORDER: EditorPermission[] = [
  "view",
  "edit",
  "publish",
  "admin",
];

export function normalizePermissions(
  rawPermissions: readonly string[] | null | undefined,
): EditorPermission[] {
  const permissions = new Set<EditorPermission>();

  for (const rawPermission of rawPermissions || []) {
    if (PERMISSION_ORDER.includes(rawPermission as EditorPermission)) {
      permissions.add(rawPermission as EditorPermission);
    }
  }

  if (permissions.has("admin")) {
    permissions.add("publish");
    permissions.add("edit");
    permissions.add("view");
  }

  if (permissions.has("publish")) {
    permissions.add("edit");
    permissions.add("view");
  }

  if (permissions.has("edit")) {
    permissions.add("view");
  }

  return PERMISSION_ORDER.filter((permission) => permissions.has(permission));
}

export function requireEditorPermission(
  access: Pick<EditorAccess, "permissions">,
  permission: EditorPermission,
) {
  return normalizePermissions(access.permissions).includes(permission);
}

/**
 * The signed-in owner's (or collaborator's) access to a site, or null.
 *
 * The editor-token functions above model ONE caller: somebody who arrived
 * through an emailed invite and carries a token. That is the collaborator, and
 * it is not the owner. The owner is signed in, holds a `site_permissions` row
 * saying `admin`, and has no token at all — so on any route that only validated
 * tokens, the one person guaranteed to hold every right was the only person
 * refused.
 *
 * That asymmetry had already produced a visible split down the middle of the
 * core loop: `POST /api/staging/publish` grew its own inline session check and
 * let the owner publish, while `PUT /api/staging/content/[siteId]` never did,
 * so an owner could publish edits they had no way to make. The register records
 * the consequence as "the owner has no first-party editing surface".
 *
 * This is deliberately the same shape as the F-4 fix in
 * `src/lib/security/site-auth.ts`: authorise a first-party caller by session
 * plus a `site_permissions` row, never by Origin, and return null rather than
 * throwing so a route can fall through to the token path unchanged.
 *
 * Permissions are graded through `normalizePermissions`, the same function the
 * token path uses, so `admin` implies `publish` implies `edit` implies `view`
 * exactly once in this codebase rather than once per call site — the previous
 * hand-rolled check spelled it `["admin", "owner", "publish"]`, which quietly
 * invented an "owner" level that the permission model does not have.
 */
export async function authorizeFirstPartyEditorAccess(
  siteId: string,
  required: EditorPermission,
): Promise<EditorAccess | null> {
  // Imported lazily: this module is reached from routes that run before a
  // session exists, and `@/lib/supabase/server` touches next/headers.
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  // Read under the USER's client, not the service role. The row has to be
  // visible to its own owner for this to succeed, which is precisely the
  // property that silently failed when `site_permissions` had row-level
  // security enabled and no policy behind it (register F-2/F-3). Reading it
  // with the service role here would hide that regression from this path.
  const { data: permission } = await supabase
    .from("site_permissions")
    .select("permission")
    .eq("site_id", siteId)
    .eq("user_id", user.id)
    .maybeSingle<{ permission: string }>();

  if (!permission) {
    return null;
  }

  const access: EditorAccess = {
    kind: "edit-session",
    siteId,
    // First-party access is carried by the session cookie; there is no bearer
    // token to echo, and inventing one would imply a credential that can be
    // replayed.
    token: "",
    permissions: normalizePermissions([permission.permission]),
    email: user.email ?? null,
    userId: user.id,
    verified: true,
  };

  return requireEditorPermission(access, required) ? access : null;
}

export function extractEditorToken(
  request: EditorTokenRequest,
  body?: Record<string, unknown> | null,
): EditorToken | null {
  // Checked FIRST — before `rcf_token`, before `rcf_edit_token`, and before
  // `Authorization: Bearer`. That ordering is load-bearing, not cosmetic: the
  // widget already sends `Authorization: Bearer <SITE_TOKEN>` on the very same
  // content requests that now carry a grant (recopyfast.src.js
  // `hydrateStoredContent` and `startPolling`), and the Bearer branch below
  // reads its value as a STAGING token. Checking the grant later would send a
  // grant-carrying request down the staging validator and refuse it, with the
  // site token blamed for failing to prove something it never could.
  //
  // Read only from the header. A grant offered in the query string or the body
  // is ignored outright rather than accepted "just this once" — see
  // EDITOR_GRANT_HEADER.
  const deviceGrant = request.headers.get(EDITOR_GRANT_HEADER)?.trim();
  if (deviceGrant) {
    return { kind: "device-grant", token: deviceGrant };
  }

  const params =
    request.nextUrl?.searchParams ?? new URL(request.url).searchParams;
  const stagingToken =
    params.get("rcf_token") ||
    (typeof body?.rcf_token === "string" ? body.rcf_token : null) ||
    (typeof body?.stagingToken === "string" ? body.stagingToken : null) ||
    (typeof body?.token === "string" ? body.token : null);

  if (stagingToken) {
    return { kind: "staging", token: stagingToken };
  }

  const editToken =
    params.get("rcf_edit_token") ||
    (typeof body?.editToken === "string" ? body.editToken : null) ||
    (typeof body?.editSessionToken === "string" ? body.editSessionToken : null);

  if (editToken) {
    return { kind: "edit-session", token: editToken };
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return { kind: "staging", token: authHeader.substring(7) };
  }

  return null;
}

export async function validateEditorAccess({
  siteId,
  token,
  allowUnverified = false,
  device,
  deviceContext,
}: {
  siteId: string;
  token: EditorToken;
  allowUnverified?: boolean;
  /**
   * Fingerprint of the presenting browser. Required in practice for staging
   * tokens: a verified staging row is only honoured for the device that
   * verified it, so omitting this forces re-verification rather than granting
   * access. Ignored for edit-session tokens, which carry no device binding.
   */
  device?: StagingDeviceFingerprint;
  /**
   * Where the request says it came from, for a device grant.
   *
   * Deliberately a second, differently named parameter rather than a widening
   * of `device` above: they are different objects binding different things (a
   * staging fingerprint is a cookie-ish browser mark, this is an Origin plus a
   * User-Agent), and conflating them is how one would start standing in for the
   * other. Absent means refused — see `validateDeviceGrantAccess`.
   */
  deviceContext?: DeviceContext;
}): Promise<EditorAccessValidation> {
  if (token.kind === "device-grant") {
    return validateDeviceGrantAccess(siteId, token.token, deviceContext);
  }

  if (token.kind === "staging") {
    return validateStagingEditorAccess(
      siteId,
      token.token,
      allowUnverified,
      device,
    );
  }

  return validateEditSessionAccess(siteId, token.token);
}

/**
 * The device grant, as a principal on the content write path.
 *
 * FAIL CLOSED ON A MISSING DEVICE CONTEXT. This is the single most consequential
 * line in the module. A grant is only safe because it is pinned to the origin it
 * was minted on — that pin, inside `validateDeviceGrant`, is what makes a grant
 * copied out of someone's localStorage worthless on an attacker's page. The pin
 * needs an `Origin`, and `Origin` is optional on a `Request`. Defaulting it,
 * deriving it from the request URL, or "helpfully" skipping the check when it is
 * absent would each turn this credential into a permanent cross-site editing
 * token, minted with our name on it, redeemable from any page an attacker
 * controls, against a customer's live site.
 *
 * So: no context, no grant. Refused here, before any database read, because
 * there is nothing a lookup could tell us that would make an unpinnable grant
 * acceptable.
 *
 * The refusal reason is the same vocabulary `POST /api/editor/validate-grant`
 * already returns to the same caller (`origin_mismatch`, `expired`,
 * `editor_revoked`, …), so this leaks nothing new: the holder already knows
 * which token, origin and browser they used.
 */
async function validateDeviceGrantAccess(
  siteId: string,
  grant: string,
  deviceContext?: DeviceContext,
): Promise<EditorAccessValidation> {
  if (!deviceContext) {
    console.warn(
      `[editor-access] device grant refused for site ${siteId}: no usable Origin, so nothing to pin it to`,
    );
    return { valid: false, error: "origin_mismatch", status: 401 };
  }

  // Imported lazily, like `@/lib/supabase/server` above and for a sharper
  // reason: `editor-grants` imports `normalizePermissions` from this module, so
  // a static edge back the other way closes a require cycle, and whichever of
  // the two a route or a test happens to load first then decides whether the
  // other's top-level constants exist yet. That is not hypothetical — it failed
  // as "Cannot access 'EDITOR_GRANT_HEADER' before initialization" in a suite
  // that does `jest.requireActual` on this module. A dynamic import inside the
  // function body has no such ordering.
  const { validateDeviceGrant } = await import("@/lib/auth/editor-grants");

  const result = await validateDeviceGrant({
    grant,
    siteId,
    device: deviceContext,
  });

  if (!result.valid) {
    console.warn(
      `[editor-access] device grant refused (${result.reason}) for site ${siteId} from ${deviceContext.origin}`,
    );
    return { valid: false, error: result.reason, status: 401 };
  }

  return {
    valid: true,
    access: {
      kind: "device-grant",
      siteId,
      token: grant,
      // Graded from the parent `site_editors` row by `normalizePermissions` —
      // the single widening rule in this codebase, not a second one. Nothing
      // inside the token itself decides what its holder may do.
      permissions: result.grant.permissions,
      email: result.grant.email,
      expiresAt: result.grant.expiresAt,
      verified: true,
      // Null on purpose: this edit is not attributable to any staging invite,
      // and pointing it at one would misattribute the edit.
      stagingAccessId: null,
    },
  };
}

async function validateStagingEditorAccess(
  siteId: string,
  token: string,
  allowUnverified: boolean,
  device?: StagingDeviceFingerprint,
): Promise<EditorAccessValidation> {
  const result = await StagingAccessManager.validateStagingAccess(
    token,
    siteId,
    device,
  );

  if (!result.valid) {
    return {
      valid: false,
      error: result.error || "Invalid or expired staging token",
      status: 401,
    };
  }

  const permissions = normalizePermissions(result.permissions);

  if (!result.verified && !allowUnverified) {
    return {
      valid: false,
      error: result.requiresEmail
        ? "Email required for staging access"
        : "Email verification required",
      status: 401,
      requiresEmail: result.requiresEmail,
      requiresVerification: result.requiresVerification,
    };
  }

  const supabase = createServiceRoleClient();
  const { data: accessRecord } = await supabase
    .from("staging_access")
    .select("id")
    .eq("token", token)
    .eq("site_id", siteId)
    .single();

  return {
    valid: true,
    requiresEmail: result.requiresEmail,
    requiresVerification: result.requiresVerification,
    access: {
      kind: "staging",
      siteId,
      token,
      permissions,
      email: result.email,
      expiresAt: result.expiresAt,
      verified: result.verified,
      stagingAccessId: accessRecord?.id || null,
    },
  };
}

async function validateEditSessionAccess(
  siteId: string,
  token: string,
): Promise<EditorAccessValidation> {
  const supabase = createServiceRoleClient();

  const { data: session, error } = await supabase
    .from("edit_sessions")
    .select("*")
    .eq("token", token)
    .eq("site_id", siteId)
    .eq("is_active", true)
    .gte("expires_at", new Date().toISOString())
    .single();

  if (error || !session) {
    return {
      valid: false,
      error: "Invalid or expired edit session",
      status: 401,
    };
  }

  await supabase
    .from("edit_sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", session.id);

  return {
    valid: true,
    access: {
      kind: "edit-session",
      siteId,
      token,
      permissions: normalizePermissions(session.permissions),
      userId: session.user_id,
      expiresAt: new Date(session.expires_at),
      verified: true,
      editSessionId: session.id,
    },
  };
}

export async function validateEditorTokenFromRequest({
  request,
  siteId,
  body,
  allowUnverified = false,
}: {
  request: NextRequest;
  siteId: string;
  body?: Record<string, unknown> | null;
  allowUnverified?: boolean;
}) {
  const token = extractEditorToken(request, body);

  if (!token) {
    return {
      valid: false,
      error: "Missing editor token",
      status: 401,
    } satisfies EditorAccessValidation;
  }

  // Every route that authenticates by token goes through here, so deriving the
  // fingerprint at this one point is what makes the staging device binding
  // impossible to forget at an individual call site.
  //
  // The device grant's origin pin is derived at the same single point, and for
  // the same reason, only more so: forgetting the staging fingerprint costs an
  // editor a re-verification, while forgetting the grant's device context would
  // hand out a credential that works from any website on the internet.
  // `readDeviceContext` returns null when there is no usable `Origin`, and the
  // device-grant branch treats null as a refusal — so the fail-closed answer is
  // the default rather than something each caller has to remember.
  return validateEditorAccess({
    siteId,
    token,
    allowUnverified,
    device: readStagingDeviceFingerprint(request),
    deviceContext: readDeviceContext(request) ?? undefined,
  });
}

export type { StagingPermission };
