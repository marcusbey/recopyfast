import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BulkImportPayload,
  BulkImportResults,
  BulkImportRowResult,
  ContentElementMetadata,
} from "@/types";
import { v4 as uuidv4 } from "uuid";
import { validateVerbatimText } from "@/lib/security/discovered-text";
import { parseCSV } from "@/lib/bulk/csv";
import { MAX_IMPORT_BYTES, MAX_IMPORT_LABEL } from "@/lib/bulk/constants";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import {
  optionalBoolean,
  requireEnum,
  requireString,
  type ValidationResult,
} from "@/lib/api/validation";

export async function POST(req: NextRequest) {
  try {
    // Rate limit before authorization, per AGENTS.md: the permission check
    // below costs a `site_permissions` lookup, so a limiter placed behind it
    // never sees the flood it exists to stop. Above the body read as well —
    // this endpoint accepts a multi-megabyte body (`MAX_IMPORT_BYTES`), and the
    // cheapest refusal is the one that never reads the stream.
    //
    // `deny` on store failure: the batch this admits writes `content_elements`
    // in a loop and ends in a SECURITY DEFINER service-role RPC. Losing Redis
    // must not silently remove the only thing metering that.
    const limited = await enforceRateLimit(req, {
      limit: "API_UPLOAD",
      endpoint: "bulk/import",
      onStoreFailure: "deny",
    });
    if (limited) return limited;

    // Read the body as text and measure it before anything parses it. The
    // acceptance criterion is "refused before parsing", so the check cannot sit
    // after `req.json()` — and it cannot trust `Content-Length` either, which
    // is a client-supplied number that says whatever the client wants. Only the
    // bytes actually read count.
    const rawBody = await req.text();
    const bodyBytes = Buffer.byteLength(rawBody, "utf8");

    if (bodyBytes > MAX_IMPORT_BYTES) {
      return NextResponse.json(
        {
          error: `Import file is too large. The limit is ${MAX_IMPORT_LABEL}; split the file and try again.`,
        },
        { status: 413 },
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Request body is not valid JSON" },
        { status: 400 },
      );
    }

    const payload = readImportPayload(parsedBody);
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: 400 });
    }
    const { site_id, format, data, options } = payload.value;

    // Verify user authentication and permissions
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => req.cookies.get(name)?.value,
          set: () => {},
          remove: () => {},
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check site permissions
    const { data: permission } = await supabase
      .from("site_permissions")
      .select("permission")
      .eq("site_id", site_id)
      .eq("user_id", user.id)
      .single();

    if (!permission || !["edit", "admin"].includes(permission.permission)) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    // Create bulk operation record
    const operationId = uuidv4();
    const { error: operationError } = await supabase
      .from("bulk_operations")
      .insert({
        id: operationId,
        user_id: user.id,
        site_id,
        operation_type: "import",
        status: "running",
        configuration: { format, options },
        created_at: new Date().toISOString(),
      });

    if (operationError) {
      throw operationError;
    }

    // Process import data based on format
    let parsed: ParsedImport;

    try {
      switch (format) {
        case "json":
          // data is unknown; runtime validation happens inside parseJSONImport
          parsed = parseJSONImport(data);
          break;
        case "csv":
          parsed = parseCSVImport(data);
          break;
        case "xml":
          parsed = parseXMLImport();
          break;
        default:
          throw new FileParseError(`Unsupported format: ${format}`);
      }

      const applied = await applyImportRows(
        parsed.rows,
        site_id,
        options,
        supabase,
      );

      // A row that could not be read fails on its own, at the position it held
      // in the file — the report is only useful if row 37 means line 37.
      const parseFailures: BulkImportRowResult[] = parsed.failures.map(
        (failure) => ({
          row: failure.row,
          elementId: failure.elementId,
          outcome: "failed" as const,
          detail: failure.detail,
        }),
      );

      const rows = [...applied, ...parseFailures].sort((a, b) => a.row - b.row);
      const results = summarise(rows);

      const snapshotError = await snapshotVersion(
        site_id,
        user.email ?? user.id,
        results,
      );

      // Update operation status
      await supabase
        .from("bulk_operations")
        .update({
          status: "completed",
          total_items: results.total,
          processed_items: results.created + results.updated,
          failed_items: results.failed,
          result_data: {
            created: results.created,
            updated: results.updated,
            skipped: results.skipped,
            failed: results.failed,
            rows: results.rows,
            // Recorded rather than swallowed: an import whose snapshot failed
            // is still an import, but "why is there no version for it" has to
            // be answerable afterwards.
            version_snapshot_error: snapshotError,
          },
          completed_at: new Date().toISOString(),
        })
        .eq("id", operationId);

      return NextResponse.json({
        operation_id: operationId,
        status: "completed",
        results,
      });
    } catch (processingError) {
      // Update operation status with error
      await supabase
        .from("bulk_operations")
        .update({
          status: "failed",
          error_log: [
            processingError instanceof Error
              ? processingError.message
              : "Unknown error",
          ],
          completed_at: new Date().toISOString(),
        })
        .eq("id", operationId);

      // A file the server could not read is the caller's problem, and the
      // reason is theirs to act on — "Missing required CSV headers:
      // current_content" tells an owner which column to add. This used to fall
      // through to the 500 below, which answered "Failed to process bulk
      // import" and threw the reason away with it.
      if (processingError instanceof FileParseError) {
        return NextResponse.json(
          { error: processingError.message },
          { status: 400 },
        );
      }

      throw processingError;
    }
  } catch (error) {
    console.error("Bulk import error:", error);
    return NextResponse.json(
      { error: "Failed to process bulk import" },
      { status: 500 },
    );
  }
}

