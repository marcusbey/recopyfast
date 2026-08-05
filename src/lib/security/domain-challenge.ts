/**
 * The domain-ownership challenge: what we ask the owner to publish, and what
 * counts as having published it.
 *
 * Separate from `domain-verification.ts` because that module imports `crypto`
 * and `dns` at the top level and so can never be pulled into a client bundle —
 * while the dashboard has to render, and copy to the clipboard, the exact text
 * the checker will look for. Keeping the format here means the instructions a
 * customer follows and the rule their file is judged by cannot drift apart:
 * they are the same function.
 *
 * Nothing here touches the network or the filesystem. Pure string work only.
 */

export function generateDNSTXTRecord(verificationCode: string): string {
  return `recopyfast-verification=${verificationCode}`;
}

export function generateFileVerificationContent(verificationCode: string): {
  filename: string;
  content: string;
} {
  return {
    filename: `recopyfast-verification-${verificationCode}.txt`,
    content: `ReCopyFast Domain Verification\nVerification Code: ${verificationCode}\nGenerated: ${new Date().toISOString()}`,
  };
}

/** Where the owner has to serve the file, relative to their domain root. */
export function fileVerificationPath(verificationCode: string): string {
  return `/.well-known/${generateFileVerificationContent(verificationCode).filename}`;
}

const VERIFICATION_LABEL = "verification code:";

/**
 * Does this file body actually DECLARE the verification code?
 *
 * Not a substring search. The code appears in the URL we fetch
 * (`/.well-known/recopyfast-verification-<code>.txt`), so any domain whose 404
 * page or SPA fallback echoes the requested path back into the body contains
 * the code without the owner having uploaded anything — a plain `includes`
 * would verify a domain for someone who merely pointed a hostname at it.
 *
 * So the code has to appear where the file we issued puts it: on its own line,
 * behind the `Verification Code:` label. A reflected path cannot satisfy that.
 *
 * Whole-body equality would be stricter still, and is what this replaced — but
 * the body we generate embeds `Generated: <ISO timestamp>`, so equality against
 * a regenerated copy could never match and the method was impossible to
 * complete for anybody. Matching the labelled line keeps the strength that
 * mattered and drops the part that made it unusable, while tolerating the
 * trailing newline and CRLF that real editors and static hosts add.
 *
 * The LABEL is matched case-insensitively; the CODE is not. The label is
 * decoration a human may retype in their own casing, but the code is the
 * secret being proved, and folding its case would accept a value the owner was
 * never issued — collapsing the space an attacker must search and letting a
 * near-miss transcription verify a domain. Codes are generated as hex, so a
 * correctly copied file is unaffected.
 */
export function fileDeclaresCode(
  body: string,
  verificationCode: string,
): boolean {
  const expectedCode = verificationCode.trim();

  return body.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    if (!trimmed.toLowerCase().startsWith(VERIFICATION_LABEL)) {
      return false;
    }
    return trimmed.slice(VERIFICATION_LABEL.length).trim() === expectedCode;
  });
}
