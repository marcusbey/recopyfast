/**
 * POST /api/editor/request-code
 *
 * Send a sign-in code to an address that is already on a site's editor
 * allowlist. Called from the hub (no siteId) and from the widget's unlock
 * prompt (siteId set).
 *
 * The response — status, body and headers — is identical whether or not the
 * address is an editor of anything, and it is sent BEFORE the two operations
 * that differ by recognition even run: minting a code (a DB write) and mailing
 * it (a network round trip to Resend). Both are deferred to `after()`, which
 * runs once the response has already been committed, specifically so that an
 * attacker timing the request cannot tell a recognised address from an
 * unrecognised one either — doing either piece of work before responding was
 * a timing oracle exactly as real as a body that varied. It also closes a
 * sharper oracle that used to exist alongside it: minting used to fail with a
 * distinct 503 (`code_unavailable`) that was only reachable for a recognised
 * address, which needed no statistics at all — one request confirmed the
 * address. `after()`'s callback therefore never has a response left to shape;
 * every failure path inside it can only log, as loudly as it did before.
 */

import { NextRequest, NextResponse, after } from "next/server";
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

    // Resolve the claim. Both branches below reach the same
    // `return NEUTRAL_RESPONSE` at the same point in the function — nothing
    // past this lookup is allowed to change the response.
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

    if (recognised) {
      // Runs after the response below has already been sent. Neither branch
      // of this function may await a DB write or a Resend call before
      // responding — that asymmetry was the timing leak. Every failure here
      // is still logged as loudly as before; none of them may become a
      // distinct status code, because that is the sharper oracle this whole
      // change exists to close.
      after(async () => {
        const code = await issueVerificationCode({ email, siteId });
        if (!code) {
          console.error(
            `[editor-auth] could not mint a code after responding (site: ${siteId ?? "hub"})`,
          );
          return;
        }

        const mail = await sendEditorAccessCode(email, code, siteLabel);
        if (!mail.sent) {
          console.error(
            `[editor-auth] code generated but delivery failed (site: ${siteId ?? "hub"}): ${mail.error}`,
          );
        }
      });
    } else {
      console.warn(
        `[editor-auth] code requested for an address with no access (site: ${siteId ?? "hub"})`,
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
