/**
 * The public projection of `content_elements` — the one allow-list for copy a
 * visitor may read without any credential (s65a, ADR 046).
 *
 * Until s65a the only public read was the widget-authorized
 * `GET /api/content/[siteId]`, which builds its rows inline (`route.ts:393-444`).
 * The unauthenticated snapshot route serves the same rows to anyone who names a
 * site id, so the projection has to be exactly that one, not "roughly the
 * same": a column added here is a column published to the internet. The
 * content GET adopts this helper in s65c; until then the parity test in
 * `src/__tests__/api/published/` and the byte-equality test beside this file
 * are what stop the two from drifting.
 *
 * Ported from s62's cache allow-list (`publicRow` / `validateRows` /
 * `PRIVATE_ROW_FIELDS`, PR #61, never merged): rows are REBUILT from named
 * fields rather than spread, so a widened select cannot leak a column through
 * this helper, and a row that carries a staging or publisher column refuses the
 * whole result instead of being trimmed. A refusal means the query itself is
 * wrong; serving the rest of the page would hide that.
 */

/**
 * Byte-identical to both selects in `GET /api/content/[siteId]`. `current_content`
 * is deliberately absent: it is computed below, because the stored column is
 * the editor's working value, not what visitors see.
 */
export const PUBLIC_CONTENT_COLUMNS =
  "id, site_id, element_id, selector, published_content, original_content, language, variant, page_path, metadata, published_at";

/** Columns that must never reach an unauthenticated reader. */
const PRIVATE_ROW_FIELDS = [
  "staging_content",
  "staging_updated_at",
  "published_by",
] as const;

/** A row as PostgREST returns it for `PUBLIC_CONTENT_COLUMNS`. */
export interface PublicContentSourceRow {
  id: string | number;
  site_id: string;
  element_id: string;
  selector: string;
  published_content: string | null;
  original_content: string | null;
  language: string;
  variant: string;
  page_path: string | null;
  metadata: unknown;
  published_at: string | null;
}

/** A row as a visitor receives it. */
export interface PublicContentRow {
  id: string | number;
  site_id: string;
  element_id: string;
  selector: string;
  published_content: string | null;
  original_content: string | null;
  language: string;
  variant: string;
  page_path: string | null;
  metadata: Record<string, unknown>;
  published_at: string | null;
  current_content: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function carriesPrivateField(row: PublicContentSourceRow): boolean {
  return PRIVATE_ROW_FIELDS.some((field) => field in row);
}

/**
 * Draft attributes share the metadata JSONB column with published ones, but
 * they are private to staging until the atomic publish promotes them. Removing
 * the nested patch keeps a visitor from learning or applying a destination an
 * editor has not published yet. Every other key is served whole, exactly as the
 * content GET serves it (`translatedFrom`, `aiGenerated`, `tokensUsed`
 * included); tightening that is a separate decision, not one made here.
 */
function publishedMetadata(metadata: unknown): Record<string, unknown> {
  if (!isRecord(metadata)) return {};
  const published = { ...metadata };
  delete published.staging_attributes;
  return published;
}

function toPublicRow(row: PublicContentSourceRow): PublicContentRow {
  return {
    id: row.id,
    site_id: row.site_id,
    element_id: row.element_id,
    selector: row.selector,
    published_content: row.published_content,
    original_content: row.original_content,
    language: row.language,
    variant: row.variant,
    page_path: row.page_path,
    metadata: publishedMetadata(row.metadata),
    published_at: row.published_at,
    current_content: row.published_content ?? row.original_content ?? "",
  };
}

/**
 * Map database rows to visitor rows, or `null` when any row carries a private
 * column. The caller must treat `null` as a server fault and serve nothing.
 */
export function toPublicRows(
  rows: readonly PublicContentSourceRow[],
): PublicContentRow[] | null {
  if (rows.some(carriesPrivateField)) return null;
  return rows.map(toPublicRow);
}
