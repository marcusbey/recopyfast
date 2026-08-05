/**
 * Staging Access Management
 * Handles email-verified access tokens for staging environments
 */

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { timingSafeEqualString } from "@/lib/auth/editor-crypto";
import {
  checkStagingDeviceBinding,
  type StagingDeviceFingerprint,
} from "@/lib/auth/staging-device";
import crypto from "crypto";

export type StagingPermission = "view" | "edit" | "publish" | "admin";
export type AccessType = "invite" | "link";

export interface StagingAccess {
  id: string;
  site_id: string;
  access_type: AccessType;
  email: string | null;
  email_verified: boolean;
  token: string;
  permissions: StagingPermission[];
  label: string | null;
  created_by: string | null;
  expires_at: Date;
  is_active: boolean;
  last_used_at: Date | null;
  created_at: Date;
}

export interface CreateStagingAccessParams {
  siteId: string;
  accessType: AccessType;
  email?: string; // Required for 'invite', optional for 'link'
  permissions: StagingPermission[];
  label?: string;
  createdBy: string;
  expiresInDays?: number;
}

export interface ValidateStagingAccessResult {
  valid: boolean;
  verified: boolean;
  permissions: StagingPermission[];
  email: string | null;
  expiresAt: Date | null;
  requiresEmail?: boolean;
  requiresVerification?: boolean;
  error?: string;
}

export interface VerifyEmailParams {
  token: string;
  code?: string; // For verification code
  email?: string; // For link-based access (capture email)
}

export class StagingAccessManager {
  private static readonly DEFAULT_EXPIRY_DAYS = 7;
  private static readonly MAX_EXPIRY_DAYS = 30;
  private static readonly VERIFICATION_CODE_EXPIRY_MINUTES = 10;

