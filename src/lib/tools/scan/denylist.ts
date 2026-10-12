/**
 * The operator's host denylist (`TOOLS_SCAN_DENYLIST`, s96).
 *
 * A site owner's first opt-out is robots.txt, which the scanner honours for its
 * own user agent (architect decision 3, 2026-10-11). This list is the operator
 * override behind it: a host whose owner asked us directly, or one being used
 * to reflect traffic. A listed host also blocks its subdomains — a site owner
 * means "my site", not one label of it — but never a look-alike suffix:
 * `evilexample.com` is not a subdomain of `example.com`.
 *
 * Entries are read the way the scanner normalises a URL (lower case, punycode,
 * no trailing dot), so the comparison is string equality on both sides.
 * Anything that does not parse as a bare hostname is dropped, not guessed at.
 */

function normalizeEntry(raw: string): string | null {
  const trimmed = raw
    .trim()
    .toLowerCase()
    .replace(/^\*?\.+/, "")
    .replace(/\.+$/, "");
  if (!trimmed || /[\s/@:?#]/.test(trimmed)) return null;
  try {
    return new URL(`http://${trimmed}/`).hostname;
  } catch {
    return null;
  }
}

export function parseDenylist(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  const entries = raw
    .split(",")
    .map(normalizeEntry)
    .filter((entry): entry is string => entry !== null);
  return Array.from(new Set(entries));
}

export function isDenylistedHost(
  hostname: string,
  denylist: readonly string[],
): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  return denylist.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/** The denylist as configured for this deployment. */
export function configuredDenylist(): readonly string[] {
  return parseDenylist(process.env.TOOLS_SCAN_DENYLIST);
}
