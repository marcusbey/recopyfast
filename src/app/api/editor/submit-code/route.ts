/**
 * POST /api/editor/submit-code
 *
 * Exchange an emailed code for proof of identity.
 *
 * Two shapes, distinguished by whether `siteId` is present:
 *   siteId set     unlock in place — returns a device grant the widget stores
 *                  on the customer's own origin.
 *   siteId absent  hub sign-in — sets a first-party httpOnly session cookie on
 *                  recopyfast.com and returns the list of sites this address
 *                  may edit.
 *
 * Codes are scoped: one issued for the hub cannot be spent against a site, and
 * vice versa.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  findActiveSiteEditor,
  isPlausibleEmail,
  listSitesForEditor,
  normalizeEmail,
} from "@/lib/auth/editor-directory";
import { consumeVerificationCode } from "@/lib/auth/editor-verification";
import { issueDeviceGrant } from "@/lib/auth/editor-grants";
import {
  HUB_SESSION_COOKIE,
  createHubSessionToken,
  hubSessionCookieOptions,
} from "@/lib/auth/editor-hub-session";
import {
  limitCodeAttempts,
  originBelongsToSite,
  readDeviceContext,
  readJsonBody,
  readString,
} from "@/lib/auth/editor-request";
import { publicOptions, withPublicCors } from "@/lib/http/public-cors";

/** One message for every way a code can fail. Wrong, expired, never issued, spent — all the same. */
function rejectCode(request: NextRequest) {
  return withPublicCors(
    NextResponse.json(
      {
        error: "invalid_code",
        message: "That code isn't valid. Request a new one.",
      },
      { status: 401 },
    ),
    request,
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    const rawEmail = readString(body, "email");
    const code = readString(body, "code");
    const siteId = readString(body, "siteId");
    const rememberDevice = body?.rememberDevice === true;

    if (!rawEmail || !isPlausibleEmail(rawEmail.trim()) || !code) {
      return withPublicCors(
        NextResponse.json(
          { error: "invalid_request", message: "Email and code are required." },
          { status: 400 },
        ),
        request,
      );
    }

    const email = normalizeEmail(rawEmail);

    // Counted BEFORE the code is compared, so a wrong guess costs budget whether
    // or not it was close. Same ordering as src/app/api/staging/verify/route.ts.
    const limited = await limitCodeAttempts(request, { email, siteId });
    if (limited) return withPublicCors(limited, request);

    const check = await consumeVerificationCode({ email, siteId, code });
    if (!check.ok) {
      console.warn(
        `[editor-auth] code rejected (${check.reason}, site: ${siteId ?? "hub"})`,
      );
      return rejectCode(request);
    }

    // ---- Hub sign-in ----------------------------------------------------
    if (!siteId) {
      const sites = await listSitesForEditor(email);
      const response = withPublicCors(
        NextResponse.json({
          ok: true,
          mode: "hub",
          email,
          sites: sites.map((site) => ({
            siteId: site.siteId,
            name: site.siteName,
            domain: site.siteDomain,
            permissions: site.permissions,
          })),
        }),
        request,
      );
      response.cookies.set(
        HUB_SESSION_COOKIE,
        createHubSessionToken(email),
        hubSessionCookieOptions(),
      );
      return response;
    }

    // ---- Unlock in place ------------------------------------------------
    const device = readDeviceContext(request);
    if (!device) {
      return withPublicCors(
        NextResponse.json(
          {
            error: "origin_required",
            message: "A grant can only be issued to a browser on the site.",
          },
          { status: 400 },
        ),
        request,
      );
    }

    // Bind at mint time, not only at use. Otherwise a genuine editor could mint
    // a grant for an origin they control and stand up a working clone of the
    // customer's site.
    if (!(await originBelongsToSite(siteId, device.origin))) {
      console.warn(
        `[editor-auth] refused to mint a grant for ${device.origin} on site ${siteId} — origin is not the registered domain`,
      );
      return withPublicCors(
        NextResponse.json(
          {
            error: "origin_mismatch",
            message: "This site isn't served from its registered domain.",
          },
          { status: 403 },
        ),
        request,
      );
    }

    const editor = await findActiveSiteEditor(siteId, email);
    if (!editor) {
      // Reachable only if the editor was revoked between the code being issued
      // and used. The code is already spent, so this cannot be probed.
      return rejectCode(request);
    }

    const issued = await issueDeviceGrant({
      siteEditorId: editor.id,
      siteId,
      device,
      rememberDevice,
    });

    if (!issued) {
      return withPublicCors(
        NextResponse.json({ error: "server_error" }, { status: 500 }),
        request,
      );
    }

    return withPublicCors(
      NextResponse.json({
        ok: true,
        mode: "site",
        grant: issued.grant,
        expiresAt: issued.expiresAt.toISOString(),
        rememberDevice,
        email: editor.email,
        permissions: editor.permissions,
      }),
      request,
    );
  } catch (error) {
    console.error("[editor-auth] submit-code failed:", error);
    return withPublicCors(
      NextResponse.json({ error: "server_error" }, { status: 500 }),
      request,
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request, "POST,OPTIONS");
}
