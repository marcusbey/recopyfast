export const MAX_REDACTED_DIAGNOSTIC_LENGTH = 1600;

/**
 * Redact every credential/identity shape the browser fixtures can place in an
 * error while retaining constraint names and provider error text. The caller
 * chooses a smaller limit when it needs room for a trusted prefix.
 */
export function redactDiagnostic(
  value: string,
  maxLength = MAX_REDACTED_DIAGNOSTIC_LENGTH,
): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(
      /\bhttps:\/\/checkout\.stripe\.com\/[^\s"'<>]*/gi,
      "[REDACTED CHECKOUT URL]",
    )
    .replace(/\bhttps?:\/\/[^\s"'<>?]+\?[^\s"'<>]*/gi, "[REDACTED URL]")
    .replace(/authorization:\s*bearer\s+\S+/gi, "authorization: [REDACTED]")
    .replace(
      /(\b(?:SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY|STRIPE_[A-Z0-9_]*(?:KEY|SECRET)|service[_-]?role[_-]?key|anon[_-]?key|api[_-]?key|site[_-]?token|rcf_(?:edit_)?token|verification[_-]?code|raw\s+token|token|secret|authorization)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      "$1[REDACTED]",
    )
    .replace(
      /([?&](?:rcf_(?:edit_)?token|token|code|key|secret|authorization)=)[^&\s>"']+/gi,
      "$1[REDACTED]",
    )
    .replace(/\brcf_(?:edit_)?token=[^&\s>"']+/gi, "credential=[REDACTED]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[REDACTED JWT]",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.\d{9,}\.[a-f0-9]{32,}\b/gi,
      "[REDACTED SITE TOKEN]",
    )
    .replace(/\bsb_secret_[A-Za-z0-9_-]+\b/g, "[REDACTED SECRET]")
    .replace(
      /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]+\b/g,
      "[REDACTED STRIPE KEY]",
    )
    .replace(/\bwhsec_[A-Za-z0-9_-]+\b/g, "[REDACTED WEBHOOK SECRET]")
    .replace(
      /\bcs_(?:test|live)_[A-Za-z0-9_-]*secret[A-Za-z0-9_-]*\b/gi,
      "[REDACTED CHECKOUT SECRET]",
    )
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[REDACTED CARD]")
    .replace(
      /(\b(?:card[_ -]?exp(?:iry|iration)?|expiry|expiration)\b\s*[:=]\s*)(?:\d{1,2}\s*\/\s*\d{2,4}|\d{3,4})/gi,
      "$1[REDACTED]",
    )
    .replace(
      /(\b(?:card[_ -]?(?:cvc|cvv)|cvc|cvv)\b\s*[:=]\s*)\d{3,4}/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(?:e2e|parity)_(?:key|staging|edit)_[A-Za-z0-9_-]+\b/gi,
      "[REDACTED]",
    )
    .replace(/\b\d{6}\b/g, "[REDACTED CODE]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED EMAIL]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[REDACTED UUID]",
    )
    .replace(/\b[a-f0-9]{32,}\b/gi, "[REDACTED DIGEST]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(0, maxLength));
}
