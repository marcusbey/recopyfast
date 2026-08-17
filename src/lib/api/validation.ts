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

export function requireUuid(
  body: Record<string, unknown>,
  field: string,
): ValidationResult<string> {
  const raw = body[field];
  if (typeof raw !== "string" || !UUID_PATTERN.test(raw.trim())) {
    return fail(`Field "${field}" must be a valid UUID`);
  }
  return { ok: true, value: raw.trim() };
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

function hasForbiddenKeys(value: unknown, depth: number): boolean {
  if (depth > MAX_METADATA_DEPTH) return true;
  if (value === null || typeof value !== "object") return false;

  if (Array.isArray(value)) {
    return value.some((entry) => hasForbiddenKeys(entry, depth + 1));
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([key, entry]) =>
      FORBIDDEN_KEYS.has(key) || hasForbiddenKeys(entry, depth + 1),
  );
}

/**
 * Validate a free-form `metadata` bag: must be a plain JSON object, bounded in
 * serialized size and nesting depth, with no prototype-polluting keys.
 * Callers persist this verbatim into a jsonb column, so it is attacker-controlled
 * storage — the bounds are what stop it becoming an unbounded write primitive.
 */
export function optionalMetadata(
  body: Record<string, unknown>,
  field = "metadata",
): ValidationResult<Record<string, unknown> | undefined> {
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

  if (Buffer.byteLength(serialized, "utf8") > MAX_METADATA_BYTES) {
    return fail(`Field "${field}" exceeds ${MAX_METADATA_BYTES} bytes`);
  }

  if (hasForbiddenKeys(raw, 1)) {
    return fail(
      `Field "${field}" contains disallowed keys or is nested too deeply`,
    );
  }

  return { ok: true, value: raw as Record<string, unknown> };
}
