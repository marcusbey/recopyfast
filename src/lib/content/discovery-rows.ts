import { normalizePagePath } from "@/lib/content/page-path";
import {
  redactControlCharacters,
  validateDiscoveredElement,
  validateElementId,
} from "@/lib/security/discovered-text";

export interface DiscoveryContentElementRow {
  site_id: string;
  element_id: string;
  selector: string;
  original_content: string;
  current_content: string;
  published_content: string | null;
  language: string;
  variant: string;
  page_path: string | null;
  metadata: Record<string, unknown>;
}

export interface SkippedDiscoveryElement {
  elementId: string;
  reason: string;
}

type DiscoveryRows =
  | {
      ok: true;
      rows: DiscoveryContentElementRow[];
      skipped: SkippedDiscoveryElement[];
    }
  | { ok: false; error: string };

const MAX_ECHOED_ID_LENGTH = 64;

function idExcerpt(elementId: string): string {
  const safe = redactControlCharacters(elementId);
  return safe.length > MAX_ECHOED_ID_LENGTH
    ? `${safe.slice(0, MAX_ECHOED_ID_LENGTH)}...`
    : safe;
}

/**
 * Convert a public-token discovery report into private candidate rows.
 *
 * H2's October 2026 follow-up found that the publish RPC merges existing
 * metadata when an editor publishes text without touching attributes. The
 * site token and Origin are forgeable outside a browser, so href and alt must
 * never enter this row: otherwise a later text-only publish promotes them.
 */
export function buildDiscoveryRows(
  siteId: string,
  contentMap: unknown,
): DiscoveryRows {
  if (
    typeof contentMap !== "object" ||
    contentMap === null ||
    Array.isArray(contentMap)
  ) {
    return { ok: false, error: "Content map must be an object" };
  }

  const rows: DiscoveryContentElementRow[] = [];
  const skipped: SkippedDiscoveryElement[] = [];

  for (const [elementId, data] of Object.entries(contentMap)) {
    const id = validateElementId(elementId);
    if (!id.ok) {
      skipped.push({ elementId: idExcerpt(elementId), reason: id.error });
      continue;
    }

    const element = validateDiscoveredElement(data);
    if (!element.ok) {
      skipped.push({ elementId: id.value, reason: element.error });
      continue;
    }

    const reported = data as Record<string, unknown>;
    let pagePath: string | null = null;
    if (reported.page_path !== undefined && reported.page_path !== null) {
      const path = normalizePagePath(reported.page_path);
      if (!path.ok) {
        skipped.push({ elementId: id.value, reason: path.error });
        continue;
      }
      pagePath = path.value;
    }

    rows.push({
      site_id: siteId,
      element_id: id.value,
      selector: element.value.selector,
      original_content: element.value.content,
      current_content: element.value.content,
      published_content: null,
      language: "en",
      variant: "default",
      page_path: pagePath,
      metadata: {
        ...(element.value.type ? { type: element.value.type } : {}),
      },
    });
  }

  return { ok: true, rows, skipped };
}
