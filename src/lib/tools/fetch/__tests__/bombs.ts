/**
 * Decompression bombs for the fetcher's tests (s96 review, major 1): a small
 * body that inflates to `decodedBytes` of spaces. Built by streaming 1 MiB
 * slices through the compressor, so the test process never holds the 200 MB
 * it describes. Cached per encoding: the four bombs are built once a run.
 */

import { once } from "node:events";
import zlib from "node:zlib";

export type BombEncoding = "gzip" | "deflate" | "deflate-raw" | "br";

export const BOMB_DECODED_BYTES = 200 * 1024 * 1024;

const cache = new Map<string, Promise<Buffer>>();

function compressor(
  encoding: BombEncoding,
): zlib.Gzip | zlib.Deflate | zlib.DeflateRaw | zlib.BrotliCompress {
  switch (encoding) {
    case "gzip":
      return zlib.createGzip({ level: 9 });
    case "deflate":
      return zlib.createDeflate({ level: 9 });
    case "deflate-raw":
      return zlib.createDeflateRaw({ level: 9 });
    case "br":
      return zlib.createBrotliCompress({
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
      });
  }
}

async function build(
  encoding: BombEncoding,
  decodedBytes: number,
  slice: Buffer = Buffer.alloc(1024 * 1024, 0x20),
): Promise<Buffer> {
  const stream = compressor(encoding);
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = once(stream, "end");
  for (let written = 0; written < decodedBytes; written += slice.length) {
    if (!stream.write(slice)) await once(stream, "drain");
  }
  stream.end();
  await done;
  return Buffer.concat(chunks);
}

export function compressedBomb(
  encoding: BombEncoding,
  decodedBytes = BOMB_DECODED_BYTES,
): Promise<Buffer> {
  const key = `${encoding}:${decodedBytes}`;
  let bomb = cache.get(key);
  if (!bomb) {
    bomb = build(encoding, decodedBytes);
    cache.set(key, bomb);
  }
  return bomb;
}

/** The Content-Encoding header a bomb is served with. */
export function contentEncodingOf(encoding: BombEncoding): string {
  return encoding === "deflate-raw" ? "deflate" : encoding;
}

/**
 * s96 review round 2, minor 4: a `.xml.gz` sitemap (a gzip FILE) sent with
 * `Content-Encoding: gzip` on top. The inner file is nothing but EMPTY gzip
 * members (20 bytes each, decoding to nothing), `innerBytes` of them; the
 * outer layer squeezes that to a few hundred KB. Counting only the last
 * decoder's output saw 0 bytes while the outer layer inflated it all.
 */
export function nestedEmptyMemberBomb(
  innerBytes = BOMB_DECODED_BYTES,
): Promise<Buffer> {
  const key = `nested-empty-member:${innerBytes}`;
  let bomb = cache.get(key);
  if (!bomb) {
    const member = zlib.gzipSync(Buffer.alloc(0));
    const perSlice = Math.floor((1024 * 1024) / member.length);
    const slice = Buffer.concat(Array.from({ length: perSlice }, () => member));
    bomb = build("gzip", innerBytes, slice);
    cache.set(key, bomb);
  }
  return bomb;
}
