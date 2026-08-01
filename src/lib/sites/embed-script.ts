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

export function getPublicWebSocketUrl(appUrl = getPublicAppUrl()) {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return normalizeOrigin(process.env.NEXT_PUBLIC_WS_URL);
  }

  try {
    const url = new URL(appUrl);
    if (url.hostname === "localhost" && url.port === "3000") {
      url.port = "4001";
      return normalizeOrigin(url.toString());
    }
  } catch {
    // Fall through to app origin fallback below.
  }

  return normalizeOrigin(appUrl);
}

export function buildEmbedScript({
  siteId,
  siteToken,
  appUrl = getPublicAppUrl(),
  wsUrl = getPublicWebSocketUrl(appUrl),
}: BuildEmbedScriptParams) {
  const appOrigin = normalizeOrigin(appUrl);
  const wsOrigin = normalizeOrigin(wsUrl);

  return `<script src="${escapeAttribute(appOrigin)}/embed/recopyfast.js" data-site-id="${escapeAttribute(siteId)}" data-site-token="${escapeAttribute(siteToken)}" data-api-url="${escapeAttribute(appOrigin)}/api" data-ws-url="${escapeAttribute(wsOrigin)}"></script>`;
}