  /**
   * Create a new staging access token
   */
  static async createStagingAccess(
    params: CreateStagingAccessParams,
  ): Promise<{ access: StagingAccess; verificationCode?: string }> {
    try {
      const supabase = await createClient();

      // Validate that creator has admin permission on the site
      const { data: creatorPermission, error: permError } = await supabase
        .from("site_permissions")
        .select("permission")
        .eq("site_id", params.siteId)
        .eq("user_id", params.createdBy)
        .single();

      if (permError || creatorPermission?.permission !== "admin") {
        throw new Error("Only site admins can create staging access");
      }

      // Shareable links are retired — they authorised whoever opened them
      // first. The database rejects these too
      // (20260801100000_editor_access_2fa.sql); refusing here gives the caller a
      // readable error instead of a constraint violation.
      if (params.accessType === "link") {
        throw new Error(
          "Shareable staging links are retired. Add the person as a site editor instead.",
        );
      }

      // For invite type, email is required
      if (params.accessType === "invite" && !params.email) {
        throw new Error("Email is required for invite-type access");
      }

      // Generate secure token
      const token = this.generateSecureToken();

      // Calculate expiry
      const expiryDays = Math.min(
        params.expiresInDays || this.DEFAULT_EXPIRY_DAYS,
        this.MAX_EXPIRY_DAYS,
      );
      const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

      // Generate verification code for invite type
      let verificationCode: string | undefined;
      let verificationExpiresAt: Date | undefined;

      if (params.accessType === "invite" && params.email) {
        verificationCode = this.generateVerificationCode();
        verificationExpiresAt = new Date(
          Date.now() + this.VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000,
        );
      }

      // Create staging access record
      const { data: access, error } = await supabase
        .from("staging_access")
        .insert({
          site_id: params.siteId,
          access_type: params.accessType,
          email: params.email || null,
          email_verified: false,
          verification_code: verificationCode || null,
          verification_expires_at: verificationExpiresAt?.toISOString() || null,
          token,
          permissions: params.permissions,
          label: params.label || params.email || null,
          created_by: params.createdBy,
          expires_at: expiresAt.toISOString(),
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create staging access: ${error.message}`);
      }

      return {
        access: this.mapToStagingAccess(access),
        verificationCode,
      };
    } catch (error) {
      // Rethrown (not swallowed): the single caller
      // (src/app/api/staging/access/route.ts) needs the real reason — "not an
      // admin", "links are retired", "email missing" — to map to the right
      // status code. Collapsing everything to a generic failure here made every
      // rejection look like a permissions problem to the caller, including ones
      // that had nothing to do with permissions.
      console.error("Error creating staging access:", error);
      throw error;
    }
  }

  /**
   * Validate a staging access token
   * Uses service role client to bypass RLS for public validation
   */
  static async validateStagingAccess(
    token: string,
    siteId: string,
    device?: StagingDeviceFingerprint,
  ): Promise<ValidateStagingAccessResult> {
    try {
      // Use service role client to bypass RLS for public token validation
      const supabase = createServiceRoleClient();

      // Find the staging access record
      const { data: access, error } = await supabase
        .from("staging_access")
        .select("*")
        .eq("token", token)
        .eq("site_id", siteId)
        .eq("is_active", true)
        .gte("expires_at", new Date().toISOString())
        .single();

      if (error || !access) {
        return {
          valid: false,
          verified: false,
          permissions: [],
          email: null,
          expiresAt: null,
          error: "Invalid or expired staging token",
        };
      }

      // Retired: a 'link' row with no email let whoever opened the URL first
      // name themselves the editor. Those rows are deactivated by
      // 20260801100000_editor_access_2fa.sql and no new ones can be created, but
      // refuse here too so a row that somehow survives is inert rather than
      // self-claimable. Editors now come from site_editors — see
      // src/lib/auth/editor-directory.ts.
      if (access.access_type === "link" && !access.email) {
        return {
          valid: false,
          verified: false,
          permissions: [],
          email: null,
          expiresAt: null,
          error:
            "This share link is no longer valid. Ask the site owner for access.",
        };
      }

      // Check if email is verified
      if (!access.email_verified) {
        return {
          valid: true,
          verified: false,
          permissions: [],
          email: access.email,
          expiresAt: new Date(access.expires_at),
          requiresVerification: true,
        };
      }

      // The flag alone is not enough — it is permanent, and the token it hangs
      // off travels in a URL. Re-check that this request comes from the device
      // that actually entered the code, recently enough to still be trusted.
      // Without this, forwarding the URL forwards the authorisation. See the
      // module header of src/lib/auth/staging-device.ts.
      //
      // A caller that supplies no fingerprint is refused rather than exempted:
      // "I did not bring evidence" must not be a stronger position than
      // bringing the wrong evidence.
      const binding = checkStagingDeviceBinding(
        {
          userAgentHash: access.verified_user_agent_hash ?? null,
          verifiedAt: access.verified_at ?? null,
        },
        device ?? {
          userAgentHash: "",
          originHash: "",
          ipPrefix: null,
        },
      );

      if (!binding.ok) {
        console.warn(
          `[staging-access] verified token presented from an unbound device (${binding.reason}, site ${siteId}) — re-verification required`,
        );
        return {
          valid: true,
          verified: false,
          permissions: [],
          email: access.email,
          expiresAt: new Date(access.expires_at),
          requiresVerification: true,
        };
      }

      // Update last used timestamp
      await supabase
        .from("staging_access")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", access.id);

      return {
        valid: true,
        verified: true,
        permissions: access.permissions,
        email: access.email,
        expiresAt: new Date(access.expires_at),
      };
    } catch (error) {
      console.error("Error validating staging access:", error);
      return {
        valid: false,
        verified: false,
        permissions: [],
        email: null,
        expiresAt: null,
        error: "Validation failed",
      };
    }
  }

  /**
   * RETIRED — self-claim of a shared link.
   *
   * This was the hole: an `access_type='link'` row carries no email, so the
   * first person to open the URL supplied their own address and authorised
   * themselves. Anyone the link was forwarded to could do the same.
   *
   * Kept as an explicit refusal rather than deleted so the retirement is visible
   * at the call site and any surviving caller fails loudly instead of silently
   * finding a different path. Authorisation now starts in the dashboard
   * (`site_editors`); identity is proved per session by
   * `src/lib/auth/editor-verification.ts`.
   */
  static async captureEmail(
    token: string,
    // Retained so existing call sites keep type-checking; deliberately unused —
    // the address is exactly what this method must no longer accept, and
    // logging it would record an unverified claim about a third party.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    email: string,
  ): Promise<{ success: boolean; verificationCode?: string; error?: string }> {
    console.warn(
      `[staging-access] captureEmail refused — self-claim of a shared link is retired (token ${token.slice(0, 8)}…). Add the person as a site editor instead.`,
    );
    return {
      success: false,
      error:
        "Share links no longer grant access. Ask the site owner to add you as an editor.",
    };
  }

  /**
   * Verify email with code
   */
  static async verifyEmail(
    token: string,
    code: string,
    device?: StagingDeviceFingerprint,
  ): Promise<{ success: boolean; access?: StagingAccess; error?: string }> {
    try {
      const supabase = createServiceRoleClient();

      // Find the access record
      const { data: access, error: findError } = await supabase
        .from("staging_access")
        .select("*")
        .eq("token", token)
        .eq("is_active", true)
        .gte("expires_at", new Date().toISOString())
        .single();

      if (findError || !access) {
        return { success: false, error: "Invalid or expired token" };
      }

      // Constant-time comparison. `!==` returns as soon as two characters
      // differ, so the time it takes to reject leaks how many leading digits
      // were right — enough, over many requests, to recover a 6-digit code one
      // digit at a time instead of guessing all 10^6.
      if (
        !access.verification_code ||
        !timingSafeEqualString(access.verification_code, code)
      ) {
        return { success: false, error: "Invalid verification code" };
      }

      // Check code expiry
      if (
        access.verification_expires_at &&
        new Date(access.verification_expires_at) < new Date()
      ) {
        return { success: false, error: "Verification code expired" };
      }

      // Mark as verified AND bind the result to the device that did it.
      //
      // These are written together on purpose: `email_verified` without a
      // fingerprint is precisely the state that let a forwarded URL inherit
      // someone else's verification, so the flag must never exist on its own.
      // A caller that supplied no fingerprint records an empty binding, which
      // `checkStagingDeviceBinding` treats as unbound and refuses — the row
      // fails closed rather than becoming a bearer credential again.
      const { data: updatedAccess, error: updateError } = await supabase
        .from("staging_access")
        .update({
          email_verified: true,
          verification_code: null,
          verification_expires_at: null,
          verified_user_agent_hash: device?.userAgentHash ?? null,
          verified_origin_hash: device?.originHash ?? null,
          verified_ip_prefix: device?.ipPrefix ?? null,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", access.id)
        .select()
        .single();

      if (updateError) {
        console.error(
          "[staging-access] verified but could not persist device binding:",
          updateError.message,
        );
        return { success: false, error: "Failed to verify email" };
      }

      return {
        success: true,
        access: this.mapToStagingAccess(updatedAccess),
      };
    } catch (error) {
      console.error("Error verifying email:", error);
      return { success: false, error: "Verification failed" };
    }
  }

  /**
   * The address a resend would mail, resolved without sending anything.
   *
   * Exists so the resend endpoint can rate-limit on the *recipient* rather than
   * only on the token. One person can hold several invites across sites, and an
   * attacker holding two tokens for the same address would otherwise get two
   * independent budgets and double the mail they can aim at that inbox. The
   * address is the thing being protected, so the address is what the limit is
   * keyed on.
   *
   * Returns null for an unknown, revoked or expired token. The caller must treat
   * that as "no recipient bucket to charge" and still apply its per-IP limit —
   * never as permission to skip limiting.
   */
  static async getResendRecipient(token: string): Promise<string | null> {
    try {
      const supabase = createServiceRoleClient();

      const { data: access, error } = await supabase
        .from("staging_access")
        .select("email")
        .eq("token", token)
        .eq("is_active", true)
        .gte("expires_at", new Date().toISOString())
        .maybeSingle();

      if (error) {
        console.error(
          "[staging-access] resend recipient lookup failed:",
          error.message,
        );
        return null;
      }

      return access?.email ?? null;
    } catch (error) {
      console.error("[staging-access] resend recipient lookup threw:", error);
      return null;
    }
  }

  /**
   * Resend verification code
   */
  static async resendVerificationCode(token: string): Promise<{
    success: boolean;
    verificationCode?: string;
    email?: string;
    error?: string;
  }> {
    try {
      const supabase = createServiceRoleClient();

      // Find the access record
      const { data: access, error: findError } = await supabase
        .from("staging_access")
        .select("*")
        .eq("token", token)
        .eq("is_active", true)
        .gte("expires_at", new Date().toISOString())
        .single();

      if (findError || !access) {
        return { success: false, error: "Invalid or expired token" };
      }

      if (access.email_verified) {
        return { success: false, error: "Email already verified" };
      }

      if (!access.email) {
        return { success: false, error: "No email to verify" };
      }

      // Generate new verification code
      const verificationCode = this.generateVerificationCode();
      const verificationExpiresAt = new Date(
        Date.now() + this.VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000,
      );

      const { error: updateError } = await supabase
        .from("staging_access")
        .update({
          verification_code: verificationCode,
          verification_expires_at: verificationExpiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", access.id);

      if (updateError) {
        return { success: false, error: "Failed to resend code" };
      }

      return { success: true, verificationCode, email: access.email };
    } catch (error) {
      console.error("Error resending verification code:", error);
      return { success: false, error: "Failed to resend code" };
    }
  }

  /**
   * Revoke staging access
   */
  static async revokeStagingAccess(
    accessId: string,
    revokedBy: string,
  ): Promise<boolean> {
    try {
      const supabase = await createClient();

      const { error } = await supabase
        .from("staging_access")
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
          revoked_by: revokedBy,
        })
        .eq("id", accessId);

      return !error;
    } catch (error) {
      console.error("Error revoking staging access:", error);
      return false;
    }
  }

  /**
   * List all staging access for a site
   */
  static async listStagingAccess(
    siteId: string,
    includeRevoked = false,
  ): Promise<StagingAccess[]> {
    try {
      const supabase = await createClient();

      let query = supabase
        .from("staging_access")
        .select("*")
        .eq("site_id", siteId)
        .order("created_at", { ascending: false });

      if (!includeRevoked) {
        query = query.eq("is_active", true);
      }

      const { data: accessList, error } = await query;

      if (error) {
        throw new Error(`Failed to list staging access: ${error.message}`);
      }

      return (accessList || []).map(this.mapToStagingAccess);
    } catch (error) {
      console.error("Error listing staging access:", error);
      return [];
    }
  }

  /**
   * Get staging URL for a site
   */
  static getStagingUrl(siteUrl: string, token: string): string {
    const url = new URL(siteUrl);
    url.searchParams.set("rcf_staging", "1");
    url.searchParams.set("rcf_token", token);
    return url.toString();
  }

  /**
   * Check if access has specific permission
   */
  static hasPermission(
    access: StagingAccess,
    permission: StagingPermission,
  ): boolean {
    // Admin has all permissions
    if (access.permissions.includes("admin")) {
      return true;
    }
    // Publish includes edit and view
    if (permission === "edit" && access.permissions.includes("publish")) {
      return true;
    }
    if (permission === "view") {
      return access.permissions.length > 0; // Any permission includes view
    }
    return access.permissions.includes(permission);
  }

  /**
   * Generate a cryptographically secure token
   */
  private static generateSecureToken(): string {
    return crypto.randomBytes(48).toString("base64url");
  }

  /**
   * Generate a 6-digit verification code
   */
  private static generateVerificationCode(): string {
    // crypto.randomInt is uniform and unpredictable. Math.random() is a non-CSPRNG
    // whose output can be reconstructed from prior values — unacceptable for a code
    // that gates access to staging content.
    return crypto.randomInt(100000, 1000000).toString();
  }

  /**
   * Map database record to StagingAccess interface
   */
  private static mapToStagingAccess(
    record: Record<string, unknown>,
  ): StagingAccess {
    return {
      id: record.id as string,
      site_id: record.site_id as string,
      access_type: record.access_type as AccessType,
      email: record.email as string | null,
      email_verified: record.email_verified as boolean,
      token: record.token as string,
      permissions: record.permissions as StagingPermission[],
      label: record.label as string | null,
      created_by: record.created_by as string | null,
      expires_at: new Date(record.expires_at as string),
      is_active: record.is_active as boolean,
      last_used_at: record.last_used_at
        ? new Date(record.last_used_at as string)
        : null,
      created_at: new Date(record.created_at as string),
    };
  }
}
