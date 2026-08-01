/**
 * POST /api/editor/validate-grant
 *
 * The widget's boot check: "is the token in my localStorage still good?"
 *
 * Every call re-reads the durable site_editors row, so this is also the point
 * at which a revoked editor loses an in-flight session — there is no cached
 * verdict anywhere for a revocation to miss.
 */

import { NextRequest, NextResponse } from "next/server";
import { nextActionFor, validateDeviceGrant } from "@/lib/auth/editor-grants";
import {
  limitGrantChecks,
  readDeviceContext,
  readJsonBody,
  readString,
} from "@/lib/auth/editor-request";
import { publicOptions, withPublicCors } from "@/lib/http/public-cors";

export async function POST(request: NextRequest) {
  try {
    const limited = await limitGrantChecks(request, "editor/validate-grant");
    if (limited) return withPublicCors(limited, request);

    const body = await readJsonBody(request);
    const grant = readString(body, "grant");
    const siteId = readString(body, "siteId");

    if (!grant || !siteId) {
      return withPublicCors(
        NextResponse.json(
          { valid: false, reason: "malformed", nextAction: "verify" },
          { status: 400 },
        ),
        request,
      );
    }

    const device = readDeviceContext(request);
    if (!device) {
      return withPublicCors(
        NextResponse.json(
          { valid: false, reason: "origin_mismatch", nextAction: "verify" },
          { status: 401 },
        ),
        request,
      );
    }

    const result = await validateDeviceGrant({ grant, siteId, device });

    if (!result.valid) {
      console.warn(
        `[editor-auth] grant refused (${result.reason}) for site ${siteId} from ${device.origin}`,
      );
      return withPublicCors(
        NextResponse.json(
          {
            valid: false,
            reason: result.reason,
            nextAction: nextActionFor(result.reason),
          },
          { status: 401 },
        ),
        request,
      );
    }

    return withPublicCors(
      NextResponse.json({
        valid: true,
        email: result.grant.email,
        permissions: result.grant.permissions,
        expiresAt: result.grant.expiresAt.toISOString(),
        shouldRefresh: result.grant.shouldRefresh,
      }),
      request,
    );
  } catch (error) {
    console.error("[editor-auth] validate-grant failed:", error);
    return withPublicCors(
      NextResponse.json({ valid: false, reason: "error" }, { status: 500 }),
      request,
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request, "POST,OPTIONS");
}
