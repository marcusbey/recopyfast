import { notFound } from "next/navigation";

/**
 * Every URL under /edit that matches no page lands here and renders Next's
 * noindex not-found boundary (s79 review F1, ADR 059).
 *
 * Without it, Next served such a URL its prebuilt `/_not-found` page: static,
 * so it carries no nonce, but sent under this segment's nonce policy — every
 * script was refused and the 404 never hydrated. Living below the segment's
 * layout, which awaits `connection()`, this page renders the same boundary per
 * request, with the nonce. Keep it for as long as /edit is in
 * `NONCE_POLICY_PATH_PREFIXES` (`src/lib/security/content-security-policy.ts`);
 * pinned by `src/__tests__/security/nonce-routes-render-dynamically.test.tsx`.
 */
export default function MissingEditPage(): never {
  notFound();
}