/**
 * One record as the file wrote it.
 *
 * The content fields are `unknown` on purpose: a JSON file can put a number
 * where a string belongs, and the row has to be able to fail with a reason
 * rather than be coerced into one.
 */
interface ParsedElement {
  element_id: string;
  selector: string;
  current_content: unknown;
  /**
   * **Absent when the file carried no `original_content` column at all** — as a
   * three-column file does not, and that is the exact minimum the Import tab
   * advertises. Absent has to stay distinguishable from present-and-empty all
   * the way to the write: see `readContentFields`.
   */
  original_content?: unknown;
  language: string;
  variant: string;
  /** Absent for the same reason and with the same consequence as above. */
  metadata?: ContentElementMetadata;
}

/**
 * One record read out of the file, tagged with where it came from. `row` counts
 * data records, 1-based, in file order: the first JSON array item and the first
 * CSV line *after* the header are both row 1, so the number the report shows
 * means the same thing whichever format the owner exported.
 */
interface ParsedRow {
  row: number;
  element: ParsedElement;
}

/** A record that could not be read. It fails alone; the batch continues. */
interface RowParseFailure {
  row: number;
  elementId: string;
  detail: string;
}

interface ParsedImport {
  rows: ParsedRow[];
  failures: RowParseFailure[];
}

/**
 * A problem with the file as a whole — not a JSON array, a CSV with no
 * `current_content` column, a format the reader does not implement. There is no
 * row to attribute it to, so the file is refused entire and the caller is told
 * which of those it was. Distinct from every other throw in this handler, which
 * is a genuine server fault and still answers 500.
 */
class FileParseError extends Error {}

const REQUIRED_FIELDS = ["element_id", "selector", "current_content"] as const;

const IMPORT_FORMATS = ["json", "csv", "xml"] as const;

/** The column is a uuid in production; fixtures and older rows are not. */
const MAX_SITE_ID_LENGTH = 255;

/**
 * Boundary validation for the request body, per
 * [ADR 003](../../../../../docs/decisions/003-no-schema-validation-library.md):
 * `src/lib/api/validation.ts`, not a schema library.
 *
 * `options` is the one that bit. The handler read
 * `options.create_missing_elements` off the raw body, so a payload without the
 * key threw a TypeError *inside* the batch — after the `bulk_operations` row
 * had already been written as "running" — and surfaced as a 500 on a request
 * that was merely incomplete. Every flag now defaults off, which is the
 * fail-closed reading: an import that says nothing about overwriting does not
 * overwrite.
 */
