/**
 * POST /api/editor/handoff/redeem
 *
 * The widget's half of the hub -> customer-site transfer. Called immediately on
 * boot when the URL carries `?rcf_handoff=…`, exchanging that one-shot code for
 * a real device grant bound to this browser and this origin.
 *
 * The widget must strip the parameter from the URL after calling this, so the
 * spent code does not sit in the address bar. It is inert either way — single
 * use, sixty seconds — but leaving it there invites confusion.
 */

import { NextRequest, NextResponse } from "next/server";
import { redeemHandoff } from "@/lib/auth/editor-handoff";
import {
  limitGrantChecks,
  originBelongsToSite,
  readDeviceContext,
  readJsonBody,
  readString,
} from "@/lib/auth/editor-request";
import { publicOptions, withPublicCors } from "@/lib/http/public-cors";

export async function POST(request: NextRequest) {
  try {
    const limited = await limitGrantChecks(request, "editor/handoff-redeem");
    if (limited) return withPublicCors(limited, request);

    const body = await readJsonBody(request);
    const code = readString(body, "code");
    const siteId = readString(body, "siteId");

    if (!code || !siteId) {
      return withPublicCors(
        NextResponse.json({ ok: false, reason: "malformed" }, { status: 400 }),
        request,
      );
    }

    const device = readDeviceContext(request);
    if (!device) {
      return withPublicCors(
        NextResponse.json(
          { ok: false, reason: "origin_required" },
          { status: 400 },
        ),
        request,
      );
    }

    if (!(await originBelongsToSite(siteId, device.origin))) {
      console.warn(
        `[editor-auth] handoff redemption refused: ${device.origin} is not the registered domain of site ${siteId}`,
      );
      return withPublicCors(
        NextResponse.json(
          { ok: false, reason: "origin_mismatch" },
          { status: 403 },
        ),
        request,
      );
    }

    const result = await redeemHandoff({ code, siteId, device });

    if (!result.ok) {
      console.warn(
        `[editor-auth] handoff refused (${result.reason}) for site ${siteId}`,
      );
      return withPublicCors(
        NextResponse.json(
          { ok: false, reason: result.reason },
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
        email: result.email,
        permissions: result.permissions,
      }),
      request,
    );
  } catch (error) {
    console.error("[editor-auth] handoff redeem failed:", error);
    return withPublicCors(
      NextResponse.json({ ok: false, reason: "error" }, { status: 500 }),
      request,
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request, "POST,OPTIONS");
}
