import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt =
  "ReCopyFast editorial illustration of client change requests looping to a freelancer: You built the site. Now you’re stuck updating it. Let clients edit the words. Make time for the work that matters.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * s113 replaces the generated generic card with the owner-approved product
 * creative. Read the immutable file once at module load so requests never
 * regenerate an image or depend on a network service. Keep this literal path:
 * Next's output tracer needs to see the production asset during the build.
 */
const socialCard = readFile(
  join(
    process.cwd(),
    "src/app/assets/recopyfast-social-card-developer-bottleneck-2026-10-14.png",
  ),
);

export default async function OpenGraphImage(): Promise<Response> {
  return new Response(new Uint8Array(await socialCard), {
    headers: { "Content-Type": contentType },
  });
}
