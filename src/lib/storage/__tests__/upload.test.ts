import { createServiceRoleClient } from "@/lib/supabase/service";
import { ASSETS_BUCKET } from "../assets";
import { uploadSiteAsset } from "../upload";

jest.mock("@/lib/supabase/service");

const SITE_ID = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const PUBLIC_URL = "https://test.supabase.co/storage/v1/object/public/assets/x";

const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;

const uploadMock = jest.fn();
const getPublicUrlMock = jest.fn();
const fromMock = jest.fn(() => ({
  upload: uploadMock,
  getPublicUrl: getPublicUrlMock,
}));

function options(
  overrides: Partial<Parameters<typeof uploadSiteAsset>[0]> = {},
) {
  return {
    siteId: SITE_ID,
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    contentType: "image/png",
    extension: "png",
    ...overrides,
  };
}

describe("uploadSiteAsset", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    uploadMock.mockResolvedValue({ data: { path: "ignored" }, error: null });
    getPublicUrlMock.mockReturnValue({ data: { publicUrl: PUBLIC_URL } });
    mockCreateServiceRoleClient.mockReturnValue({
      storage: { from: fromMock },
    } as unknown as ReturnType<typeof createServiceRoleClient>);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("success", () => {
    it("returns the public URL and the key it stored under", async () => {
      const result = await uploadSiteAsset(options());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.url).toBe(PUBLIC_URL);
      expect(result.value.key).toMatch(
        new RegExp(`^sites/${SITE_ID}/\\d{4}/\\d{2}/[0-9a-f]{32}\\.png$`),
      );
    });

    it("writes to the assets bucket", async () => {
      await uploadSiteAsset(options());

      expect(fromMock).toHaveBeenCalledWith(ASSETS_BUCKET);
    });

    it("stores the bytes under the returned key with the sniffed content type", async () => {
      const data = Buffer.from([1, 2, 3, 4, 5]);

      const result = await uploadSiteAsset(
        options({ data, contentType: "image/webp", extension: "webp" }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(uploadMock).toHaveBeenCalledWith(
        result.value.key,
        data,
        expect.objectContaining({ contentType: "image/webp" }),
      );
    });

    it("never overwrites an existing object", async () => {
      // Overwriting would replace an image a customer's live page already
      // references. A random-key collision must fail loudly instead.
      await uploadSiteAsset(options());

      expect(uploadMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
        expect.objectContaining({ upsert: false }),
      );
    });

    it("sets a one-year immutable cache lifetime", async () => {
      await uploadSiteAsset(options());

      expect(uploadMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
        expect.objectContaining({ cacheControl: "31536000" }),
      );
    });

    it("resolves the public URL for the same key it uploaded", async () => {
      // A mismatch here hands the caller a URL that 404s forever.
      const result = await uploadSiteAsset(options());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(getPublicUrlMock).toHaveBeenCalledWith(result.value.key);
      expect(uploadMock.mock.calls[0][0]).toBe(result.value.key);
    });

    it("gives two uploads for the same site distinct keys", async () => {
      const first = await uploadSiteAsset(options());
      const second = await uploadSiteAsset(options());

      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;

      expect(first.value.key).not.toBe(second.value.key);
    });
  });

  describe("storage failure", () => {
    beforeEach(() => {
      uploadMock.mockResolvedValue({
        data: null,
        error: {
          message:
            'new row violates row-level security policy for bucket "assets" (project ref abcdefgh)',
        },
      });
    });

    it("fails without leaking storage internals to the caller", async () => {
      const result = await uploadSiteAsset(options());

      expect(result).toEqual({ ok: false, error: "Failed to store image" });
    });

    it("does not include the bucket, policy, or project details in the message", async () => {
      const result = await uploadSiteAsset(options());

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).not.toMatch(/row-level security|bucket|abcdefgh/i);
    });

    it("logs the underlying storage error server-side", async () => {
      await uploadSiteAsset(options());

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Asset upload failed:",
        expect.stringContaining("row-level security"),
      );
    });

    it("does not hand back a public URL for an object that was never written", async () => {
      const result = await uploadSiteAsset(options());

      expect(result.ok).toBe(false);
      expect(getPublicUrlMock).not.toHaveBeenCalled();
    });
  });
});
