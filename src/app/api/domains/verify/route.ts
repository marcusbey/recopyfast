import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  createDomainVerification,
  validateDomain,
  normalizeDomain,
  performDomainVerification,
  generateDNSTXTRecord,
  generateFileVerificationContent,
  type DomainVerification,
} from "@/lib/security/domain-verification";
import { validateAndSanitizeInput } from "@/lib/security/content-sanitizer";

/**
 * This route wrote camelCase keys straight into Postgres — `siteId`,
 * `verificationMethod`, `verificationCode`, `expiresAt` — none of which are
 * columns on `domain_verifications`, so every POST failed with 42703 and the
 * feature has never created a single row. GET handed the raw snake_case row to
 * a client component that reads camelCase, so the list rendered `undefined`
 * everywhere and threw on `verification.verificationMethod.toUpperCase()`. PUT
 * passed that same raw row to `performDomainVerification`, whose switch on
 * `verification.verificationMethod` therefore always fell through to "Invalid
 * verification method".
 *
 * The column that holds the expected value in production is
 * `verification_value` (see 20250817000000). `verification_code` only ever
 * existed in the standalone `supabase/security-schema.sql`, which is not what
 * is deployed. Using the column that exists keeps this fixable without a
 * migration.
 *
 * Writes go through the service-role client: 20260804130000 grants
 * `authenticated` SELECT only on this table, so an end-user token cannot
 * insert, update or delete. Authorisation is done explicitly here first, which
 * is the posture the rest of this codebase already takes (billing, sites).
 */