function readImportPayload(
  parsed: unknown,
): ValidationResult<BulkImportPayload> {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }

  const body = parsed as Record<string, unknown>;

  const siteId = requireString(body, "site_id", {
    maxLength: MAX_SITE_ID_LENGTH,
  });
  if (!siteId.ok) return siteId;

  const format = requireEnum(body, "format", IMPORT_FORMATS);
  if (!format.ok) return format;

  if (body.data === undefined || body.data === null) {
    return { ok: false, error: 'Field "data" is required' };
  }

  const rawOptions = body.options;
  if (
    rawOptions !== undefined &&
    rawOptions !== null &&
    (typeof rawOptions !== "object" || Array.isArray(rawOptions))
  ) {
    return { ok: false, error: 'Field "options" must be a JSON object' };
  }
  const optionsObject = (rawOptions ?? {}) as Record<string, unknown>;

  const overwrite = optionalBoolean(optionsObject, "overwrite_existing", false);
  if (!overwrite.ok) return overwrite;

  const createMissing = optionalBoolean(
    optionsObject,
    "create_missing_elements",
    false,
  );
  if (!createMissing.ok) return createMissing;

  const validateContent = optionalBoolean(
    optionsObject,
    "validate_content",
    false,
  );
  if (!validateContent.ok) return validateContent;

  return {
    ok: true,
    value: {
      site_id: siteId.value,
      format: format.value,
      data: body.data,
      options: {
        overwrite_existing: overwrite.value,
        create_missing_elements: createMissing.value,
        validate_content: validateContent.value,
      },
    },
  };
}

/**
 * Names the fields a row is missing rather than saying "invalid row" — the
 * owner has to be able to fix it without opening a support ticket.
 */
function missingFieldsDetail(missing: string[]): string {
  return `Missing required ${missing.length === 1 ? "field" : "fields"}: ${missing.join(", ")}`;
}

/**
 * Both parsers throw only for whole-file problems — a JSON body that is not an
 * array, a CSV with no required header — because there is no row to attribute
 * those to. Everything a single record can get wrong comes back as a
 * `RowParseFailure` instead.
 *
 * They used to throw on the first bad record, before any per-item error
 * accumulation existed, so one typo in a 400-row export threw the other 399
 * rows away and answered 500.
 */
function parseJSONImport(data: unknown): ParsedImport {
  if (!Array.isArray(data)) {
    throw new FileParseError("JSON data must be an array");
  }

  const rows: ParsedRow[] = [];
  const failures: RowParseFailure[] = [];

  data.forEach((rawItem, index) => {
    const row = index + 1;
    const item = (rawItem ?? {}) as Record<string, unknown>;
    const elementId =
      typeof item["element_id"] === "string" ? item["element_id"] : "";

    const missing = REQUIRED_FIELDS.filter((field) => !item[field]);
    if (missing.length > 0) {
      failures.push({ row, elementId, detail: missingFieldsDetail(missing) });
      return;
    }

    // `null` counts as absent: the JSON export is the raw rows, and both
    // `original_content` and `metadata` are nullable columns, so a file that
    // faithfully records "this was null" must not be read as "blank it".
    const original = item["original_content"];
    const carriesOriginal = original !== undefined && original !== null;
    const metadata = item["metadata"];
    const carriesMetadata = metadata !== undefined && metadata !== null;

    rows.push({
      row,
      element: {
        element_id: item["element_id"] as string,
        selector: item["selector"] as string,
        ...(carriesOriginal ? { original_content: original } : {}),
        current_content: item["current_content"],
        language: (item["language"] as string) || "en",
        variant: (item["variant"] as string) || "default",
        ...(carriesMetadata
          ? { metadata: metadata as ContentElementMetadata }
          : {}),
      },
    });
  });

  return { rows, failures };
}

