/**
 * Carrying an authenticated hub session onto the customer's domain.
 *
 * Bob verifies on recopyfast.com/edit, picks helloworld.com, and has to arrive
 * there already trusted. The grant must live in localStorage on helloworld.com,
 * which recopyfast.com cannot write to, so something has to travel in the URL.
 *
 * A handoff code is the smallest thing that can: a bearer secret that is
 * single-use and dead in sixty seconds. It lands in browser history and may leak
 * via Referer — and by the time it could be read from either, the widget has
 * already spent it and the code is inert.
 */

import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  generateOpaqueSecret,
  hashOpaqueSecret,
  timingSafeEqualString,
} from "@/lib/auth/editor-crypto";
import { issueDeviceGrant, type DeviceContext } from "@/lib/auth/editor-grants";
import {
  normalizePermissions,
  type EditorPermission,
} from "@/lib/auth/editor-access";

/** Long enough for a redirect and a widget boot; short enough to be uninteresting. */
export const HANDOFF_TTL_MS = 60 * 1000;

export type HandoffRejection =
  | "unknown"
  | "expired"
  | "consumed"
  | "editor_revoked"
  | "site_mismatch"
  | "error";

export async function createHandoff(params: {
  siteEditorId: string;
  rememberDevice: boolean;
}): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const code = generateOpaqueSecret(32);

  const { error } = await supabase.from("editor_handoffs").insert({
    site_editor_id: params.siteEditorId,
    code_hash: hashOpaqueSecret(code),
    remember_device: params.rememberDevice,
    expires_at: new Date(Date.now() + HANDOFF_TTL_MS).toISOString(),
  });

  if (error) {
    console.error("[editor-handoff] could not create handoff:", error.message);
    return null;
  }

  return code;
}

/**
 * Spend a handoff code for a real device grant.
 *
 * The claim is re-checked from scratch — the editor must still be live and must
 * still belong to the site the widget says it is running on. A code minted for
 * one site cannot be redeemed on another.
 */
export async function redeemHandoff(params: {
  code: string;
  siteId: string;
  device: DeviceContext;
}): Promise<
  | {
      ok: true;
      grant: string;
      expiresAt: Date;
      email: string;
      permissions: EditorPermission[];
    }
  | { ok: false; reason: HandoffRejection }
> {
  const supabase = createServiceRoleClient();

  const { data: row, error } = await supabase
    .from("editor_handoffs")
    .select(
      "id, code_hash, remember_device, expires_at, consumed_at, site_editor_id, site_editors!inner(id, site_id, email, permissions, revoked_at)",
    )
    .eq("code_hash", hashOpaqueSecret(params.code))
    .maybeSingle();

  if (error) {
    console.error("[editor-handoff] lookup failed:", error.message);
    return { ok: false, reason: "error" };
  }
  if (!row) return { ok: false, reason: "unknown" };

  // Belt and braces: the lookup was already by hash, but comparing in constant
  // time keeps the shape consistent with every other secret check here.
  if (!timingSafeEqualString(row.code_hash, hashOpaqueSecret(params.code))) {
    return { ok: false, reason: "unknown" };
  }

  if (row.consumed_at) return { ok: false, reason: "consumed" };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  type EditorJoin = {
    id: string;
    site_id: string;
    email: string;
    permissions: string[] | null;
    revoked_at: string | null;
  };
  const editor = row.site_editors as unknown as EditorJoin | null;

  if (!editor) return { ok: false, reason: "unknown" };
  if (editor.revoked_at) return { ok: false, reason: "editor_revoked" };
  if (editor.site_id !== params.siteId) {
    return { ok: false, reason: "site_mismatch" };
  }

  // Consume before minting. The conditional update is the serialisation point:
  // two requests racing on the same code produce exactly one grant.
  const { data: consumed, error: consumeError } = await supabase
    .from("editor_handoffs")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id");

  if (consumeError) {
    console.error("[editor-handoff] consume failed:", consumeError.message);
    return { ok: false, reason: "error" };
  }
  if (!consumed || consumed.length === 0) {
    return { ok: false, reason: "consumed" };
  }

  const issued = await issueDeviceGrant({
    siteEditorId: editor.id,
    siteId: editor.site_id,
    device: params.device,
    rememberDevice: row.remember_device,
  });

  if (!issued) return { ok: false, reason: "error" };

  return {
    ok: true,
    grant: issued.grant,
    expiresAt: issued.expiresAt,
    email: editor.email,
    permissions: normalizePermissions(editor.permissions),
  };
}
