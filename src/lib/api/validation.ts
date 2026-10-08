/**
 * Minimal boundary validation for API route bodies.
 *
 * NOTE ON ZOD: the project has no schema-validation library installed — `zod` is
 * absent from package.json and node_modules. Rather than add a dependency from
 * inside a security fix, this module provides the narrow set of validators the
 * routes here actually need. If zod is added later, these call sites should be
 * migrated to schemas; the ValidationResult shape mirrors `safeParse` to make
 * that a mechanical change.
 */

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Keys that would poison Object.prototype if spread into a target object. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Cap on the JSON-serialized size of a free-form `metadata` object. */
const MAX_METADATA_BYTES = 8 * 1024;

/** Cap on nesting depth of a free-form `metadata` object. */
const MAX_METADATA_DEPTH = 5;

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

/**
 * Parse a JSON request body into a plain object.
 * Rejects malformed JSON, arrays, and primitives — every route here expects an object.
 */
export async function readJsonObject(
  request: Request,
): Promise<ValidationResult<Record<string, unknown>>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return fail("Request body must be valid JSON");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail("Request body must be a JSON object");
  }

  return { ok: true, value: parsed as Record<string, unknown> };
}

/**
 * Read a JSON body of any shape, refusing it unparsed when it is larger than
 * `maxBytes`. Measured on the bytes actually read, never on `Content-Length`,
 * which says whatever the client wants (same reasoning as bulk/import).
 */
export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<ValidationResult<unknown>> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return fail("Request body could not be read");
  }

  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return fail(`Request body exceeds ${maxBytes} bytes`);
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return fail("Request body must be valid JSON");
  }
}

const TEXT_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * An identifier-like string stored verbatim: non-empty, bounded, and free of
 * control characters. Not trimmed — the value is a key other rows are matched
 * on, so it is refused rather than silently rewritten, and a control character
 * at either end is refused rather than trimmed away.
 */
export function requirePlainText(
  body: Record<string, unknown>,
  field: string,
  options: { maxLength: number },
): ValidationResult<string> {
  const raw = body[field];
  if (typeof raw !== "string" || raw.length === 0) {
    return fail(`Field "${field}" is required and must be a non-empty string`);
  }
  if (raw.length > options.maxLength) {
    return fail(
      `Field "${field}" must be at most ${options.maxLength} characters`,
    );
  }
  if (TEXT_CONTROL_PATTERN.test(raw)) {
    return fail(`Field "${field}" contains control characters`);
  }
  return { ok: true, value: raw };
}

export function optionalPlainText(
  body: Record<string, unknown>,
  field: string,
  options: { maxLength: number },
): ValidationResult<string | undefined> {
  if (body[field] === undefined || body[field] === null) {
    return { ok: true, value: undefined };
  }
  return requirePlainText(body, field, options);
}

/**
 * An optional string bounded in length. Empty is allowed (callers store it as
 * absent); anything that is not a string, null or absent is refused. Control
 * characters are refused too when the caller asks — for free text that ends
 * up in mail or markup.
 */
export function optionalBoundedString(
  body: Record<string, unknown>,
  field: string,
  options: { maxLength: number; rejectControlCharacters?: boolean },
): ValidationResult<string | undefined> {
  const raw = body[field];
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== "string") {
    return fail(`Field "${field}" must be a string`);
  }
  if (raw.length > options.maxLength) {
    return fail(
      `Field "${field}" must be at most ${options.maxLength} characters`,
    );
  }
  if (options.rejectControlCharacters && TEXT_CONTROL_PATTERN.test(raw)) {
    return fail(`Field "${field}" contains control characters`);
  }
  return { ok: true, value: raw };
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
  options: { maxLength: number; minLength?: number },
): ValidationResult<string> {
  const raw = body[field];
  if (typeof raw !== "string") {
    return fail(`Field "${field}" is required and must be a string`);
  }

  const value = raw.trim();
  const minLength = options.minLength ?? 1;

  if (value.length < minLength) {
    return fail(`Field "${field}" must be at least ${minLength} characters`);
  }
  if (value.length > options.maxLength) {
    return fail(
      `Field "${field}" must be at most ${options.maxLength} characters`,
    );
  }

  return { ok: true, value };
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  options: { maxLength: number },
): ValidationResult<string | undefined> {
  if (body[field] === undefined || body[field] === null) {
    return { ok: true, value: undefined };
  }
  return requireString(body, field, options);
}

