/**
 * Normalisation of untrusted image bytes.
 *
 * Every accepted upload is fully decoded and re-encoded here rather than stored
 * as received. That single decision is what makes the rest of the pipeline safe:
 *
 *  • EXIF is discarded. Phone photos carry GPS coordinates, the capture
 *    timestamp, and device serial numbers. A customer uploading a product photo
 *    taken at home should not be publishing their home address to every visitor
 *    of their site. sharp emits no metadata unless `withMetadata()` is called,
 *    so simply not calling it strips EXIF, XMP, and IPTC.
 *
 *  • Orientation is baked into the pixels first. EXIF orientation is *itself*
 *    metadata, so stripping it without applying it would silently rotate every
 *    portrait phone photo. `.rotate()` with no argument auto-orients from the
 *    EXIF tag before it is dropped.
 *
 *  • Polyglot files stop working. A file that is a valid image *and* a valid
 *    archive or script survives byte-for-byte storage; it does not survive being
 *    decoded to a pixel buffer and re-encoded from scratch.
 *
 *  • Decompression bombs are rejected before decode. Dimensions are read from
 *    the header — which does not allocate the pixel buffer — and the pixel count
 *    is checked against a cap. A 12 KB PNG declaring 50000x50000 would otherwise
 *    ask for ~10 GB of RAM the moment it is decoded.
 */

import sharp from "sharp";
// sharp is `export = sharp` with a merged namespace, so the default import binds
// only the callable. Types have to be pulled in by name.
import type { Metadata, OutputInfo, Sharp } from "sharp";
import type { RasterFormat } from "./sniff";

/**
 * Hard ceiling on decoded pixels (~50 MP, i.e. larger than any consumer camera).
 * Enforced twice: once by us against the header, and once by libvips via
 * `limitInputPixels` in case a malformed header under-reports the true size.
 */
export const MAX_PIXELS = 50_000_000;

/** Reject absurd single-axis dimensions even when the total pixel count fits. */
export const MAX_DIMENSION = 12_000;

/**
 * Longest edge of the stored image. Anything larger is downscaled: a CMS image
 * is displayed in a web page, and storing a 12000px original only inflates
 * storage and the bytes every visitor downloads.
 */
export const MAX_STORED_DIMENSION = 4096;

/** Frame cap for animated GIF/WebP — bounds decode cost for animations. */
export const MAX_FRAMES = 600;

export interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
  format: RasterFormat;
  contentType: string;
}

export type ProcessResult =
  | { ok: true; value: ProcessedImage }
  | { ok: false; error: string };

const OUTPUT_MIME: Record<RasterFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

/** Formats that can carry multiple frames and must keep them. */
function supportsAnimation(format: RasterFormat): boolean {
  return format === "gif" || format === "webp";
}

function applyOutputFormat(pipeline: Sharp, format: RasterFormat): Sharp {
  switch (format) {
    case "png":
      return pipeline.png({ compressionLevel: 9 });
    case "jpeg":
      return pipeline.jpeg({ quality: 82, mozjpeg: true });
    case "webp":
      return pipeline.webp({ quality: 82 });
    case "avif":
      return pipeline.avif({ quality: 60 });
    case "gif":
      return pipeline.gif();
  }
}

/**
 * Decode, sanitise, and re-encode an image.
 *
 * `format` comes from byte sniffing, not from the client. The output keeps the
 * input format so an uploaded PNG stays a PNG — transparency and animation are
 * preserved, and the widget's `<img>` behaves exactly as the user expects.
 */
export async function normalizeImage(
  input: Buffer,
  format: RasterFormat,
): Promise<ProcessResult> {
  // Step 1: read the header only. This allocates nothing proportional to the
  // declared dimensions, so it is safe to run on a suspected bomb.
  let metadata: Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    return { ok: false, error: "File is not a decodable image" };
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width <= 0 || height <= 0) {
    return { ok: false, error: "Image has no readable dimensions" };
  }

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return {
      ok: false,
      error: `Image dimensions exceed ${MAX_DIMENSION}px (received ${width}x${height})`,
    };
  }

  const frames = metadata.pages ?? 1;

  if (frames > MAX_FRAMES) {
    return {
      ok: false,
      error: `Animated image exceeds ${MAX_FRAMES} frames`,
    };
  }

  // Total decoded pixels across every frame — a 1000-frame 1000x1000 GIF is a
  // bomb even though each individual frame is unremarkable.
  if (width * height * frames > MAX_PIXELS) {
    return {
      ok: false,
      error: "Image is too large to process",
    };
  }

  const animated = frames > 1 && supportsAnimation(format);

  // Step 2: decode and re-encode.
  let pipeline = sharp(input, {
    limitInputPixels: MAX_PIXELS,
    animated,
    // "error" tolerates the minor spec deviations common in real-world photos
    // while still refusing genuinely truncated or corrupt data.
    failOn: "error",
  });

  if (!animated) {
    // Auto-orient from EXIF before that EXIF is discarded. sharp cannot rotate
    // a multi-frame image, and animated sources do not carry EXIF orientation.
    pipeline = pipeline.rotate();
  }

  if (width > MAX_STORED_DIMENSION || height > MAX_STORED_DIMENSION) {
    pipeline = pipeline.resize({
      width: MAX_STORED_DIMENSION,
      height: MAX_STORED_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  // No withMetadata() call anywhere in this chain — that is what drops EXIF.
  // It also drops any embedded ICC profile, so a wide-gamut source is
  // interpreted as sRGB. That is the deliberate trade: the overwhelming
  // majority of web images are already sRGB, and privacy wins over gamut.
  let data: Buffer;
  let info: OutputInfo;
  try {
    const result = await applyOutputFormat(pipeline, format).toBuffer({
      resolveWithObject: true,
    });
    data = result.data;
    info = result.info;
  } catch {
    return { ok: false, error: "File is not a decodable image" };
  }

  return {
    ok: true,
    value: {
      data,
      // info.height on an animated image is the height of the full filmstrip
      // (frame height x page count). Report the per-frame height, which is what
      // the browser lays out and what the widget needs to avoid layout shift.
      width: info.width,
      height: animated ? Math.round(info.height / frames) : info.height,
      format,
      contentType: OUTPUT_MIME[format],
    },
  };
}
