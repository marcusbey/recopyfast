import { INSTALLATION_EXAMPLE } from "@/lib/docs/installation-content";

/**
 * The CSP sources the snippet needs (s120 developer guide), read off the same
 * example the install guide renders — which `buildEmbedScript` produces — and
 * never typed by hand: if the canonical host or the websocket host moves, the
 * guide moves with it.
 */
export const DEVELOPER_GUIDE_CSP_LINES: readonly string[] = [
  `script-src ${INSTALLATION_EXAMPLE.appUrl}`,
  `connect-src ${INSTALLATION_EXAMPLE.appUrl} ${INSTALLATION_EXAMPLE.wsUrl}`,
];