export const MAX_CONTENT_HREF_LENGTH = 2048;
export const MAX_CONTENT_ALT_LENGTH = 2000;

export interface ContentAttributePatch {
  href?: string;
  alt?: string;
}

const URI_SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_HREF_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const ATTRIBUTE_CONTROL_PATTERN = TEXT_CONTROL_PATTERN;

/**
 * Validate the two non-text values the embed editor can stage.
 *
 * Link destinations eventually become a DOM `href`, so accepting an arbitrary
 * scheme here would turn a saved edit into stored script execution on every
 * visitor. Relative URLs are intentional (including root-relative paths and
 * fragments); protocol-relative URLs are refused because their effective
 * scheme depends on the host page. Empty strings are valid and mean "clear the
 * attribute". The image editor sends `alt: null` for background images, where
 * there is no alt attribute to edit, so that one value is treated as omitted.
 */
export function validateContentAttributePatch(
  body: Record<string, unknown>,
): ValidationResult<ContentAttributePatch> {
  const patch: ContentAttributePatch = {};

  if (body.href !== undefined) {
    if (typeof body.href !== "string") {
      return fail('Field "href" must be a string');
    }

    const href = body.href.trim();
    if (href.length > MAX_CONTENT_HREF_LENGTH) {
      return fail(
        `Field "href" must be at most ${MAX_CONTENT_HREF_LENGTH} characters`,
      );
    }
    if (ATTRIBUTE_CONTROL_PATTERN.test(href) || href.includes("\\")) {
      return fail('Field "href" contains unsafe characters');
    }
    if (href.startsWith("//")) {
      return fail('Field "href" must use an explicit http or https scheme');
    }

    const scheme = URI_SCHEME_PATTERN.exec(href)?.[1]?.toLowerCase();
    if (scheme && !ALLOWED_HREF_SCHEMES.has(scheme)) {
      return fail(`Field "href" uses an unsupported scheme`);
    }

    patch.href = href;
  }

  if (body.alt !== undefined && body.alt !== null) {
    if (typeof body.alt !== "string") {
      return fail('Field "alt" must be a string');
    }

    const alt = body.alt.trim();
    if (alt.length > MAX_CONTENT_ALT_LENGTH) {
      return fail(
        `Field "alt" must be at most ${MAX_CONTENT_ALT_LENGTH} characters`,
      );
    }
    if (ATTRIBUTE_CONTROL_PATTERN.test(alt)) {
      return fail('Field "alt" contains control characters');
    }

    patch.alt = alt;
  }

  return { ok: true, value: patch };
}

export function requireUuid(
  body: Record<string, unknown>,
  field: string,
): ValidationResult<string> {
  const raw = body[field];
  if (typeof raw !== "string" || !UUID_PATTERN.test(raw.trim())) {
    return fail(`Field "${field}" must be a valid UUID`);
  }
  // PostgreSQL accepts several spellings for the same UUID. Canonicalising at
  // the HTTP boundary prevents one database identity from opening distinct
  // rate-limit buckets through upper-case input.
  return { ok: true, value: raw.trim().toLowerCase() };
}

export function requireEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): ValidationResult<T> {
  const raw = body[field];
  if (typeof raw !== "string" || !allowed.includes(raw as T)) {
    return fail(`Field "${field}" must be one of: ${allowed.join(", ")}`);
  }
  return { ok: true, value: raw as T };
}

export function optionalEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): ValidationResult<T | undefined> {
  if (body[field] === undefined || body[field] === null) {
    return { ok: true, value: undefined };
  }
  return requireEnum(body, field, allowed);
}

/**
 * Read an optional boolean flag, falling back to `fallback` when absent.
 *
 * Deliberately strict about the type rather than truthy-coercing: these flags
 * gate writes (`overwrite_existing`), and a caller sending the string `"false"`
 * must not be read as "yes, overwrite". A wrong value is refused, not guessed.
 */
export function optionalBoolean(
  body: Record<string, unknown>,
  field: string,
  fallback: boolean,
): ValidationResult<boolean> {
  const raw = body[field];
  if (raw === undefined || raw === null) {
    return { ok: true, value: fallback };
  }
  if (typeof raw !== "boolean") {
    return fail(`Field "${field}" must be a boolean`);
  }
  return { ok: true, value: raw };
}

