import { createHash } from "node:crypto";
import { metadata } from "@/app/layout";
import manifest from "@/app/manifest";
import OpenGraphImage, { alt, contentType, size } from "@/app/opengraph-image";
import TwitterImage, {
  alt as twitterAlt,
  contentType as twitterContentType,
  size as twitterSize,
} from "@/app/twitter-image";

/**
 * s50 — the search result, the install prompt and the social card describe
 * the product the same way the page does.
 *
 * They said "Universal CMS Layer" and "Transform any website into an editable
 * platform". Neither is true: a site whose Content Security Policy blocks the
 * script cannot run it, and the product ships no content model. These strings
 * are also the first thing a visitor reads, in a search result or a shared
 * link, before they ever reach the corrected homepage.
 */

jest.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const TITLE = "ReCopyFast - Edit your website copy in place";
const DESCRIPTION =
  "Make the copy on the site you already built editable, with one script tag.";

describe("site metadata", () => {
  it("titles the site by what it does", () => {
    expect((metadata.title as { default: string }).default).toBe(TITLE);
    expect(metadata.openGraph?.title).toBe(TITLE);
    expect(metadata.twitter?.title).toBe(TITLE);
  });

  it("describes it as one script tag on the site you already built", () => {
    expect(metadata.description).toBe(DESCRIPTION);
    expect(metadata.openGraph?.description).toBe(DESCRIPTION);
    expect(metadata.twitter?.description).toBe(DESCRIPTION);
    expect(metadata.keywords).not.toContain("headless CMS");
  });

  it("keeps the manifest in step", () => {
    expect(manifest().name).toBe(TITLE);
    expect(manifest().description).toBe(DESCRIPTION);
  });

  it("serves the approved 1200x630 PNG through both social image routes", async () => {
    expect(alt).toBe(
      "ReCopyFast editorial illustration of client change requests looping to a freelancer: You built the site. Now you’re stuck updating it. Let clients edit the words. Make time for the work that matters.",
    );
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(twitterAlt).toBe(alt);
    expect(twitterSize).toEqual(size);
    expect(twitterContentType).toBe(contentType);

    const [openGraphResponse, twitterResponse] = await Promise.all([
      OpenGraphImage(),
      TwitterImage(),
    ]);
    const [openGraphBytes, twitterBytes] = await Promise.all([
      responseBytes(openGraphResponse),
      responseBytes(twitterResponse),
    ]);

    expect(openGraphResponse.headers.get("content-type")).toBe("image/png");
    expect(twitterResponse.headers.get("content-type")).toBe("image/png");
    expect(openGraphBytes.byteLength).toBeGreaterThan(0);
    expect(openGraphBytes.byteLength).toBeLessThan(5 * 1024 * 1024);
    expect(openGraphBytes.subarray(0, 8)).toEqual(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(readPngDimensions(openGraphBytes)).toEqual({
      width: 1200,
      height: 630,
    });
    expect(createHash("sha256").update(openGraphBytes).digest("hex")).toBe(
      "1dabbbe9442e487dd905b03026b43e0fd5216099a750c4d0f1fd1ad114577741",
    );
    expect(twitterBytes).toEqual(openGraphBytes);
  });
});

async function responseBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

function readPngDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}
