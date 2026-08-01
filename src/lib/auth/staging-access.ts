/**
 * Staging Access Management
 * Handles email-verified access tokens for staging environments
 */

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
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
  ): Promise<{ access: StagingAccess; verificationCode?: string } | null> {
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
      console.error("Error creating staging access:", error);
      return null;
    }
  }

  /**
   * Validate a staging access token
   * Uses service role client to bypass RLS for public validation
   */
  static async validateStagingAccess(
    token: string,
    siteId: string,
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

      // For link-based access without email, require email capture first
      if (access.access_type === "link" && !access.email) {
        return {
          valid: true,
          verified: false,
          permissions: [],
          email: null,
          expiresAt: new Date(access.expires_at),
          requiresEmail: true,
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
   * Capture email for link-based access
   */
  static async captureEmail(
    token: string,
    email: string,
  ): Promise<{ success: boolean; verificationCode?: string; error?: string }> {
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

      // Only allow email capture for link-type access without email
      if (access.access_type !== "link") {
        return {
          success: false,
          error: "Cannot capture email for invite-type access",
        };
      }

      if (access.email && access.email !== email) {
        return { success: false, error: "Email already set for this token" };
      }

      // Generate verification code
      const verificationCode = this.generateVerificationCode();
      const verificationExpiresAt = new Date(
        Date.now() + this.VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000,
      );

      // Update with email and verification code
      const { error: updateError } = await supabase
        .from("staging_access")
        .update({
          email,
          verification_code: verificationCode,
          verification_expires_at: verificationExpiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", access.id);

      if (updateError) {
        return { success: false, error: "Failed to capture email" };
      }

      return { success: true, verificationCode };
    } catch (error) {
      console.error("Error capturing email:", error);
      return { success: false, error: "Failed to capture email" };
    }
  }

  /**
   * Verify email with code
   */
  static async verifyEmail(
    token: string,
    code: string,
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

      // Check verification code
      if (!access.verification_code || access.verification_code !== code) {
        return { success: false, error: "Invalid verification code" };
      }

      // Check code expiry
      if (
        access.verification_expires_at &&
        new Date(access.verification_expires_at) < new Date()
      ) {
        return { success: false, error: "Verification code expired" };
      }

      // Mark as verified
      const { data: updatedAccess, error: updateError } = await supabase
        .from("staging_access")
        .update({
          email_verified: true,
          verification_code: null,
          verification_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", access.id)
        .select()
        .single();

      if (updateError) {
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
