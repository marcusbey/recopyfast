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

export type EditorAccessKind = "staging" | "edit-session";
export type EditorPermission = "view" | "edit" | "publish" | "admin";

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
}): Promise<EditorAccessValidation> {
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
  return validateEditorAccess({
    siteId,
    token,
    allowUnverified,
    device: readStagingDeviceFingerprint(request),
  });
}

export type { StagingPermission };
