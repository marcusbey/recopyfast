/**
 * "Send this to your developer" (s120): the message a site owner sends, from
 * their own mailbox, asking their developer to paste the install snippet once.
 *
 * WHAT THIS MESSAGE MAY CONTAIN — ONLY WHAT THE PAGE WILL PUBLISH ANYWAY.
 * Once installed, the embed tag sits in the site's public HTML: its site id and
 * site token are visible to every visitor by design, and the token only works
 * from the registered origin (ADR 027 — no age cap, revoked by rotating
 * `sites.api_key`). So the tag itself is safe to email. Nothing else with
 * authority is:
 *
 * - never `sites.api_key` (the HMAC secret behind every site token — the
 *   registration response carries it, and it must stay in the dashboard);
 * - never an editor-entry URL: `rcf_handoff`, `rcf_staging` + `rcf_token`,
 *   or the owner's `#rcf_edit=` code (s76, ADR 055 — the "Edit website" link
 *   carries no reusable credential, and this message must not become one);
 * - never a link to `/edit`, a session, a magic link or a dashboard URL.
 *
 * Two structural guards enforce that rather than trusting the caller:
 * `parseEmbedScript` accepts exactly the tag `buildEmbedScript` produces (no
 * extra attribute can smuggle anything in), and `findCredentialMaterial` scans
 * the finished text for every credential shape above. A message that fails
 * either is refused, never sent half-checked.
 *
 * MAILTO LIMITS. Mail clients and OSes truncate long `mailto:` URLs silently
 * (around 2,000 characters is the widely safe ceiling). The full message,
 * percent-encoded, is longer than that, so "Open in my email app" falls back
 * to a short body — the snippet and the guide link — and tells the owner to
 * paste the full message they copied. When even that would not fit, the draft
 * carries the subject only (`mailtoBody: "none"`) and the owner pastes the
 * whole message. A truncated snippet would be a broken install, which is worse
 * than a short email.
 */

export const MAX_MAILTO_HREF_LENGTH = 2000;

export const DEVELOPER_GUIDE_PATH = "/docs/install/for-developers";
export const WORDPRESS_GUIDE_PATH = "/docs/install/wordpress";

export interface DeveloperHandoffInput {
  /** The exact tag the dashboard generated for this site. */
  embedScript: string;
  /** The registered hostname, e.g. "www.example.com". */
  siteDomain: string;
}

/**
 * What the `mailto:` draft carries: the whole message, the short body (snippet
 * + guide link), or the subject only. Anything but "full" means the owner
 * pastes the copied message into the email.
 */
export type MailtoBody = "full" | "short" | "none";

export interface DeveloperHandoffMessage {
  subject: string;
  body: string;
  mailtoHref: string;
  mailtoBody: MailtoBody;
}

export type DeveloperHandoffFailureReason =
  | "invalid_snippet"
  | "invalid_domain"
  | "credential_detected";

export type DeveloperHandoffResult =
  | { ok: true; message: DeveloperHandoffMessage }
  | { ok: false; reason: DeveloperHandoffFailureReason };

interface ParsedEmbedScript {
  script: string;
  appOrigin: string;
}

const ATTRIBUTE_VALUE = '[^"<>\\s]+';

/**
 * The one shape `buildEmbedScript` emits (src/lib/sites/embed-script.ts),
 * attribute order included. Anything else — an extra attribute, a second tag,
 * a placeholder from the docs — is not a snippet we generated.
 */
const EMBED_SCRIPT_PATTERN = new RegExp(
  `^<script src="(https?://[^"<>\\s/]+)/embed/recopyfast\\.js" data-site-id="${ATTRIBUTE_VALUE}" data-site-token="${ATTRIBUTE_VALUE}" data-api-url="(https?://[^"<>\\s/]+)/api"(?: data-ws-url="wss?://${ATTRIBUTE_VALUE}")?></script>$`,
);

export function parseEmbedScript(
  embedScript: string,
): ParsedEmbedScript | null {
  const script = embedScript.trim();
  const match = EMBED_SCRIPT_PATTERN.exec(script);
  if (!match) return null;
  const [, scriptOrigin, apiOrigin] = match;
  // One deployment issues both: a tag whose API points elsewhere is not ours.
  if (scriptOrigin !== apiOrigin) return null;
  return { script, appOrigin: scriptOrigin };
}

/** A registered hostname (optionally with a port), lowercase. */
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

function normalizeSiteDomain(domain: string): string | null {
  const candidate = domain.trim().toLowerCase();
  return HOSTNAME_PATTERN.test(candidate) ? candidate : null;
}

/**
 * Every credential shape that must never leave the dashboard in this message.
 * Exported so the tests (and any future caller) check the same list.
 */
