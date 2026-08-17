/**
 * One CSV codec for both halves of bulk content portability.
 *
 * The two halves used to be written independently and disagreed: the export
 * route quoted three of its eleven columns and doubled embedded `"`, while the
 * import route did `line.split(",")` with no quote awareness and
 * `data.trim().split("\n")` with no embedded-newline handling. Exporting a
 * paragraph containing a comma and importing the same file back therefore
 * shifted every later column by one, and a paragraph containing a line break
 * became two half-rows. Nobody noticed because no UI reached either route.
 *
 * Encoding and parsing now live in one module so they cannot drift again:
 * anything `encodeCSVRow` produces, `parseCSV` reads back byte-for-byte. Shape
 * is RFC 4180 — quote a field only when it contains `"`, `,`, CR or LF; double
 * `"` inside a quoted field; CR/LF inside quotes is data, not a row break.
 */

/** A field needs quoting only when leaving it bare would change the parse. */
const NEEDS_QUOTING = /["\n\r,]/;

function encodeCSVField(field: string): string {
  const value = field ?? "";
  if (!NEEDS_QUOTING.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** Serialises one record. Rows are joined with `\n` by the caller. */
export function encodeCSVRow(fields: string[]): string {
  return fields.map(encodeCSVField).join(",");
}

/**
 * Parses a whole CSV document into rows of raw fields, header row included.
 *
 * Deliberately does not trim field values: trimming is what makes a round trip
 * lossy for content that legitimately starts or ends with a space. Header names
 * are trimmed by the caller, where a hand-authored `element_id, selector` is a
 * plausible input and no content is at stake.
 *
 * A completely blank line yields no row, so a trailing newline does not become
 * a phantom record. A line of separators (`,,`) is a real record of empty
 * fields and is kept.
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let isInsideQuotes = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };

  const endRow = () => {
    endField();
    const isBlankLine = row.length === 1 && row[0] === "";
    if (!isBlankLine) rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index];

    if (isInsideQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        isInsideQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    // A quote only opens a quoted field at the start of a field; a stray quote
    // mid-field is kept as data rather than rejecting the whole file.
    if (char === '"' && field === "") {
      isInsideQuotes = true;
      index += 1;
      continue;
    }

    if (char === ",") {
      endField();
      index += 1;
      continue;
    }

    if (char === "\r") {
      if (text[index + 1] === "\n") index += 1;
      endRow();
      index += 1;
      continue;
    }

    if (char === "\n") {
      endRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  const hasTrailingRecord = field !== "" || row.length > 0 || isInsideQuotes;
  if (hasTrailingRecord) endRow();

  return rows;
}