function parseCSVImport(data: unknown): ParsedImport {
  if (typeof data !== "string") {
    throw new FileParseError("CSV import requires data to be a string");
  }

  const records = parseCSV(data);
  // Header names are trimmed — `element_id, selector` is a plausible thing to
  // hand-write. Values are not: trimming them is what makes a round trip lossy
  // for content that legitimately starts or ends with a space.
  const headers = (records[0] ?? []).map((header) => header.trim());

  const missingHeaders = REQUIRED_FIELDS.filter(
    (header) => !headers.includes(header),
  );

  if (missingHeaders.length > 0) {
    throw new FileParseError(
      `Missing required CSV headers: ${missingHeaders.join(", ")}`,
    );
  }

  const rows: ParsedRow[] = [];
  const failures: RowParseFailure[] = [];

  records.slice(1).forEach((values, index) => {
    const row = index + 1;
    const item: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      item[header] = values[columnIndex] ?? "";
    });

    const missing = REQUIRED_FIELDS.filter((field) => !item[field]);
    if (missing.length > 0) {
      failures.push({
        row,
        elementId: item.element_id ?? "",
        detail: missingFieldsDetail(missing),
      });
      return;
    }

    const metadata = readCSVMetadata(item.metadata);
    if (!metadata.ok) {
      failures.push({
        row,
        elementId: item.element_id,
        detail: metadata.detail,
      });
      return;
    }

    // The header set is what decides presence here: a column the file does not
    // declare leaves its cell undefined, and an empty cell under a declared
    // header is a deliberate empty.
    rows.push({
      row,
      element: {
        element_id: item.element_id,
        selector: item.selector,
        ...(item.original_content === undefined
          ? {}
          : { original_content: item.original_content }),
        current_content: item.current_content,
        language: item.language || "en",
        variant: item.variant || "default",
        ...(metadata.value === undefined ? {} : { metadata: metadata.value }),
      },
    });
  });

  return { rows, failures };
}

type CSVMetadata =
  | { ok: true; value?: ContentElementMetadata }
  | { ok: false; detail: string };

/**
 * One CSV `metadata` cell: the parsed object, "the file did not mention it", or
 * the reason this row cannot be read.
 *
 * The header set decides presence. No declared header at all means the value
 * stays `undefined` and the caller leaves the column out of the write — the same
 * rule `original_content` follows, and for the same reason: absent is the file
 * saying nothing, not the file saying empty. A declared header with an empty
 * cell *is* the file saying empty, so `{}` is written.
 */
function readCSVMetadata(cell: string | undefined): CSVMetadata {
  if (cell === undefined) return { ok: true };
  if (cell === "") return { ok: true, value: {} };

  try {
    return { ok: true, value: JSON.parse(cell) as ContentElementMetadata };
  } catch {
    // One unreadable metadata cell is this row's problem, not the file's.
    return { ok: false, detail: "Metadata is not valid JSON" };
  }
}

function parseXMLImport(): ParsedImport {
  // Export writes XML; import has never read it. The UI refuses to offer XML
  // for import, so this is the last line of defence rather than the first.
  throw new FileParseError("XML import not yet implemented");
}

type ContentFields =
  | { ok: true; current: string; original?: string }
  | { ok: false; detail: string };

/**
 * The two content columns, byte-for-byte, or the reason this row cannot be
 * written.
 *
 * THE CONTENT IS TEXT, NOT MARKUP — do not put a sanitizer back here.
 *
 * These columns hold `element.textContent` scraped off the customer's page. The
 * widget writes them back with `target.textContent = content`
 * (public/embed/recopyfast.src.js:3246) and the dashboard renders them through
 * JSX, which escapes. Nothing on any consumer path interprets the value as
 * HTML, so an HTML sanitizer at this boundary is not protection — it is a
 * silent rewrite of the customer's copy. That is bug A-1
 * (docs/archive/2026-08-07-qa-production-audit.md), removed from the discovery
 * route and made a standing rule by AGENTS.md; the full tombstone is in
 * `src/lib/security/discovered-text.ts`.
 *
 * Import re-introduced it by a different door. Discovery stores
 * "Setup in <2 minutes — Paste the <script> tag" verbatim, an export hands it
 * back unchanged, and `sanitizeHTML(..., "RICH_TEXT")` here turned the
 * re-import into "Setup in &lt;2 minutes — Paste the " — the copy rewritten and
 * its tail deleted, on the one feature whose whole promise is that an export and
 * a re-import change nothing. Refuse the row or store it byte-for-byte; never
 * repair it. If protection is ever needed it belongs at the render boundary,
 * where the value is actually interpreted.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO.
 *
 * **No length ceiling.** `validateVerbatimText(..., null)`, not
 * `validateDiscoveredText`. The 20,000-character bound the latter carries is a
 * rule about discovery, and `content_elements.current_content` is an unbounded
 * `TEXT` that nothing else caps — not `bulk/update`'s set/append, not
 * `staging/content` PUT, not `v1/content` POST. Applying it here would refuse a
 * row the product itself wrote and this feature exported cleanly, which breaks
 * the one promise the story makes: what round-trips today keeps round-tripping.
 * The bound that does apply to an import is `MAX_IMPORT_BYTES`, measured on the
 * whole body before anything parses it.
 *
 * **No blanking of an absent column.** `original_content` comes back
 * `undefined` when the file has no such column, and the caller then leaves it
 * out of the write entirely. A three-column file — element id, selector,
 * current content, the minimum the Import tab advertises — used to write `""`
 * over it, permanently, and that column is the served fallback when
 * `published_content` is null (`api/content/[siteId]/route.ts:308`) and the last
 * `COALESCE` arm in `create_content_version`. An empty *cell* under a declared
 * header is different: that is the file saying "empty", and it is written.
 */
