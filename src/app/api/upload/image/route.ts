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
 *   X-RCF-Editor-Grant header or editToken/stagingToken multipart field
 *   → 200 { url, width, height }
 *   → 400 invalid type/size · 401 unauthorized · 413 too large
 *
 * Threat model: the public site token identifies a site but never authorizes
 * permanent storage. A verified editor with edit permission and an entitled
 * site owner is required before bytes are decoded or stored. Nothing the
 * client says about the file is believed — see @/lib/images/sniff and
 * @/lib/images/process.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireEditorPermission,
  validateEditorTokenFromRequest,
} from "@/lib/auth/editor-access";
import {
  checkOwnerCanEdit,
  ownerCanEditRefusal,
} from "@/lib/billing/owner-can-edit";
import { enforceRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { canonicalSiteId } from "@/lib/api/validation";
import { publicOptions, withPublicCors } from "@/lib/http/public-cors";
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

const ALLOWED_METHODS = "POST, OPTIONS";

function errorResponse(message: string, status: number): NextResponse {
  return withPublicCors(
    NextResponse.json({ error: message }, { status }),
    undefined,
    ALLOWED_METHODS,
  );
}

export async function OPTIONS(request?: NextRequest) {
  return publicOptions(request, ALLOWED_METHODS);
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
    if (ipLimited) return withPublicCors(ipLimited, request, ALLOWED_METHODS);

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

    const siteId = canonicalSiteId(form.get("siteId"));
    if (!siteId.ok) {
      return errorResponse(siteId.error, 400);
    }

    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return errorResponse('Field "file" is required', 400);
    }

    // ---- 4. Authenticate an editor -----------------------------------------
    // October 2026's M5 audit found this route accepting the public site token,
    // which is printed in page source and forgeable with a matching Origin.
    // Multipart carries only edit-session/staging credentials; device grants
    // remain header-only so they never leak into bodies, URLs or logs.
    const tokenBody: Record<string, string> = {};
    const editToken = form.get("editToken");
    const stagingToken = form.get("stagingToken");
    if (typeof editToken === "string" && editToken.length > 0) {
      tokenBody.editToken = editToken;
    }
    if (typeof stagingToken === "string" && stagingToken.length > 0) {
      tokenBody.stagingToken = stagingToken;
    }

    const validation = await validateEditorTokenFromRequest({
      request,
      siteId: siteId.value,
      body: tokenBody,
    });
    if (!validation.valid || !validation.access) {
      return errorResponse(
        validation.error || "Invalid editor token",
        validation.status || 401,
      );
    }
    if (!requireEditorPermission(validation.access, "edit")) {
      return errorResponse("Requires 'edit' permission", 403);
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
    if (siteLimited)
      return withPublicCors(siteLimited, request, ALLOWED_METHODS);

    // ---- 6. Owner entitlement ----------------------------------------------
    // Uploads are permanent billed writes. Like every other editor write, the
    // credential proves who may act and the owner's live plan decides whether
    // the site may change. A lookup outage fails closed with the shared 503.
    const ownerCanEdit = await checkOwnerCanEdit(siteId.value);
    if (!ownerCanEdit.ok) {
      return withPublicCors(
        ownerCanEditRefusal(ownerCanEdit),
        request,
        ALLOWED_METHODS,
      );
    }

    // ---- 7. Size, enforced on the actual bytes ------------------------------
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

    // ---- 8. Identify the file from its bytes --------------------------------
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

    // ---- 9. Decode, strip metadata, re-encode -------------------------------
    const processed = await normalizeImage(bytes, sniffed.format);
    if (!processed.ok) {
      return errorResponse(processed.error, 400);
    }

    // ---- 10. Store ----------------------------------------------------------
    const uploaded = await uploadSiteAsset({
      siteId: siteId.value,
      data: processed.value.data,
      contentType: processed.value.contentType,
      extension: sniffed.extension,
    });

    if (!uploaded.ok) {
      return errorResponse(uploaded.error, 500);
    }

    return withPublicCors(
      NextResponse.json({
        url: uploaded.value.url,
        width: processed.value.width,
        height: processed.value.height,
      }),
      request,
      ALLOWED_METHODS,
    );
  } catch (error) {
    console.error("Image upload failed:", error);
    return errorResponse("Failed to upload image", 500);
  }
}
