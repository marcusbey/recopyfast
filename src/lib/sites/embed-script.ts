export interface BuildEmbedScriptParams {
  siteId: string;
  siteToken: string;
  appUrl?: string;
  wsUrl?: string;
}

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

export function getPublicAppUrl() {
  return normalizeOrigin(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
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