function readContentFields(element: ParsedElement): ContentFields {
  const current = validateVerbatimText(element.current_content, null);
  if (!current.ok) {
    return { ok: false, detail: `current_content: ${current.error}` };
  }

  if (element.original_content === undefined) {
    return { ok: true, current: current.value };
  }

  const original = validateVerbatimText(element.original_content, null);
  if (!original.ok) {
    return { ok: false, detail: `original_content: ${original.error}` };
  }

  return { ok: true, current: current.value, original: original.value };
}

/**
 * One pass over the parsed rows, one outcome each.
 *
 * This replaces a two-stage validate-then-write pair whose skip logic and
 * failure logic disagreed: `validateContentElements` silently dropped rows, so
 * a skipped element vanished from the counts entirely, and
 * `importContentElements` discovered an already-existing element only by
 * catching the unique-constraint violation its own insert caused — reporting a
 * deliberate skip as a failure. Every row is now looked up once and reported
 * once, with the reason attached.
 */
async function applyImportRows(
  rows: ParsedRow[],
  siteId: string,
  options: BulkImportPayload["options"],
  supabase: SupabaseClient,
): Promise<BulkImportRowResult[]> {
  const results: BulkImportRowResult[] = [];

  for (const { row, element } of rows) {
    const elementId = element.element_id!;
    const language = element.language || "en";
    const variant = element.variant || "default";

    const { data: existing, error: lookupError } = await supabase
      .from("content_elements")
      .select("id")
      .eq("site_id", siteId)
      .eq("element_id", elementId)
      .eq("language", language)
      .eq("variant", variant)
      .single();

    // PGRST116 is PostgREST for "no rows", which is an answer, not a fault.
    // Anything else means we do not know whether the element exists, and
    // writing on that guess is how an owner's live copy gets overwritten by a
    // row that should have been reported instead.
    if (lookupError && (lookupError as { code?: string }).code !== "PGRST116") {
      results.push({
        row,
        elementId,
        outcome: "failed",
        detail: describeError(lookupError),
      });
      continue;
    }

    if (!existing && !options.create_missing_elements) {
      results.push({
        row,
        elementId,
        outcome: "skipped",
        detail: "Element id not found and 'create missing elements' is off",
      });
      continue;
    }

    if (existing && !options.overwrite_existing) {
      results.push({
        row,
        elementId,
        outcome: "skipped",
        detail: "Element already exists and 'overwrite existing' is off",
      });
      continue;
    }

    const content = readContentFields(element);
    if (!content.ok) {
      results.push({
        row,
        elementId,
        outcome: "failed",
        detail: content.detail,
      });
      continue;
    }

    try {
      const elementData = {
        site_id: siteId,
        element_id: elementId,
        selector: element.selector,
        // Omitted, not blanked, when the file never mentioned the column — see
        // `readContentFields` and `readCSVMetadata`. Left out of the payload,
        // the upsert's `ON CONFLICT DO UPDATE` never names the column and the
        // stored value stands. One rule for both: absent is the file saying
        // nothing, and a file that says nothing changes nothing.
        ...(content.original === undefined
          ? {}
          : { original_content: content.original }),
        published_content: content.current,
        current_content: content.current,
        language,
        variant,
        ...(element.metadata === undefined
          ? {}
          : { metadata: element.metadata }),
        updated_at: new Date().toISOString(),
      };

      const { error } = options.overwrite_existing
        ? await supabase.from("content_elements").upsert(elementData, {
            onConflict: "site_id,element_id,language,variant",
          })
        : await supabase.from("content_elements").insert(elementData);

      if (error) throw error;

      results.push({
        row,
        elementId,
        outcome: existing ? "updated" : "created",
      });
    } catch (error) {
      results.push({
        row,
        elementId,
        outcome: "failed",
        detail: describeError(error),
      });
    }
  }

  return results;
}

