/**
 * POST /api/editor/refresh-grant
 *
 * Slide a grant's expiry forward by exchanging it for a new one. Called by the
 * widget when a validate response comes back with `shouldRefresh: true`.
 *
 * The old token is marked superseded rather than deleted, which is what makes a
 * later presentation of it recognisable as a replay — see
 * `validateDeviceGrant`. A sibling tab still holding the old token keeps working
 * for a short grace window.
 */

import { NextRequest, NextResponse } from "next/server";
import { nextActionFor, refreshDeviceGrant } from "@/lib/auth/editor-grants";
import {
  limitGrantChecks,
  readDeviceContext,
  readJsonBody,
  readString,
} from "@/lib/auth/editor-request";
import { publicOptions, withPublicCors } from "@/lib/http/public-cors";

export async function POST(request: NextRequest) {
  try {
    const limited = await limitGrantChecks(request, "editor/refresh-grant");
    if (limited) return withPublicCors(limited, request);

    const body = await readJsonBody(request);
    const grant = readString(body, "grant");
    const siteId = readString(body, "siteId");
    const rememberDevice = body?.rememberDevice === true;

    if (!grant || !siteId) {
      return withPublicCors(
        NextResponse.json(
          { ok: false, reason: "malformed", nextAction: "verify" },
          { status: 400 },
        ),
        request,
      );
    }

    const device = readDeviceContext(request);
    if (!device) {
      return withPublicCors(
        NextResponse.json(
          { ok: false, reason: "origin_mismatch", nextAction: "verify" },
          { status: 401 },
        ),
        request,
      );
    }

    const result = await refreshDeviceGrant({
      grant,
      siteId,
      device,
      rememberDevice,
    });

    if (!result.ok) {
      console.warn(
        `[editor-auth] refresh refused (${result.reason}) for site ${siteId}`,
      );
      return withPublicCors(
        NextResponse.json(
          {
            ok: false,
            reason: result.reason,
            nextAction: nextActionFor(result.reason),
          },
          { status: result.reason === "error" ? 500 : 401 },
        ),
        request,
      );
    }

    return withPublicCors(
      NextResponse.json({
        ok: true,
        grant: result.grant,
        expiresAt: result.expiresAt.toISOString(),
      }),
      request,
    );
  } catch (error) {
    console.error("[editor-auth] refresh-grant failed:", error);
    return withPublicCors(
      NextResponse.json({ ok: false, reason: "error" }, { status: 500 }),
      request,
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request, "POST,OPTIONS");
}