/** A `domain_verifications` row exactly as production stores it. */
interface DomainVerificationRow {
  id: string;
  site_id: string;
  domain: string;
  verification_method: "dns" | "file";
  verification_token: string;
  verification_value: string | null;
  is_verified: boolean;
  verified_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

/** The shape the dashboard consumes. Deliberately omits the stored token. */
interface DomainVerificationView {
  id: string;
  siteId: string;
  domain: string;
  verificationMethod: "dns" | "file";
  verificationCode: string;
  isVerified: boolean;
  verifiedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

type VerificationInstructions =
  | { type: "dns"; record: string }
  | { type: "file"; filename: string; content: string };

const VERIFICATION_COLUMNS =
  "id, site_id, domain, verification_method, verification_token, verification_value, is_verified, verified_at, expires_at, created_at, updated_at";

function toView(row: DomainVerificationRow): DomainVerificationView {
  return {
    id: row.id,
    siteId: row.site_id,
    domain: row.domain,
    verificationMethod: row.verification_method,
    verificationCode: row.verification_value ?? "",
    isVerified: row.is_verified,
    verifiedAt: row.verified_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function toDomainVerification(row: DomainVerificationRow): DomainVerification {
  return {
    id: row.id,
    siteId: row.site_id,
    domain: row.domain,
    verificationMethod: row.verification_method,
    verificationToken: row.verification_token,
    verificationCode: row.verification_value ?? "",
    isVerified: row.is_verified,
    verifiedAt: row.verified_at ? new Date(row.verified_at) : undefined,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function buildInstructions(
  method: "dns" | "file",
  verificationCode: string,
): VerificationInstructions {
  return method === "dns"
    ? { type: "dns", record: generateDNSTXTRecord(verificationCode) }
    : { type: "file", ...generateFileVerificationContent(verificationCode) };
}

/**
 * Read the caller's permission on a site through their own token, so RLS is
 * still the thing deciding what they can see. Returns null when they have no
 * row at all.
 */
async function readSitePermission(
  siteId: string,
  userId: string,
): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("site_permissions")
    .select("permission")
    .eq("site_id", siteId)
    .eq("user_id", userId)
    .maybeSingle();

  return data?.permission ?? null;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { siteId, domain, method } = body;

    const sanitizedSiteId = validateAndSanitizeInput(siteId);
    const sanitizedDomain = validateAndSanitizeInput(domain);
    const sanitizedMethod = validateAndSanitizeInput(method);

    if (!sanitizedSiteId || !sanitizedDomain || !sanitizedMethod) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    if (sanitizedMethod !== "dns" && sanitizedMethod !== "file") {
      return NextResponse.json(
        { error: "Invalid verification method" },
        { status: 400 },
      );
    }

    const domainValidation = validateDomain(sanitizedDomain);
    if (!domainValidation.isValid) {
      return NextResponse.json(
        { error: domainValidation.error },
        { status: 400 },
      );
    }

    const permission = await readSitePermission(sanitizedSiteId, user.id);
    if (permission !== "admin") {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const serviceClient = createServiceRoleClient();
    const normalizedDomain = normalizeDomain(sanitizedDomain);

    // Deliberately not `.single()`: production has no unique constraint on
    // (site_id, domain), so a duplicate would make `.single()` error and this
    // branch silently fall through to inserting yet another row.
    const { data: existingRow } = await serviceClient
      .from("domain_verifications")
      .select(VERIFICATION_COLUMNS)
      .eq("site_id", sanitizedSiteId)
      .eq("domain", normalizedDomain)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<DomainVerificationRow>();

    if (existingRow && new Date(existingRow.expires_at) > new Date()) {
      // The stored value is method-agnostic — the same code goes in a TXT
      // record or in the file — so switching method reuses the live challenge
      // rather than silently handing back instructions for the other one.
      //
      // Unless there is nothing to reuse. A row whose `verification_value` is
      // missing re-issues as `recopyfast-verification=` or
      // /.well-known/recopyfast-verification-.txt, and `verifyDomainFile` now
      // refuses an empty code outright — so the owner would follow the
      // instructions exactly and fail forever, with deleting the record the
      // only way out. Re-mint into the same row rather than inserting beside
      // it: the reuse branch exists to keep one live challenge per domain, and
      // leaving the broken row behind would just hand it back next time.
      const storedCode = existingRow.verification_value?.trim() ?? "";
      const replacement = storedCode
        ? null
        : createDomainVerification(
            sanitizedSiteId,
            normalizedDomain,
            sanitizedMethod,
          );

      const { data: updatedRow, error: methodError } = await serviceClient
        .from("domain_verifications")
        .update({
          verification_method: sanitizedMethod,
          updated_at: new Date().toISOString(),
          ...(replacement
            ? {
                verification_token: replacement.verificationToken,
                verification_value: replacement.verificationCode,
                expires_at: replacement.expiresAt.toISOString(),
              }
            : {}),
        })
        .eq("id", existingRow.id)
        .select(VERIFICATION_COLUMNS)
        .single<DomainVerificationRow>();

      if (methodError || !updatedRow) {
        console.error("Domain verification method update error:", methodError);
        return NextResponse.json(
          { error: "Failed to update verification" },
          { status: 500 },
        );
      }

      const view = toView(updatedRow);
      return NextResponse.json({
        verification: view,
        instructions: buildInstructions(sanitizedMethod, view.verificationCode),
      });
    }

    const verification = createDomainVerification(
      sanitizedSiteId,
      normalizedDomain,
      sanitizedMethod,
    );

    const { data: newRow, error: insertError } = await serviceClient
      .from("domain_verifications")
      .insert({
        site_id: verification.siteId,
        domain: verification.domain,
        verification_method: verification.verificationMethod,
        verification_token: verification.verificationToken,
        verification_value: verification.verificationCode,
        is_verified: false,
        expires_at: verification.expiresAt.toISOString(),
      })
      .select(VERIFICATION_COLUMNS)
      .single<DomainVerificationRow>();

    if (insertError || !newRow) {
      console.error("Domain verification creation error:", insertError);
      return NextResponse.json(
        { error: "Failed to create verification" },
        { status: 500 },
      );
    }

    const view = toView(newRow);
    return NextResponse.json({
      verification: view,
      instructions: buildInstructions(sanitizedMethod, view.verificationCode),
    });
  } catch (error) {
    console.error("Domain verification API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const sanitizedVerificationId = validateAndSanitizeInput(
      body.verificationId,
    );
    if (!sanitizedVerificationId) {
      return NextResponse.json(
        { error: "Missing verification ID" },
        { status: 400 },
      );
    }

    const serviceClient = createServiceRoleClient();
    const { data: row } = await serviceClient
      .from("domain_verifications")
      .select(VERIFICATION_COLUMNS)
      .eq("id", sanitizedVerificationId)
      .maybeSingle<DomainVerificationRow>();

    // One 404 for "no such row" and for "not yours", so this endpoint cannot be
    // used to probe which verification ids exist.
    const permission = row
      ? await readSitePermission(row.site_id, user.id)
      : null;

    if (!row || permission !== "admin") {
      return NextResponse.json(
        { error: "Verification not found or access denied" },
        { status: 404 },
      );
    }

    if (new Date(row.expires_at) <= new Date()) {
      return NextResponse.json(
        { error: "Verification has expired" },
        { status: 400 },
      );
    }

    const verificationResult = await performDomainVerification(
      toDomainVerification(row),
    );

    if (!verificationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: verificationResult.error,
          details: verificationResult.details,
        },
        { status: 400 },
      );
    }

    const verifiedAt = new Date().toISOString();
    const { error: updateError } = await serviceClient
      .from("domain_verifications")
      .update({
        is_verified: true,
        verified_at: verifiedAt,
        updated_at: verifiedAt,
      })
      .eq("id", row.id);

    if (updateError) {
      console.error("Verification update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update verification status" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Domain verification successful",
      verifiedAt,
    });
  } catch (error) {
    console.error("Domain verification check API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sanitizedSiteId = validateAndSanitizeInput(
      searchParams.get("siteId"),
    );

    if (!sanitizedSiteId) {
      return NextResponse.json(
        { error: "Missing siteId parameter" },
        { status: 400 },
      );
    }

    // Any permission is enough to look; only admins may create or verify.
    const permission = await readSitePermission(sanitizedSiteId, user.id);
    if (!permission) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const serviceClient = createServiceRoleClient();
    const { data: rows, error } = await serviceClient
      .from("domain_verifications")
      .select(VERIFICATION_COLUMNS)
      .eq("site_id", sanitizedSiteId)
      .order("created_at", { ascending: false })
      .returns<DomainVerificationRow[]>();

    if (error) {
      console.error("Domain verifications fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch verifications" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      verifications: (rows ?? []).map(toView),
      canManage: permission === "admin",
    });
  } catch (error) {
    console.error("Domain verifications API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sanitizedVerificationId = validateAndSanitizeInput(
      searchParams.get("verificationId"),
    );

    if (!sanitizedVerificationId) {
      return NextResponse.json(
        { error: "Missing verificationId parameter" },
        { status: 400 },
      );
    }

    const serviceClient = createServiceRoleClient();

    // The previous implementation filtered a DELETE by
    // `sites.site_permissions.user_id`, which PostgREST cannot resolve on a
    // delete — it rejected the request, so nothing was ever deleted and the
    // ownership check never actually ran. Resolve the row, authorise it, then
    // delete by primary key.
    const { data: row } = await serviceClient
      .from("domain_verifications")
      .select("id, site_id")
      .eq("id", sanitizedVerificationId)
      .maybeSingle<{ id: string; site_id: string }>();

    const permission = row
      ? await readSitePermission(row.site_id, user.id)
      : null;

    if (!row || permission !== "admin") {
      return NextResponse.json(
        { error: "Verification not found or access denied" },
        { status: 404 },
      );
    }

    const { error } = await serviceClient
      .from("domain_verifications")
      .delete()
      .eq("id", row.id);

    if (error) {
      console.error("Domain verification deletion error:", error);
      return NextResponse.json(
        { error: "Failed to delete verification" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Verification deleted successfully",
    });
  } catch (error) {
    console.error("Domain verification deletion API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
