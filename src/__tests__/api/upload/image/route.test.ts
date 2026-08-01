import sharp from "sharp";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { OPTIONS, POST } from "@/app/api/upload/image/route";
import { authorizeSiteRequest } from "@/lib/security/site-auth";
import { extractSiteToken } from "@/lib/security/ingest-auth";
import { enforceRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * The global jest.setup.js mock of next/server exposes NextResponse.json only.
 * This route also calls `new NextResponse(null, { status: 204 })` for the
 * preflight, so the suite supplies a constructible stand-in that keeps real
 * Headers semantics — the CORS assertions below depend on header mutation
 * behaving as it does in production.
 */
jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    headers: Headers;
    private readonly payload: unknown;

    constructor(
      body?: unknown,
      init?: { status?: number; headers?: HeadersInit },
    ) {
      this.status = init?.status ?? 200;
      this.headers = new Headers(init?.headers);
      this.payload = body;
    }

    async json() {
      return this.payload;
    }

    static json(
      data: unknown,
      init?: { status?: number; headers?: HeadersInit },
    ) {
      const response = new MockNextResponse(data, init);
      response.headers.set("content-type", "application/json");
      return response;
    }
  }

  return { NextRequest: class {}, NextResponse: MockNextResponse };
});

jest.mock("@/lib/security/site-auth", () => ({
  authorizeSiteRequest: jest.fn(),
}));
jest.mock("@/lib/security/ingest-auth", () => ({
  extractSiteToken: jest.fn(),
}));
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(),
  getClientIp: jest.fn(),
}));
jest.mock("@/lib/supabase/service");

const SITE_ID = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CLIENT_IP = "203.0.113.9";
const PUBLIC_URL =
  "https://test.supabase.co/storage/v1/object/public/assets/stored.png";
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const mockAuthorizeSiteRequest = authorizeSiteRequest as jest.MockedFunction<
  typeof authorizeSiteRequest
>;
const mockExtractSiteToken = extractSiteToken as jest.MockedFunction<
  typeof extractSiteToken
>;
const mockEnforceRateLimit = enforceRateLimit as jest.MockedFunction<
  typeof enforceRateLimit
>;
const mockGetClientIp = getClientIp as jest.MockedFunction<typeof getClientIp>;
const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;

const uploadMock = jest.fn();
const getPublicUrlMock = jest.fn();

type TestRequest = {
  request: NextRequest;
  formDataMock: jest.Mock;
};

function buildRequest(
  options: {
    form?: FormData;
    headers?: Record<string, string>;
    malformedBody?: boolean;
  } = {},
): TestRequest {
  const formDataMock = jest.fn(async () => {
    if (options.malformedBody) throw new TypeError("Could not parse content");
    return options.form ?? new FormData();
  });

  const request = {
    method: "POST",
    url: "http://localhost:3000/api/upload/image",
    nextUrl: new URL("http://localhost:3000/api/upload/image"),
    headers: new Headers(options.headers),
    formData: formDataMock,
  } as unknown as NextRequest;

  return { request, formDataMock };
}

/**
 * The route reads the parsed body through `form.get(...)` only. Standing in a
 * plain lookup keeps jsdom's FormData — which re-wraps an appended Blob into
 * its own File class — from stripping the arrayBuffer() polyfill below.
 */
function buildForm(
  file: Blob | string | null,
  siteId: string | null = SITE_ID,
): FormData {
  const entries = new Map<string, Blob | string>();
  if (siteId !== null) entries.set("siteId", siteId);
  if (file !== null) entries.set("file", file);

  return {
    get: (name: string) => entries.get(name) ?? null,
  } as unknown as FormData;
}

async function pngBytes(width = 24, height = 18): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: "#2244aa" },
  })
    .png()
    .toBuffer();
}

function blobOf(bytes: Buffer | string, type = "image/png"): Blob {
  const buffer = new Uint8Array(
    typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes,
  );
  const blob = new Blob([buffer], { type });

  // jsdom's Blob predates Blob.arrayBuffer(). The route runs on the Node.js
  // runtime, where it exists, so the polyfill keeps the double faithful to
  // production rather than forcing the route to be written around jsdom.
  Object.defineProperty(blob, "arrayBuffer", {
    value: async () => buffer.buffer,
  });

  return blob;
}