export const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  // Editor-entry credentials (installation-content.ts, analytics section).
  /rcf_(?:handoff|staging|token|edit)/i,
  /[?&#]rcf_/i,
  // The editor hub, auth callbacks and the dashboard: links, not snippets.
  /https?:\/\/[^\s"]+\/(?:edit|auth|dashboard|login)(?:[/?#\s"]|$)/i,
  // Session and API credentials of any provider.
  /\b(?:access|refresh)_token\b/i,
  /service_role/i,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]/,
  /\bwhsec_[A-Za-z0-9]/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  // `sites.api_key` named as a field, parameter or header (api_key=,
  // "apiKey":, X-Api-Key:). Not when it is a hostname label: the registered
  // domain is in every message, and "api-key.example" or "apikey.example:8080"
  // is somebody's site, not a secret.
  /\bapi[_-]?key\b(?![.-]|:\d)/i,
];

export function findCredentialMaterial(text: string): RegExp | null {
  return CREDENTIAL_PATTERNS.find((pattern) => pattern.test(text)) ?? null;
}

function buildSubject(domain: string): string {
  return `Could you add one line to ${domain}? (ReCopyFast)`;
}

function buildFullBody(
  domain: string,
  script: string,
  appOrigin: string,
): string {
  const developerGuide = `${appOrigin}${DEVELOPER_GUIDE_PATH}`;
  const wordpressGuide = `${appOrigin}${WORDPRESS_GUIDE_PATH}`;
  return [
    "Hi,",
    "",
    `I'd like to update the everyday text on ${domain} myself — opening hours, prices, specials — without sending you a request each time. I've set up ReCopyFast for it: a small script that lets me click existing text on the live site and change it. It can't change the layout, the code or the design.`,
    "",
    "Could you add this one line to the site, once? The site-wide footer (just before </body>) is ideal, so it runs on every page I should be able to edit:",
    "",
    script,
    "",
    "Where to paste it:",
    `- WordPress: the free WPCode plugin, Code Snippets > Header & Footer > Footer box > Save Changes. Step by step: ${wordpressGuide}`,
    "- Webflow: Site settings > Custom code > Footer code, save, then publish the site.",
    "- Framer: Site settings > Custom Code > add the script at the end of <body>, then publish.",
    "- Custom or static site: paste it before </body> in the shared layout or footer, then deploy.",
    '- React / Next.js: load it after hydration (e.g. next/script with strategy="afterInteractive") and keep every attribute.',
    "",
    "Security, in three lines:",
    `- The site id and token in the tag are public by design: they end up in the page's HTML and only work from ${domain}.`,
    "- You don't need to share any password or hosting access with anyone, and neither do I.",
    "- It only replaces text I publish. Remove the line and the site goes back to its own copy.",
    "",
    `What it does, CSP, how to verify and how to remove it: ${developerGuide}`,
    "",
    'Thanks! A quick "done" reply when it\'s in would be great.',
  ].join("\n");
}

function buildShortBody(script: string, appOrigin: string): string {
  return [
    "Hi,",
    "",
    "Could you add this one line to the site, once, just before </body> (site-wide footer)?",
    "",
    script,
    "",
    `Developer guide: ${appOrigin}${DEVELOPER_GUIDE_PATH}`,
    "",
    "[Paste the full message you copied from ReCopyFast here.]",
  ].join("\n");
}

/** RFC 6068: line breaks in a mailto body are CRLF, percent-encoded. */
function buildMailtoHref(subject: string, body?: string): string {
  const query = [`subject=${encodeURIComponent(subject)}`];
  if (body !== undefined) {
    query.push(`body=${encodeURIComponent(body.replace(/\r?\n/g, "\r\n"))}`);
  }
  return `mailto:?${query.join("&")}`;
}

export function buildDeveloperHandoffMessage(
  input: DeveloperHandoffInput,
): DeveloperHandoffResult {
  const parsed = parseEmbedScript(input.embedScript);
  if (!parsed) return { ok: false, reason: "invalid_snippet" };

  const domain = normalizeSiteDomain(input.siteDomain);
  if (!domain) return { ok: false, reason: "invalid_domain" };

  const subject = buildSubject(domain);
  const body = buildFullBody(domain, parsed.script, parsed.appOrigin);

  let mailtoHref = buildMailtoHref(subject, body);
  let mailtoBody: MailtoBody = "full";
  if (mailtoHref.length > MAX_MAILTO_HREF_LENGTH) {
    mailtoBody = "short";
    mailtoHref = buildMailtoHref(
      subject,
      buildShortBody(parsed.script, parsed.appOrigin),
    );
    if (mailtoHref.length > MAX_MAILTO_HREF_LENGTH) {
      // Even the short body would be cut: open a subject-only draft rather
      // than one carrying a truncated (broken) snippet.
      mailtoBody = "none";
      mailtoHref = buildMailtoHref(subject);
    }
  }

  // Last line of defence: whatever changes above, a credential never leaves.
  if (findCredentialMaterial(`${subject}\n${body}\n${mailtoHref}`)) {
    return { ok: false, reason: "credential_detected" };
  }

  return {
    ok: true,
    message: { subject, body, mailtoHref, mailtoBody },
  };
}

/** The full message as one pasteable block, subject line first. */
export function formatDeveloperHandoffForCopy(
  message: DeveloperHandoffMessage,
): string {
  return `Subject: ${message.subject}\n\n${message.body}`;
}