export function requireFiniteNumber(
  body: Record<string, unknown>,
  field: string,
  options: { min: number; max: number },
): ValidationResult<number> {
  const raw = body[field];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fail(`Field "${field}" must be a finite number`);
  }
  if (raw < options.min || raw > options.max) {
    return fail(
      `Field "${field}" must be between ${options.min} and ${options.max}`,
    );
  }
  return { ok: true, value: raw };
}

/**
 * A number the caller may send loosely, replaced by `fallback` instead of
 * refused. For a field whose refusal costs more than a wrong value: a 400
 * throws away the whole request, and some callers — a `sendBeacon` — never see
 * the answer. A finite number, or a non-blank string that parses to one, inside
 * [min, max] is kept; anything else (absent included) becomes `fallback`.
 */
export function numberOrDefault(
  body: Record<string, unknown>,
  field: string,
  options: { min: number; max: number; fallback: number },
): number {
  const raw = body[field];
  let parsed = Number.NaN;
  if (typeof raw === "number") parsed = raw;
  if (typeof raw === "string" && raw.trim() !== "") parsed = Number(raw);

  if (
    !Number.isFinite(parsed) ||
    parsed < options.min ||
    parsed > options.max
  ) {
    return options.fallback;
  }
  return parsed;
}

const TEXT_CONTROL_CHARACTERS = new RegExp(TEXT_CONTROL_PATTERN.source, "g");

/**
 * Free text the caller may send loosely, coerced to a bounded string instead
 * of refused — the text twin of `numberOrDefault`. A string is kept; a number
 * or a boolean goes through `String()`; anything else (null, an object, an
 * array) becomes `fallback`, never "[object Object]". Control characters are
 * stripped, then the text is cut on a whole character so that, written inside
 * a JSON string, it takes at most `maxJsonBytes` UTF-8 bytes (escapes counted)
 * — the measure a byte bound on the stored JSON applies.
 */
export function coerceText(
  raw: unknown,
  options: { fallback: string; maxJsonBytes: number },
): string {
  const text =
    typeof raw === "string"
      ? raw
      : typeof raw === "number" || typeof raw === "boolean"
        ? String(raw)
        : options.fallback;

  let kept = "";
  let bytes = 0;
  for (const character of text.replace(TEXT_CONTROL_CHARACTERS, "")) {
    bytes += Buffer.byteLength(JSON.stringify(character), "utf8") - 2;
    if (bytes > options.maxJsonBytes) break;
    kept += character;
  }
  return kept;
}

function hasForbiddenKeys(
  value: unknown,
  depth: number,
  maxDepth: number,
): boolean {
  if (depth > maxDepth) return true;
  if (value === null || typeof value !== "object") return false;

  if (Array.isArray(value)) {
    return value.some((entry) => hasForbiddenKeys(entry, depth + 1, maxDepth));
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([key, entry]) =>
      FORBIDDEN_KEYS.has(key) || hasForbiddenKeys(entry, depth + 1, maxDepth),
  );
}

/**
 * Validate a free-form `metadata` bag: must be a plain JSON object, bounded in
 * serialized size and nesting depth, with no prototype-polluting keys.
 * Callers persist this verbatim into a jsonb column, so it is attacker-controlled
 * storage — the bounds are what stop it becoming an unbounded write primitive.
 *
 * Depth counts values, not containers: the object itself is level 1 and its
 * values level 2, so `maxDepth: 2` admits a flat object of primitives only.
 * A route with a tighter contract than the defaults passes its own bounds.
 */
export function optionalMetadata(
  body: Record<string, unknown>,
  field = "metadata",
  options: { maxBytes?: number; maxDepth?: number } = {},
): ValidationResult<Record<string, unknown> | undefined> {
  const maxBytes = options.maxBytes ?? MAX_METADATA_BYTES;
  const maxDepth = options.maxDepth ?? MAX_METADATA_DEPTH;
  const raw = body[field];
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return fail(`Field "${field}" must be a JSON object`);
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return fail(`Field "${field}" must be JSON-serializable`);
  }

  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    return fail(`Field "${field}" exceeds ${maxBytes} bytes`);
  }

  if (hasForbiddenKeys(raw, 1, maxDepth)) {
    return fail(
      `Field "${field}" contains disallowed keys or is nested too deeply`,
    );
  }

  return { ok: true, value: raw as Record<string, unknown> };
}
