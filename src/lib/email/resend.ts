/**
 * Transactional email via Resend.
 *
 * Single integration point for outbound mail. Kept deliberately small and
 * fail-soft: a mail outage must never throw into a request handler (the caller
 * decides how to surface "code sent"); we log and return a boolean instead.
 */

import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Verified sender. Must be a domain/address verified in the Resend dashboard.
//
// The default is `recopyfa.st` — the domain the product actually runs on and
// the one verified in Resend. It used to read `recopyfast.com`, which is not a
// domain on the account, so with EMAIL_FROM unset (it is unset) every send was
// rejected with "The recopyfast.com domain is not verified". That silently
// broke every staging invite and every editor sign-in code: the row was
// written, the mail was refused, and the caller reported success.
const EMAIL_FROM = process.env.EMAIL_FROM || "ReCopyFast <noreply@recopyfa.st>";

// Lazily construct the client so a missing key doesn't crash module import
// (e.g. during `next build` env collection) — only sends fail, loudly.
let client: Resend | null = null;
function getClient(): Resend | null {
  if (!RESEND_API_KEY) return null;
  if (!client) client = new Resend(RESEND_API_KEY);
  return client;
}

export interface SendResult {
  sent: boolean;
  error?: string;
}

/**
 * Is outbound mail configured at all?
 *
 * Callers that must not reveal whether an address exists use this to decide
 * *before* looking anything up. A global "we cannot send mail" answer is honest
 * and identical for every address; a per-address failure returned after a
 * lookup would be an existence oracle.
 */
export function isEmailProviderConfigured(): boolean {
  return Boolean(RESEND_API_KEY);
}

async function send(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const resend = getClient();
  if (!resend) {
    // No provider configured. Loud in logs, soft to the caller — the gate fails
    // CLOSED: callers must surface the failure rather than report a code sent.
    // Editor access simply cannot be granted until RESEND_API_KEY is set.
    console.error(
      "[email] RESEND_API_KEY not configured — cannot send transactional email.",
    );
    return { sent: false, error: "Email provider not configured" };
  }

  try {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    if (error) {
      console.error("[email] Resend send failed:", error);
      return { sent: false, error: error.message };
    }
    return { sent: true };
  } catch (err) {
    console.error("[email] Resend threw:", err);
    return { sent: false, error: "Email send failed" };
  }
}

/**
 * Deliver a staging-access verification code.
 * The code is a short-lived secret; it is only ever sent here, never returned
 * in an API response.
 */
export async function sendStagingVerificationEmail(
  email: string,
  code: string,
  siteLabel?: string,
): Promise<SendResult> {
  const where = siteLabel ? ` for ${siteLabel}` : "";
  const subject = "Your ReCopyFast staging access code";
  const text = [
    `Your verification code${where} is: ${code}`,
    "",
    "It expires in 10 minutes. If you didn't request access, ignore this email.",
  ].join("\n");
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 12px;font-size:18px">Staging access code</h2>
      <p style="margin:0 0 16px;color:#475569">Use this code to verify your access${where}:</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:6px;padding:16px 0;text-align:center;background:#f1f5f9;border-radius:8px">${code}</div>
      <p style="margin:16px 0 0;color:#94a3b8;font-size:13px">Expires in 10 minutes. If you didn't request access, ignore this email.</p>
    </div>`;
  return send({ to: email, subject, html, text });
}

/**
 * Deliver an editor sign-in code.
 *
 * The code is the second factor for edit access, so it goes here and nowhere
 * else — never into an API response, never into a log line. `siteLabel` is
 * omitted for hub sign-ins, where naming a site before the address is proven
 * would confirm that the address is an editor of it.
 */
export async function sendEditorAccessCode(
  email: string,
  code: string,
  siteLabel?: string,
): Promise<SendResult> {
  const where = siteLabel ? ` for ${siteLabel}` : "";
  const subject = "Your ReCopyFast editing code";
  const text = [
    `Your editing code${where} is: ${code}`,
    "",
    "It expires in 10 minutes and can be used once.",
    "If you didn't ask to edit, ignore this email — nothing has changed.",
  ].join("\n");
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 12px;font-size:18px">Your editing code</h2>
      <p style="margin:0 0 16px;color:#475569">Enter this code to start editing${where}:</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:6px;padding:16px 0;text-align:center;background:#f1f5f9;border-radius:8px">${code}</div>
      <p style="margin:16px 0 0;color:#94a3b8;font-size:13px">Expires in 10 minutes and can be used once. If you didn't ask to edit, ignore this email — nothing has changed.</p>
    </div>`;
  return send({ to: email, subject, html, text });
}