/**
 * One version snapshot for the whole batch, per
 * `docs/decisions/008-bulk-import-write-path.md`.
 *
 * Bulk import writes `content_elements` directly, which is the only write path
 * in the product that never touched `content_versions` — the table
 * `VersionHistoryPanel` actually reads. An imported change was therefore
 * invisible in history and had nothing to revert to, while a human edit saved
 * from the edit board did. This is the call that closes that gap, and it is
 * deliberately one call for the batch, not one per row: `create_content_version`
 * snapshots the entire site each time it runs.
 *
 * Two things are load-bearing here:
 * - `bulk_edit`, not `bulk_import`, per
 *   [ADR 024](../../../../../docs/decisions/024-bulk-import-snapshot-change-type.md),
 *   which supersedes ADR 008 on this one value: `content_versions.change_type`
 *   carries a CHECK constraint listing ('manual','style_apply',
 *   'language_switch','theme_apply','restore','bulk_edit') since
 *   `20251230100000_edit_board.sql:69`. Any other value fails the insert, and
 *   the failure would be invisible — a version history that silently stays
 *   empty is exactly the bug this call exists to fix.
 * - the service-role client: the RPC is SECURITY DEFINER and revoked from
 *   `anon`/`authenticated` (`20260805190000_lock_down_content_version_rpcs.sql`),
 *   so the request's own cookie client cannot call it. Authorization was
 *   already established above by the `site_permissions` check.
 *
 * Returns the error message when the snapshot fails, so the caller can record
 * it; it never throws. The rows are already written by this point, and
 * answering "import failed" over a failed snapshot invites the owner to import
 * the same file twice.
 */
async function snapshotVersion(
  siteId: string,
  author: string,
  results: BulkImportResults,
): Promise<string | null> {
  const applied = results.created + results.updated;
  if (applied === 0) return null;

  try {
    const description =
      `Bulk import — ${results.created} created, ${results.updated} updated, ` +
      `${results.skipped} skipped, ${results.failed} failed`;

    const { error } = await createServiceRoleClient().rpc(
      "create_content_version",
      {
        p_site_id: siteId,
        p_created_by: author,
        p_description: description,
        p_change_type: "bulk_edit",
      },
    );

    if (error) {
      console.error("Bulk import version snapshot failed:", error);
      return error.message;
    }
    return null;
  } catch (error) {
    console.error("Bulk import version snapshot failed:", error);
    return describeError(error);
  }
}

/** The counts the dashboard reads, derived from the rows so they cannot drift. */
function summarise(rows: BulkImportRowResult[]): BulkImportResults {
  const countOf = (outcome: BulkImportRowResult["outcome"]) =>
    rows.filter((row) => row.outcome === outcome).length;

  return {
    total: rows.length,
    created: countOf("created"),
    updated: countOf("updated"),
    skipped: countOf("skipped"),
    failed: countOf("failed"),
    rows,
  };
}

/** A row's reason reaches the owner's report, so it has to read as a sentence. */
function describeError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unknown error";
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const operationId = searchParams.get("operationId");

    if (!operationId) {
      return NextResponse.json(
        { error: "Missing operationId parameter" },
        { status: 400 },
      );
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => req.cookies.get(name)?.value,
          set: () => {},
          remove: () => {},
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get operation status
    const { data: operation, error } = await supabase
      .from("bulk_operations")
      .select("*")
      .eq("id", operationId)
      .eq("user_id", user.id)
      .single();

    if (error || !operation) {
      return NextResponse.json(
        { error: "Operation not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(operation);
  } catch (error) {
    console.error("Get operation status error:", error);
    return NextResponse.json(
      { error: "Failed to get operation status" },
      { status: 500 },
    );
  }
}
