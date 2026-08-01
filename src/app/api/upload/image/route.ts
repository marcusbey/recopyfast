/**
 * POST /api/upload/image — image upload for the embed widget and the dashboard.
 *
 * Replaces the widget's previous behaviour of inlining a FileReader data URI
 * into the element's content value. A 2 MB photo became ~2.7 MB of base64 in
 * `content_elements.current_content`, and the `log_content_change()` trigger
 * copied that blob into `content_history` on *every* subsequent edit of the
 * element. This endpoint stores the bytes once and hands back a URL.
 *
 * Contract (agreed with the widget agent):
 *   multipart/form-data: file=<File>, siteId=<uuid>
 *   Authorization: Bearer <site token>
 *   → 200 { url, width, height }
 *   → 400 invalid type/size · 401 unauthorized · 413 too large
 *
 * Threat model: any holder of a site token can reach this route with arbitrary
 * bytes. Nothing the client says about the file is believed — see
 * @/lib/images/sniff and @/lib/images/process.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeSiteRequest } from "@/lib/security/site-auth";
import { extractSiteToken } from "@/lib/security/ingest-auth";
import { enforceRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { requireUuid } from "@/lib/api/validation";
import { isRasterFormat, sniffImageFormat } from "@/lib/images/sniff";
import { normalizeImage } from "@/lib/images/process";
import { uploadSiteAsset } from "@/lib/storage/upload";

// sharp is a native module and the route reads request headers, so this handler
// must run on the Node.js runtime rather than the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Maximum accepted upload.
 *
 * Deliberately 4 MB rather than a rounder, larger number: Vercel caps a
 * serverless function's request body at 4.5 MB, and that rejection happens in
 * the platform *before* this handler runs — it would surface to the widget as an
 * opaque 413 with no JSON body. Staying under the platform ceiling keeps the
 * error ours, so the client always gets a structured, explainable response.
 * Raising this limit requires moving to direct-to-storage uploads, not a bigger
 * constant here.
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * The widget runs on customer domains, so this is a cross-origin call.
 * A wildcard does not widen access: `authorizeSiteRequest` pins the request's
 * Origin to the site's registered domain, and credentials are never allowed.
 */
function withCors(response: NextResponse): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-Site-Token",
  );
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return response;
}

function errorResponse(message: string, status: number): NextResponse {
  return withCors(NextResponse.json({ error: message }, { status }));
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: NextRequest) {
  try {
    // ---- 1. Per-IP throttle, before any body is read ------------------------
    // This is the only guard that applies to an unauthenticated caller, and it
    // is what keeps a token-less flood from repeatedly buffering 4 MB bodies.
    const ipLimited = await enforceRateLimit(request, {
      limit: "API_UPLOAD",
      endpoint: "upload/image:ip",
      identifier: getClientIp(request),
      identifierType: "ip",
      // "deny". Every accepted upload costs permanent billed storage, CPU for a
      // full decode/re-encode, and egress forever after. Those are exactly the
      // costs the rate limiter exists to bound, so losing the store must not
      // silently remove the only control standing in front of them. Contrast
      // with telemetry ingest, which fails open because a dropped page view is
      // cheaper than a broken widget.
      onStoreFailure: "deny",
      message: "Too many uploads. Please wait before uploading again.",
    });
    if (ipLimited) return withCors(ipLimited);

    // ---- 2. Reject oversized bodies before buffering them -------------------
    // Content-Length is attacker-controlled and is re-checked against the real
    // byte count below; this is a cheap fast path, not the enforcement point.
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
      return errorResponse(
        `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`,
        413,
      );
    }

    // ---- 3. Parse the multipart body ---------------------------------------
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResponse("Request body must be multipart/form-data", 400);
    }

    const siteId = requireUuid({ siteId: form.get("siteId") }, "siteId");
    if (!siteId.ok) {
      return errorResponse(siteId.error, 400);
    }

    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return errorResponse('Field "file" is required', 400);
    }

    // ---- 4. Authenticate the site ------------------------------------------
    // Proves possession of the site's API key and pins the Origin to the site's
    // registered domain. `siteId` is only trusted after this returns.
    try {
      await authorizeSiteRequest({
        siteId: siteId.value,
        token: extractSiteToken(request),
        origin: request.headers.get("origin"),
        referer: request.headers.get("referer"),
      });
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : "Unauthorized",
        401,
      );
    }

    // ---- 5. Per-site throttle ----------------------------------------------
    // Keyed on the site, not the IP, so a distributed flood behind many
    // addresses still lands in one bucket, and one noisy tenant cannot consume
    // another tenant's allowance.
    const siteLimited = await enforceRateLimit(request, {
      limit: "API_UPLOAD",
      endpoint: "upload/image:site",
      identifier: siteId.value,
      identifierType: "api_key",
      onStoreFailure: "deny",
      message: "Too many uploads for this site. Please wait and try again.",
    });
    if (siteLimited) return withCors(siteLimited);

    // ---- 6. Size, enforced on the actual bytes ------------------------------
    if (file.size > MAX_UPLOAD_BYTES) {
      return errorResponse(
        `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`,
        413,
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    if (bytes.byteLength === 0) {
      return errorResponse("File is empty", 400);
    }
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      return errorResponse(
        `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`,
        413,
      );
    }

    // ---- 7. Identify the file from its bytes --------------------------------
    const sniffed = sniffImageFormat(bytes);

    if (!sniffed) {
      return errorResponse(
        "File is not a supported image (png, jpeg, gif, webp, avif)",
        400,
      );
    }

    if (!isRasterFormat(sniffed.format)) {
      // SVG is refused rather than sanitised. It is an active document: script
      // elements, event-handler attributes, external entity references and
      // xlink:href payloads all execute when the file is opened directly. Since
      // the bucket is public and served from our own storage origin, a stored
      // SVG would be a same-origin XSS primitive against that domain. Safe
      // sanitisation needs a real DOM-aware sanitiser and a strict allowlist,
      // and even mature ones have been bypassed repeatedly. The product does not
      // need SVG uploads, so the whole class is declined.
      return errorResponse(
        "SVG uploads are not supported. Please upload a PNG, JPEG, GIF, WebP, or AVIF image.",
        400,
      );
    }

    // ---- 8. Decode, strip metadata, re-encode -------------------------------
    const processed = await normalizeImage(bytes, sniffed.format);
    if (!processed.ok) {
      return errorResponse(processed.error, 400);
    }

    // ---- 9. Store -----------------------------------------------------------
    const uploaded = await uploadSiteAsset({
      siteId: siteId.value,
      data: processed.value.data,
      contentType: processed.value.contentType,
      extension: sniffed.extension,
    });

    if (!uploaded.ok) {
      return errorResponse(uploaded.error, 500);
    }

    return withCors(
      NextResponse.json({
        url: uploaded.value.url,
        width: processed.value.width,
        height: processed.value.height,
      }),
    );
  } catch (error) {
    console.error("Image upload failed:", error);
    return errorResponse("Failed to upload image", 500);
  }
}
