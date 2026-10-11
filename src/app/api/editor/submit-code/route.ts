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
import { requireUuid } from "@/lib/api/validation";
import {
  checkOwnerCanEdit,
  ownerCanEditRefusal,
} from "@/lib/billing/owner-can-edit";

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
    const rawSiteId = readString(body, "siteId");
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

    // s68b M3. Canonicalised BEFORE the limiter: the per-address bucket used to
    // be keyed on the raw `siteId` while the code row is found through a `uuid`
    // cast, so each spelling of one site id was a fresh five-guess budget
    // against the same code. Malformed → 400; absent → hub mode, unchanged.
    let siteId: string | null = null;
    if (rawSiteId !== null) {
      const canonical = requireUuid(body ?? {}, "siteId");
      if (!canonical.ok) {
        return withPublicCors(
          NextResponse.json(
            { error: "invalid_request", message: "That site id isn't valid." },
            { status: 400 },
          ),
          request,
        );
      }
      siteId = canonical.value;
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
    //
    // `rememberDevice` used to be read above and ignored here: the hub cookie
    // was 30 minutes whatever was ticked, and the flag reached the customer's
    // site only through the hand-off body. s39 made the hub somewhere an editor
    // comes back to, and a resumed session never shows the checkbox again — so
    // the choice is signed into the session now, and the cookie lives as long
    // as the editor asked it to.
    if (!siteId) {
      const sites = await listSitesForEditor(email);
      const response = withPublicCors(
        NextResponse.json({
          ok: true,
          mode: "hub",
          email,
          remembered: rememberDevice,
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
        createHubSessionToken(email, rememberDevice),
        hubSessionCookieOptions(rememberDevice),
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
    const belongs = await originBelongsToSite(siteId, device.origin);
    if (belongs === null) {
      // No verdict: the site could not be read (s76 review minor 2). Not
      // origin_mismatch, which would tell the editor their site is misdeployed.
      // The code above is already spent — the editor requests a new one.
      return withPublicCors(
        NextResponse.json(
          {
            error: "unavailable",
            message:
              "We couldn't check this site just now. Request a new code and try again.",
          },
          { status: 503 },
        ),
        request,
      );
    }
    if (!belongs) {
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

    // A grant on a lapsed owner's site would only be refused at its first
    // save, so none is minted, and the code prompt shows the owner's message
    // (s51, ADR 041). Only now — after the code is spent and the editor found
    // — because before that the caller has proved nothing, and "plan ended"
    // would be an oracle on a customer's billing. 402, never 401/403: the
    // widget reads `message` either way and must not treat it as terminal.
    const ownerCanEdit = await checkOwnerCanEdit(siteId);
    if (!ownerCanEdit.ok) {
      return withPublicCors(ownerCanEditRefusal(ownerCanEdit), request);
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
