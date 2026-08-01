/**
 * POST /api/editor/request-code
 *
 * Send a sign-in code to an address that is already on a site's editor
 * allowlist. Called from the hub (no siteId) and from the widget's unlock
 * prompt (siteId set).
 *
 * The response is identical whether or not the address is an editor of
 * anything. That is the entire enumeration defence: an attacker with a list of
 * addresses learns nothing about which of them can edit which site.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  isEmailProviderConfigured,
  sendEditorAccessCode,
} from "@/lib/email/resend";
import {
  findActiveSiteEditor,
  isPlausibleEmail,
  listSitesForEditor,
  normalizeEmail,
} from "@/lib/auth/editor-directory";
import { issueVerificationCode } from "@/lib/auth/editor-verification";
import {
  limitCodeRequests,
  readJsonBody,
  readString,
} from "@/lib/auth/editor-request";
import { publicOptions, withPublicCors } from "@/lib/http/public-cors";

/** Identical for every caller. Never varies on whether the address is known. */
const NEUTRAL_RESPONSE = {
  ok: true,
  message: "If that address can edit this site, a code is on its way.",
} as const;

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    const rawEmail = readString(body, "email");
    const siteId = readString(body, "siteId");

    if (!rawEmail || !isPlausibleEmail(rawEmail.trim())) {
      // A malformed address is a client bug, not an existence signal — every
      // address is either well-formed or not, regardless of who is an editor.
      return withPublicCors(
        NextResponse.json(
          { error: "invalid_email", message: "Enter a valid email address." },
          { status: 400 },
        ),
        request,
      );
    }

    const email = normalizeEmail(rawEmail);

    // Decided BEFORE any lookup, so the answer cannot depend on the address.
    // This is the honest failure the brief asks for: when mail is not
    // configured, every caller is told plainly that no code was sent.
    if (!isEmailProviderConfigured()) {
      console.error(
        "[editor-auth] request-code refused: RESEND_API_KEY is not configured, no code can be delivered.",
      );
      return withPublicCors(
        NextResponse.json(
          {
            error: "email_unavailable",
            message:
              "We couldn't send the code — email delivery isn't configured. Contact the site owner.",
          },
          { status: 503 },
        ),
        request,
      );
    }

    const limited = await limitCodeRequests(request, { email, siteId });
    if (limited) return withPublicCors(limited, request);

    // Resolve the claim. Both misses fall through to the neutral response with
    // no mail sent and no timing branch worth measuring.
    let siteLabel: string | undefined;
    let recognised = false;

    if (siteId) {
      const editor = await findActiveSiteEditor(siteId, email);
      recognised = editor !== null;
    } else {
      const sites = await listSitesForEditor(email);
      recognised = sites.length > 0;
      // Deliberately unlabelled: naming a site in the email of a hub sign-in
      // would confirm the address edits it.
      siteLabel = undefined;
    }

    if (!recognised) {
      console.warn(
        `[editor-auth] code requested for an address with no access (site: ${siteId ?? "hub"})`,
      );
      return withPublicCors(NextResponse.json(NEUTRAL_RESPONSE), request);
    }

    const code = await issueVerificationCode({ email, siteId });
    if (!code) {
      return withPublicCors(
        NextResponse.json(
          {
            error: "code_unavailable",
            message: "We couldn't send the code. Please try again.",
          },
          { status: 503 },
        ),
        request,
      );
    }

    const mail = await sendEditorAccessCode(email, code, siteLabel);
    if (!mail.sent) {
      // Provider is configured but this send failed. Logged loudly; the caller
      // still gets the neutral response, because a per-address failure returned
      // here would be exactly the existence oracle the neutral response exists
      // to prevent. See the report for this trade-off.
      console.error(
        `[editor-auth] code generated but delivery failed (site: ${siteId ?? "hub"}): ${mail.error}`,
      );
    }

    return withPublicCors(NextResponse.json(NEUTRAL_RESPONSE), request);
  } catch (error) {
    console.error("[editor-auth] request-code failed:", error);
    return withPublicCors(
      NextResponse.json({ error: "server_error" }, { status: 500 }),
      request,
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request, "POST,OPTIONS");
}
