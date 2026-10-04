import {
  STABLE_COPY_BOOTSTRAP_SCRIPT_HASH,
  STABLE_COPY_BOOTSTRAP_SOURCE,
  STABLE_COPY_GATE_STYLE_HASH,
} from "./stable-copy-bootstrap.generated";

export interface BuildEmbedScriptParams {
  siteId: string;
  siteToken: string;
  appUrl?: string;
  wsUrl?: string;
}

export interface BuildStableEmbedInstallationParams
  extends BuildEmbedScriptParams {
  /**
   * A CSP nonce supplied by the host application. It is copied to both script
   * placements and to the gate style created by the bootstrap.
   */
  nonce?: string;
}

export interface StableEmbedInstallation {
  headBootstrap: string;
  runtimeTag: string;
  protocolVersion: string;
  csp: {
    scriptHash: string;
    styleHash: string;
    scriptSource: string;
    connectSources: string[];
  };
}

export const STABLE_COPY_PROTOCOL_VERSION = "2";

/**
 * Generated native head bootstrap for the stable-copy startup protocol.
 *
 * Keep this classic ES2018 script self-contained: it runs while the HTML parser
 * is still in <head>, before a framework runtime or the external widget exists.
 * The external runtime consumes the state object it creates; it must not copy
 * path normalization, eligibility, request, or deadline policy.
 */

function normalizeOrigin(value: string) {
  return value.replace(/\/+$/, "");
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function nonceAttribute(nonce?: string) {
  return nonce ? ` nonce="${escapeAttribute(nonce)}"` : "";
}

function websocketConnectSource(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") url.protocol = "wss:";
    else if (url.protocol === "http:") url.protocol = "ws:";
    else if (url.protocol !== "ws:" && url.protocol !== "wss:") return "";
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

/**
 * The apex host 308s to www. Browser CORS preflights cannot follow that
 * redirect, so a snippet that points at recopyfa.st makes the widget look
 * dead on every customer site (B-11). Rewrite only that exact hostname;
 * previews, localhost, and an already-canonical www stay as configured.
 */
const CANONICAL_APEX_HOST = "recopyfa.st";
const CANONICAL_WWW_HOST = "www.recopyfa.st";

export function canonicalizePublicAppUrl(origin: string): string {
  try {
    const url = new URL(origin.includes("://") ? origin : `https://${origin}`);
    if (url.hostname.toLowerCase() === CANONICAL_APEX_HOST) {
      url.hostname = CANONICAL_WWW_HOST;
      return normalizeOrigin(url.toString());
    }
  } catch {
    // An unparseable value is returned unchanged; callers already tolerate that.
  }
  return origin;
}

export function getPublicAppUrl() {
  return canonicalizePublicAppUrl(
    normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  );
}

/**
 * The websocket origin to hand the widget, or `""` when there is none.
 *
 * Real-time is opt-in in the widget: it reads `data-ws-url`, and finding
 * nothing it sets no endpoint and returns before downloading socket.io at all
 * (public/embed/recopyfast.src.js). Falling back to the app origin defeated
 * that — `RECOPYFAST_WS` came out truthy on every install, the early return
 * never fired, and `io()` retried forever against an origin that serves no
 * Socket.IO endpoint, because `server/index.js` is a separate Express process
 * Vercel cannot host.
 *
 * So an unconfigured websocket now reports itself as unconfigured. The empty
 * string is the "off" value: `buildEmbedScript` omits the attribute for it,
 * which is the only way to leave `window.RECOPYFAST_WS` unset.
 */
export function getPublicWebSocketUrl(appUrl = getPublicAppUrl()): string {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return normalizeOrigin(process.env.NEXT_PUBLIC_WS_URL);
  }

  try {
    const url = new URL(appUrl);
    // `npm run dev` really does start server/index.js on :4001, so this one
    // fallback resolves to something that answers.
    if (url.hostname === "localhost" && url.port === "3000") {
      url.port = "4001";
      return normalizeOrigin(url.toString());
    }
  } catch {
    // An unparseable app URL tells us nothing about a websocket either.
  }

  return "";
}

export function buildEmbedScript({
  siteId,
  siteToken,
  appUrl = getPublicAppUrl(),
  wsUrl,
}: BuildEmbedScriptParams) {
  const appOrigin = normalizeOrigin(appUrl);
  const wsOrigin = normalizeOrigin(wsUrl ?? getPublicWebSocketUrl(appUrl));

  // Omitted rather than emitted empty: an attribute pointing nowhere is still
  // an attribute, and the widget's opt-in check is `if (!RECOPYFAST_WS) return`.
  const wsAttribute = wsOrigin
    ? ` data-ws-url="${escapeAttribute(wsOrigin)}"`
    : "";
  return `<script src="${escapeAttribute(appOrigin)}/embed/recopyfast.js" data-site-id="${escapeAttribute(siteId)}" data-site-token="${escapeAttribute(siteToken)}" data-api-url="${escapeAttribute(appOrigin)}/api"${wsAttribute}></script>`;
}

/**
 * Build the supported two-placement installation.
 *
 * `buildEmbedScript` remains unchanged for snippets already stored or copied.
 * New installation surfaces use this object so a framework cannot accidentally
 * put the head bootstrap at the external runtime's body-safe placement.
 */
export function buildStableEmbedInstallation({
  siteId,
  siteToken,
  appUrl = getPublicAppUrl(),
  wsUrl,
  nonce,
}: BuildStableEmbedInstallationParams): StableEmbedInstallation {
  const appOrigin = normalizeOrigin(appUrl);
  const apiUrl = `${appOrigin}/api`;
  const wsOrigin = normalizeOrigin(wsUrl ?? getPublicWebSocketUrl(appUrl));
  const wsAttribute = wsOrigin
    ? ` data-ws-url="${escapeAttribute(wsOrigin)}"`
    : "";
  const socketSource = wsOrigin ? websocketConnectSource(wsOrigin) : "";
  const connectSources = socketSource
    ? Array.from(new Set([appOrigin, socketSource]))
    : [appOrigin];
  const shared =
    ` data-rcf-startup="${STABLE_COPY_PROTOCOL_VERSION}"` +
    ` data-site-id="${escapeAttribute(siteId)}"` +
    ` data-site-token="${escapeAttribute(siteToken)}"` +
    ` data-api-url="${escapeAttribute(apiUrl)}"`;
  const nonceValue = nonceAttribute(nonce);

  return {
    protocolVersion: STABLE_COPY_PROTOCOL_VERSION,
    headBootstrap: `<script${shared}${nonceValue}>${STABLE_COPY_BOOTSTRAP_SOURCE}</script>`,
    runtimeTag: `<script src="${escapeAttribute(appOrigin)}/embed/recopyfast.js"${shared}${wsAttribute}${nonceValue}></script>`,
    csp: {
      scriptHash: STABLE_COPY_BOOTSTRAP_SCRIPT_HASH,
      styleHash: STABLE_COPY_GATE_STYLE_HASH,
      scriptSource: appOrigin,
      connectSources,
    },
  };
}