describe("POST /api/upload/image", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    mockGetClientIp.mockReturnValue(CLIENT_IP);
    mockEnforceRateLimit.mockResolvedValue(null);
    mockExtractSiteToken.mockReturnValue("site-token");
    mockAuthorizeSiteRequest.mockResolvedValue({
      siteId: SITE_ID,
      domain: "example.com",
      apiKey: "test-api-key",
    } as unknown as Awaited<ReturnType<typeof authorizeSiteRequest>>);

    uploadMock.mockResolvedValue({ data: { path: "stored.png" }, error: null });
    getPublicUrlMock.mockReturnValue({ data: { publicUrl: PUBLIC_URL } });
    mockCreateServiceRoleClient.mockReturnValue({
      storage: {
        from: jest.fn(() => ({
          upload: uploadMock,
          getPublicUrl: getPublicUrlMock,
        })),
      },
    } as unknown as ReturnType<typeof createServiceRoleClient>);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("happy path", () => {
    it("stores the image and returns its URL and decoded dimensions", async () => {
      const { request } = buildRequest({
        form: buildForm(blobOf(await pngBytes(24, 18))),
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        url: PUBLIC_URL,
        width: 24,
        height: 18,
      });
    });

    it("stores under a key scoped to the authenticated site", async () => {
      const { request } = buildRequest({
        form: buildForm(blobOf(await pngBytes())),
      });

      await POST(request);

      expect(uploadMock).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(`^sites/${SITE_ID}/\\d{4}/\\d{2}/[0-9a-f]{32}\\.png$`),
        ),
        expect.any(Buffer),
        expect.objectContaining({ contentType: "image/png", upsert: false }),
      );
    });

    it("stores the re-encoded bytes, not the bytes it received", async () => {
      const original = await pngBytes();
      const { request } = buildRequest({ form: buildForm(blobOf(original)) });

      await POST(request);

      const stored = uploadMock.mock.calls[0][1] as Buffer;
      expect(stored.equals(original)).toBe(false);
    });

    it("believes the bytes, not the client's declared type and filename", async () => {
      // A PNG announced as an SVG must still be stored as a PNG.
      const { request } = buildRequest({
        form: buildForm(blobOf(await pngBytes(), "image/svg+xml")),
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(uploadMock).toHaveBeenCalledWith(
        expect.stringMatching(/\.png$/),
        expect.any(Buffer),
        expect.objectContaining({ contentType: "image/png" }),
      );
    });
  });

  describe("input validation", () => {
    it("rejects a request with no file field", async () => {
      const { request } = buildRequest({ form: buildForm(null) });

      const response = await POST(request);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: 'Field "file" is required',
      });
    });

    it("rejects a file field that is a plain string rather than a upload", async () => {
      const { request } = buildRequest({ form: buildForm("not-a-file") });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it("rejects a missing siteId", async () => {
      const { request } = buildRequest({
        form: buildForm(blobOf(await pngBytes()), null),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: 'Field "siteId" must be a valid UUID',
      });
    });

    it("rejects a siteId that is not a UUID", async () => {
      const { request } = buildRequest({
        form: buildForm(blobOf(await pngBytes()), "../../etc/passwd"),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      expect(mockAuthorizeSiteRequest).not.toHaveBeenCalled();
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it("rejects a body that is not multipart form data", async () => {
      const { request } = buildRequest({ malformedBody: true });

      const response = await POST(request);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Request body must be multipart/form-data",
      });
    });

    it("rejects an empty file", async () => {
      const { request } = buildRequest({ form: buildForm(blobOf("")) });

      const response = await POST(request);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "File is empty",
      });
    });
  });

  describe("file type enforcement", () => {
    it("rejects a non-image whose bytes match nothing", async () => {
      const { request } = buildRequest({
        form: buildForm(blobOf("#!/bin/sh\nrm -rf /\n")),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "File is not a supported image (png, jpeg, gif, webp, avif)",
      });
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it("rejects an SVG with a reason naming the accepted formats", async () => {
      const { request } = buildRequest({
        form: buildForm(
          blobOf(
            '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
            "image/png",
          ),
        ),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error:
          "SVG uploads are not supported. Please upload a PNG, JPEG, GIF, WebP, or AVIF image.",
      });
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it("rejects bytes that claim a PNG header but cannot be decoded", async () => {
      const corrupt = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(64, 0x41),
      ]);
      const { request } = buildRequest({ form: buildForm(blobOf(corrupt)) });

      const response = await POST(request);

      expect(response.status).toBe(400);
      expect(uploadMock).not.toHaveBeenCalled();
    });
  });

  describe("size limits", () => {
    it("rejects an oversized Content-Length before reading the body", async () => {
      const { request, formDataMock } = buildRequest({
        headers: { "content-length": String(MAX_UPLOAD_BYTES + 1) },
      });

      const response = await POST(request);

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({
        error: "File exceeds the 4MB limit",
      });
      // The point of the fast path is that the 4 MB body is never buffered.
      expect(formDataMock).not.toHaveBeenCalled();
    });

    it("rejects oversized bytes even when Content-Length understates them", async () => {
      const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
      const { request } = buildRequest({
        form: buildForm(blobOf(oversized)),
        headers: { "content-length": "10" },
      });

      const response = await POST(request);

      expect(response.status).toBe(413);
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it("accepts a request with no Content-Length header", async () => {
      const { request } = buildRequest({
        form: buildForm(blobOf(await pngBytes())),
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe("authorization", () => {
    it("returns 401 with the auth failure reason when the site token is bad", async () => {
      mockAuthorizeSiteRequest.mockRejectedValue(
        new Error("Invalid site token"),
      );
      const { request } = buildRequest({
        form: buildForm(blobOf(await pngBytes())),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "Invalid site token",
      });
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it("authorizes with the token, origin, and referer from the request", async () => {
      const { request } = buildRequest({
        form: buildForm(blobOf(await pngBytes())),
        headers: {
          origin: "https://example.com",
          referer: "https://example.com/pricing",
        },
      });

      await POST(request);

      expect(mockAuthorizeSiteRequest).toHaveBeenCalledWith({
        siteId: SITE_ID,
        token: "site-token",
        origin: "https://example.com",
        referer: "https://example.com/pricing",
      });
    });
  });

  describe("rate limiting", () => {
    it("throttles by IP before the body is parsed or the site is authorized", async () => {
      mockEnforceRateLimit.mockResolvedValueOnce(
        NextResponse.json({ error: "Too many uploads" }, { status: 429 }),
      );
      const { request, formDataMock } = buildRequest({
        form: buildForm(blobOf(await pngBytes())),
      });

      const response = await POST(request);

      expect(response.status).toBe(429);
      expect(formDataMock).not.toHaveBeenCalled();
      expect(mockAuthorizeSiteRequest).not.toHaveBeenCalled();
      expect(mockEnforceRateLimit).toHaveBeenCalledWith(
        request,
        expect.objectContaining({
          identifier: CLIENT_IP,
          identifierType: "ip",
          onStoreFailure: "deny",
        }),
      );
    });

    it("throttles by site after authorization, keyed on the site not the IP", async () => {
      mockEnforceRateLimit
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          NextResponse.json({ error: "Too many uploads" }, { status: 429 }),
        );
      const { request } = buildRequest({
        form: buildForm(blobOf(await pngBytes())),
      });

      const response = await POST(request);

      expect(response.status).toBe(429);
      expect(mockEnforceRateLimit).toHaveBeenLastCalledWith(
        request,
        expect.objectContaining({
          identifier: SITE_ID,
          identifierType: "api_key",
          onStoreFailure: "deny",
        }),
      );
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it("keeps CORS headers on a throttled response so the widget can read it", async () => {
      mockEnforceRateLimit.mockResolvedValueOnce(
        NextResponse.json({ error: "Too many uploads" }, { status: 429 }),
      );
      const { request } = buildRequest();

      const response = await POST(request);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("storage failure", () => {
    it("returns 500 with a generic message when the object cannot be written", async () => {
      uploadMock.mockResolvedValue({
        data: null,
        error: { message: 'bucket "assets" not found (project abcdefgh)' },
      });
      const { request } = buildRequest({
        form: buildForm(blobOf(await pngBytes())),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Failed to store image",
      });
    });

    it("returns 500 without leaking the thrown error when storage blows up", async () => {
      uploadMock.mockRejectedValue(
        new Error("connect ECONNREFUSED 10.0.0.5:5432"),
      );
      const { request } = buildRequest({
        form: buildForm(blobOf(await pngBytes())),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Failed to upload image",
      });
    });
  });

  describe("CORS", () => {
    it("puts CORS headers on error responses", async () => {
      const { request } = buildRequest({ form: buildForm(null) });

      const response = await POST(request);

      expect(response.status).toBe(400);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
        "POST, OPTIONS",
      );
    });

    it("puts CORS headers on the success response", async () => {
      const { request } = buildRequest({
        form: buildForm(blobOf(await pngBytes())),
      });

      const response = await POST(request);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });
});

describe("OPTIONS /api/upload/image", () => {
  it("answers the preflight with 204 and no body", async () => {
    const response = await OPTIONS();

    expect(response.status).toBe(204);
  });

  it("advertises the methods and headers the widget's upload needs", async () => {
    const response = await OPTIONS();

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "POST, OPTIONS",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Authorization, Content-Type, X-Site-Token",
    );
  });
});
