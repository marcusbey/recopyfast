import sharp from "sharp";
// sharp is `export = sharp` with a merged namespace, so the default import
// binds only the callable and types must be pulled in by name.
import type { Sharp } from "sharp";
import zlib from "zlib";
import {
  MAX_DIMENSION,
  MAX_STORED_DIMENSION,
  normalizeImage,
} from "../process";

/**
 * Exercises the real sharp pipeline against small generated buffers. Mocking
 * sharp here would test the mock: every property this module claims — EXIF is
 * gone, orientation is baked in, bombs are refused — is a property of the
 * decoder, not of our control flow.
 */

jest.setTimeout(20_000);

function solid(width: number, height: number, background: string): Sharp {
  return sharp({ create: { width, height, channels: 4, background } });
}

function png(width: number, height: number, background = "#3366cc") {
  return solid(width, height, background).png().toBuffer();
}

describe("normalizeImage", () => {
  describe("successful normalisation", () => {
    it("reports the real decoded dimensions and keeps the input format", async () => {
      const result = await normalizeImage(await png(64, 48), "png");

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.width).toBe(64);
      expect(result.value.height).toBe(48);
      expect(result.value.format).toBe("png");
      expect(result.value.contentType).toBe("image/png");
    });

    it("re-encodes rather than passing the original bytes through", async () => {
      const original = await png(64, 48);
      const result = await normalizeImage(original, "png");

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // A polyglot file only survives byte-for-byte storage. Proving the output
      // is not the input is what proves the decode/re-encode actually happened.
      expect(result.value.data.equals(original)).toBe(false);
      expect((await sharp(result.value.data).metadata()).format).toBe("png");
    });

    it("keeps a JPEG a JPEG", async () => {
      const source = await solid(32, 32, "#ff8800").jpeg().toBuffer();
      const result = await normalizeImage(source, "jpeg");

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.contentType).toBe("image/jpeg");
      expect((await sharp(result.value.data).metadata()).format).toBe("jpeg");
    });

    it("keeps a WebP a WebP", async () => {
      const source = await solid(32, 32, "#00aa77").webp().toBuffer();
      const result = await normalizeImage(source, "webp");

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.contentType).toBe("image/webp");
      expect((await sharp(result.value.data).metadata()).format).toBe("webp");
    });
  });

  describe("metadata stripping", () => {
    it("applies EXIF orientation to the pixels and then discards the EXIF", async () => {
      // Orientation 6 means "rotate 90deg on display". Dropping the tag without
      // applying it would leave every portrait phone photo silently sideways.
      const source = await solid(40, 30, "#224466")
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer();

      expect((await sharp(source).metadata()).orientation).toBe(6);

      const result = await normalizeImage(source, "jpeg");

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Axes swapped: the rotation is now baked into the stored pixels.
      expect(result.value.width).toBe(30);
      expect(result.value.height).toBe(40);

      const stored = await sharp(result.value.data).metadata();
      expect(stored.exif).toBeUndefined();
      expect(stored.orientation).toBeUndefined();
    });
  });

  describe("downscaling", () => {
    it("caps the longest edge at the stored-dimension limit", async () => {
      const result = await normalizeImage(await png(5000, 10), "png");

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.width).toBe(MAX_STORED_DIMENSION);
      expect(result.value.height).toBeLessThan(10);
    });

    it("leaves an already-small image at its original size", async () => {
      const result = await normalizeImage(await png(120, 90), "png");

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.width).toBe(120);
      expect(result.value.height).toBe(90);
    });
  });

  describe("animated images", () => {
    it("preserves every frame and reports the per-frame height", async () => {
      const frames = await Promise.all([
        png(8, 6, "#ff0000"),
        png(8, 6, "#00ff00"),
        png(8, 6, "#0000ff"),
      ]);
      const source = await sharp(frames, { join: { animated: true } })
        .gif()
        .toBuffer();

      expect((await sharp(source).metadata()).pages).toBe(3);

      const result = await normalizeImage(source, "gif");

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // sharp reports the full filmstrip height (6 x 3 = 18) for an animated
      // encode. Returning that verbatim would tell the widget to reserve triple
      // the layout height for the image.
      expect(result.value.width).toBe(8);
      expect(result.value.height).toBe(6);
      expect((await sharp(result.value.data).metadata()).pages).toBe(3);
    });
  });

  describe("rejection", () => {
    it("returns an error instead of throwing on a buffer that is not an image", async () => {
      const result = await normalizeImage(
        Buffer.from("this is definitely not an image", "utf8"),
        "png",
      );

      expect(result).toEqual({
        ok: false,
        error: "File is not a decodable image",
      });
    });

    it("returns an error instead of throwing on an empty buffer", async () => {
      const result = await normalizeImage(Buffer.alloc(0), "png");

      expect(result.ok).toBe(false);
    });

    it("returns an error instead of throwing on a truncated image", async () => {
      const truncated = (await png(64, 48)).subarray(0, 40);
      const result = await normalizeImage(truncated, "png");

      expect(result).toEqual({
        ok: false,
        error: "File is not a decodable image",
      });
    });

    it("refuses a single axis beyond the dimension cap", async () => {
      // 13000 x 10 is only 130k pixels, so it clears the pixel budget and can
      // only be caught by the per-axis check.
      const result = await normalizeImage(
        await png(MAX_DIMENSION + 1000, 10),
        "png",
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).toContain(`exceed ${MAX_DIMENSION}px`);
      expect(result.error).toContain("13000x10");
    });

    it("refuses a decompression bomb without decoding it", async () => {
      // A 4x3 PNG whose IHDR is rewritten to claim 10000x6000. The file stays
      // ~100 bytes; decoding it would ask for ~180 MB of pixel buffer.
      const bomb = Buffer.from(await png(4, 3));
      bomb.writeUInt32BE(10_000, 16); // IHDR width
      bomb.writeUInt32BE(6_000, 20); // IHDR height
      bomb.writeUInt32BE(zlib.crc32(bomb.subarray(12, 29)), 29);

      const started = Date.now();
      const result = await normalizeImage(bomb, "png");

      expect(result.ok).toBe(false);
      // Rejected from the header alone — libvips enforces the pixel limit
      // before allocating, so this must not take a decode's worth of time.
      expect(Date.now() - started).toBeLessThan(2_000);
    });
  });
});
