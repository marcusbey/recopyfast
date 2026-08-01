/**
 * Content-type detection by magic number.
 *
 * The upload endpoint accepts arbitrary bytes from any site holding a token, so
 * the client-supplied `Content-Type` and the filename extension are both treated
 * as unverified hints and never used to decide what a file is. A `.png` name and
 * an `image/png` part header cost an attacker nothing; the leading bytes are the
 * only claim that has to survive contact with a decoder.
 *
 * SVG is detected here specifically so it can be *rejected with a clear reason*
 * rather than falling through to a generic "not an image" — see ALLOWED_FORMATS.
 */

/** Raster formats the pipeline is willing to decode and re-encode. */
export const RASTER_FORMATS = ["png", "jpeg", "gif", "webp", "avif"] as const;

export type RasterFormat = (typeof RASTER_FORMATS)[number];

/** Everything sniffImageFormat can name, including formats we refuse. */
export type SniffedFormat = RasterFormat | "svg";

export interface SniffResult {
  format: SniffedFormat;
  /** Canonical MIME type, derived from the bytes — never from the client. */
  mimeType: string;
  /** Canonical extension, used to build the storage key. */
  extension: string;
}

const FORMAT_METADATA: Record<
  SniffedFormat,
  { mimeType: string; extension: string }
> = {
  png: { mimeType: "image/png", extension: "png" },
  jpeg: { mimeType: "image/jpeg", extension: "jpg" },
  gif: { mimeType: "image/gif", extension: "gif" },
  webp: { mimeType: "image/webp", extension: "webp" },
  avif: { mimeType: "image/avif", extension: "avif" },
  svg: { mimeType: "image/svg+xml", extension: "svg" },
};

/** Longest signature we compare, plus room for the SVG text scan. */
const SVG_SCAN_BYTES = 1024;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function matchesAscii(
  bytes: Uint8Array,
  offset: number,
  text: string,
): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/**
 * ISO-BMFF brands that indicate AVIF. `avis` is the image-sequence brand.
 * HEIC brands (`heic`, `mif1`) are deliberately absent — browsers do not render
 * HEIC, so accepting it would store images that never display.
 */
const AVIF_BRANDS = ["avif", "avis"];

/**
 * SVG has no binary magic number: it is XML. Detect it by scanning a bounded
 * prefix for an `<svg` tag, tolerating a leading BOM, whitespace, an XML
 * declaration, and a DOCTYPE. The scan is capped so a large non-image file
 * cannot turn detection into an expensive string operation.
 */
function looksLikeSvg(bytes: Uint8Array): boolean {
  const prefix = bytes.subarray(0, SVG_SCAN_BYTES);
  const text = Buffer.from(prefix).toString("utf8").toLowerCase();
  if (!text.includes("<svg")) return false;

  // Require the document to actually open as XML/SVG rather than merely
  // mentioning "<svg" somewhere, which any text file could do.
  const trimmed = text.replace(/^﻿/, "").trimStart();
  return (
    trimmed.startsWith("<svg") ||
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<!doctype svg")
  );
}

/**
 * Identify an image from its leading bytes.
 * Returns null when the bytes match no format we recognise.
 */
export function sniffImageFormat(bytes: Uint8Array): SniffResult | null {
  const describe = (format: SniffedFormat): SniffResult => ({
    format,
    ...FORMAT_METADATA[format],
  });

  if (startsWith(bytes, PNG_SIGNATURE)) return describe("png");
  if (startsWith(bytes, JPEG_SIGNATURE)) return describe("jpeg");

  if (matchesAscii(bytes, 0, "GIF87a") || matchesAscii(bytes, 0, "GIF89a")) {
    return describe("gif");
  }

  // RIFF container: "RIFF" <4-byte size> "WEBP"
  if (matchesAscii(bytes, 0, "RIFF") && matchesAscii(bytes, 8, "WEBP")) {
    return describe("webp");
  }

  // ISO-BMFF: <4-byte box size> "ftyp" <4-byte brand>
  if (matchesAscii(bytes, 4, "ftyp")) {
    const brand = Buffer.from(bytes.subarray(8, 12)).toString("ascii");
    if (AVIF_BRANDS.includes(brand)) return describe("avif");
  }

  if (looksLikeSvg(bytes)) return describe("svg");

  return null;
}

export function isRasterFormat(format: SniffedFormat): format is RasterFormat {
  return (RASTER_FORMATS as readonly string[]).includes(format);
}
