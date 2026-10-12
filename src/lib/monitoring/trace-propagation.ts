/**
 * Where the server and Edge Sentry SDKs may attach `sentry-trace`, `baggage`
 * and `traceparent` to an outgoing request (s96).
 *
 * WHY. With `tracePropagationTargets` unset, @sentry/nextjs v10 on Node attaches
 * trace headers to EVERY outgoing `http.request` while a transaction is
 * sampled (verified in node_modules/@sentry/core 10.58:
 * `shouldPropagateTraceForUrl` returns true when the option is undefined). The
 * free tools' scanner makes `http.request` calls to sites a stranger named, so
 * those sites would receive our trace and release identifiers. So the targets
 * are our own origins only: the app and the realtime service.
 *
 * As RegExps anchored at the origin, never bare strings: Sentry matches a
 * string target as a SUBSTRING, so "https://www.recopyfa.st" would also match
 * "https://www.recopyfa.st.evil.example/…".
 */

type Environment = Record<string, string | undefined>;

function originOf(raw: string | undefined): string | null {
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

export function tracePropagationTargets(env: Environment): RegExp[] {
  const origins = new Set<string>();
  for (const raw of [env.NEXT_PUBLIC_APP_URL, env.NEXT_PUBLIC_WS_URL]) {
    const origin = originOf(raw);
    if (!origin) continue;
    origins.add(origin);
    // The realtime service is configured as wss:// but reached over https too.
    if (origin.startsWith("wss://"))
      origins.add(origin.replace(/^wss:/, "https:"));
    if (origin.startsWith("ws://"))
      origins.add(origin.replace(/^ws:/, "http:"));
  }
  return Array.from(origins).map(
    (origin) => new RegExp(`^${escapeForRegExp(origin)}(?:[/?#]|$)`),
  );
}
