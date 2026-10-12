/**
 * The free tools' only way out to the internet (s96, plan decision 4).
 *
 * `POST /api/tools/scan` lets ANYONE, unauthenticated, make our infrastructure
 * fetch a URL of their choosing. That is an SSRF primitive unless every
 * connection is guarded, so this is not `fetch()`:
 *
 * - IP-LITERAL HOSTS ARE CLASSIFIED HERE, before a socket exists. Node never
 *   calls `lookup` for a literal, so `http://127.0.0.1/`, `http://2130706433/`
 *   (WHATWG rewrites it to 127.0.0.1) or `http://[::ffff:7f00:1]/` would
 *   otherwise connect unchecked. `net.isIP` is the exact test Node uses to skip
 *   the lookup, so the two cannot disagree about what a literal is.
 * - HOSTNAMES connect through `createValidatingLookup`: the address validated
 *   is the address dialled, on every hop (no DNS-rebinding window — the gap
 *   `webhook-url-safety.ts` records and leaves open).
 * - `agent: false`. Node 24 sends the DEFAULT agent through HTTP(S)_PROXY when
 *   started with NODE_USE_ENV_PROXY=1, and through a proxy our lookup never
 *   runs — the proxy resolves the name. Verified on 24.14; pinned by a test that
 *   starts a child process with that environment. Do not "reuse connections"
 *   with a shared agent.
 * - REDIRECTS ARE MANUAL, at most 3, and every `Location` goes through the same
 *   normalisation (scheme, default port, no user info), the denylist, the URL
 *   authoriser (robots.txt) and the address checks as the first hop.
 * - The 2 MB cap counts DECOMPRESSED bytes, while streaming. A 30 KB gzip that
 *   inflates to 20 MB stops at the cap; a declared Content-Length over it is
 *   refused before a byte is read.
 * - One deadline per request (8 s) and the scan's own deadline, whichever comes
 *   first, cover connect, headers AND body — a server that trickles one byte at
 *   a time is still a timeout.
 * - No cookie, no Referer, an honest user agent that links to the page saying
 *   what the scanner is and how to opt out.
 *
 * Failures are reason codes, never exception text: an anonymous caller must not
 * learn what our resolver answered, and the route maps each code to fixed copy.
 *
 * The policy and resolver are PARAMETERS with strict defaults. The tests inject
 * them to reach a loopback fixture; production code passes nothing and reads no
 * environment variable that could loosen them.
 */

import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { Transform, Writable, pipeline, type Readable } from "node:stream";
import zlib from "node:zlib";

import { unwrapHostname } from "@/lib/security/public-address";
import {
  SCANNER_PRODUCT_TOKEN,
  SCANNER_USER_AGENT,
} from "@/lib/tools/scanner-identity";
import {
  normalizeScanUrl,
  DEFAULT_PORT_RULE,
  type NormalizedScanUrl,
  type PortRule,
} from "@/lib/tools/scan/normalize-url";
import { captureHeaders, type CapturedHeaders } from "./captured-headers";
import {
  BlockedAddressError,
  createValidatingLookup,
  LookupFailedError,
  PUBLIC_ADDRESS_RULE,
  SYSTEM_RESOLVER,
  type AddressRule,
  type Resolver,
} from "./validating-lookup";

export { SCANNER_PRODUCT_TOKEN, SCANNER_USER_AGENT };

export const DEFAULT_TIMEOUT_MS = 8_000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
/** Robots, homepage, ≤ 2 sitemap fetches, ≤ 9 pages, plus their redirects. */
export const MAX_REQUESTS_PER_SCAN = 24;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type FetchKind = "html" | "sitemap" | "robots";

export type FetchFailureReason =
  | "invalid_url"
  | "blocked_address"
  | "blocked_port"
  | "dns"
  | "timeout"
  | "too_large"
  | "not_html"
  | "http_status"
  | "redirect_limit"
  | "redirect_invalid"
  | "unreachable"
  | "denylisted"
  | "robots_disallowed"
  | "request_limit";

export interface FetchPolicy {
  isAllowedAddress: AddressRule;
  isAllowedPort: PortRule;
}

export const STRICT_FETCH_POLICY: FetchPolicy = {
  isAllowedAddress: PUBLIC_ADDRESS_RULE,
  isAllowedPort: DEFAULT_PORT_RULE,
};

/** How many requests one scan may still make. Shared by its concurrent fetches. */
export interface RequestBudget {
  take(): boolean;
  used(): number;
}

export function createRequestBudget(max: number): RequestBudget {
  let spent = 0;
  return {
    take() {
      if (spent >= max) return false;
      spent += 1;
      return true;
    },
    used: () => spent,
  };
}

export interface SafeFetchOptions {
  kind: FetchKind;
  budget: RequestBudget;
  policy?: FetchPolicy;
  resolver?: Resolver;
  /** The operator denylist, applied to every hop's host. */
  isDenylistedHost?: (hostname: string) => boolean;
  /** Asked before every hop (robots.txt in production). A reason refuses it. */
  authorizeUrl?: (url: NormalizedScanUrl) => Promise<FetchFailureReason | null>;
  timeoutMs?: number;
  /** Epoch ms after which nothing may still be in flight (the scan's deadline). */
  deadline?: number;
  maxBytes?: number;
}

export interface FetchedDocument {
  /** The final URL, normalised (no query, no fragment). */
  url: string;
  status: number;
  contentType: string;
  body: string;
  headers: CapturedHeaders;
}

export type SafeFetchResult =
  | { ok: true; value: FetchedDocument }
  | {
      ok: false;
      reason: FetchFailureReason;
      bytesRead: number;
      /** Present on `http_status`: robots.txt reads a 4xx and a 5xx differently. */
      status?: number;
    };

const ACCEPT: Record<FetchKind, string> = {
  html: "text/html,application/xhtml+xml",
  sitemap: "application/xml,text/xml,text/plain,application/gzip",
  robots: "text/plain",
};

const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const SITEMAP_TYPES = new Set(["application/xml", "text/xml", "text/plain"]);
const GZIP_TYPES = new Set(["application/gzip", "application/x-gzip"]);

class TooLargeError extends Error {
  constructor() {
    super("too large");
    this.name = "TooLargeError";
  }
}

function fail(reason: FetchFailureReason, bytesRead = 0): SafeFetchResult {
  return { ok: false, reason, bytesRead };
}

function failStatus(status: number): SafeFetchResult {
  return { ok: false, reason: "http_status", bytesRead: 0, status };
}

function mediaType(header: string | undefined): string {
  return (header ?? "").split(";")[0].trim().toLowerCase();
}

/** Whether this body is a gzip FILE (a `.gz` sitemap), beyond any transfer encoding. */
function isGzipFile(kind: FetchKind, type: string, url: URL): boolean {
  if (kind !== "sitemap") return false;
  if (GZIP_TYPES.has(type)) return true;
  return type === "application/octet-stream" && url.pathname.endsWith(".gz");
}

function acceptsType(kind: FetchKind, type: string, url: URL): boolean {
  if (kind === "html") return HTML_TYPES.has(type);
  if (kind === "robots") return type === "text/plain" || type === "";
  return SITEMAP_TYPES.has(type) || isGzipFile(kind, type, url);
}

/**
 * The decoder for a Content-Encoding, or null when it is one we do not speak.
 * `deflate` is sent both zlib-wrapped (RFC 9110) and raw (old IIS); the first
 * byte tells them apart, so the choice is deferred to it.
 */
function decoderFor(
  encoding: string,
): Transform | null | "deflate" | "unsupported" {
  switch (encoding) {
    case "":
    case "identity":
      return null;
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip();
    case "br":
      return zlib.createBrotliDecompress();
    case "deflate":
      return "deflate";
    default:
      return "unsupported";
  }
}

/** Sniffs zlib-wrapped versus raw deflate on the first chunk, then streams. */
function createDeflateDecoder(): Transform {
  let inner: Transform | null = null;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (!inner) {
        const isZlib =
          chunk.length >= 2 &&
          (chunk[0] & 0x0f) === 8 &&
          ((chunk[0] << 8) | chunk[1]) % 31 === 0;
        inner = isZlib ? zlib.createInflate() : zlib.createInflateRaw();
        inner.on("data", (out: Buffer) => this.push(out));
        inner.on("error", (error) => this.destroy(error));
      }
      inner.write(chunk, callback);
    },
    flush(callback) {
      if (!inner) return callback();
      inner.once("end", () => callback());
      inner.end();
    },
  });
}

/** Counts bytes through a point in the chain and fails past `max`. */
function createByteCounter(
  max: number,
  onCount: (total: number) => void,
): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      onCount(total);
      if (total > max) return callback(new TooLargeError());
      callback(null, chunk);
    },
  });
}

const CHARSET_IN_TYPE = /charset\s*=\s*["']?([\w.:-]+)/i;
const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i;

/**
 * Header first, then `<meta charset>` / `http-equiv` in the first kilobyte,
 * then UTF-8. Labels are WHATWG's (`iso-8859-1` decodes as windows-1252, as a
 * browser would). An unknown label falls back to UTF-8 rather than throwing.
 */
function decodeBody(body: Buffer, contentType: string | undefined): string {
  const declared =
    CHARSET_IN_TYPE.exec(contentType ?? "")?.[1] ??
    META_CHARSET.exec(body.subarray(0, 1024).toString("latin1"))?.[1];
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(declared ?? "utf-8");
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(body);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function reasonForRequestError(
  error: unknown,
  signal: AbortSignal,
): FetchFailureReason {
  if (signal.aborted) return "timeout";
  if (error instanceof BlockedAddressError) return "blocked_address";
  if (error instanceof LookupFailedError) return "dns";
  const code = errorCode(error);
  if (code === "ERR_RCF_BLOCKED_ADDRESS") return "blocked_address";
  if (code === "ERR_RCF_DNS") return "dns";
  return "unreachable";
}

interface HopOutcome {
  response?: IncomingMessage;
  failure?: FetchFailureReason;
}

/** One request, to one already-guarded URL. Resolves when headers arrive. */
function request(
  url: URL,
  kind: FetchKind,
  policy: FetchPolicy,
  resolver: Resolver,
  signal: AbortSignal,
): Promise<HopOutcome> {
  const host = unwrapHostname(url.hostname);
  const isLiteral = isIP(host) !== 0;
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: HopOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    let req: http.ClientRequest;
    try {
      req = transport.request({
        protocol: url.protocol,
        hostname: host,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}`,
        method: "GET",
        agent: false,
        lookup: isLiteral
          ? undefined
          : createValidatingLookup(policy.isAllowedAddress, resolver),
        // TLS verifies the certificate against the name we asked for.
        ...(url.protocol === "https:" && !isLiteral
          ? { servername: host }
          : {}),
        signal,
        headers: {
          "User-Agent": SCANNER_USER_AGENT,
          Accept: ACCEPT[kind],
          "Accept-Encoding": "gzip, deflate, br",
        },
      });
    } catch (error) {
      settle({ failure: reasonForRequestError(error, signal) });
      return;
    }

    req.on("response", (response) => settle({ response }));
    req.on("error", (error) =>
      settle({ failure: reasonForRequestError(error, signal) }),
    );
    req.end();
  });
}

/** Streams, decompresses and caps the body; resolves with the decoded bytes. */
function readBody(
  response: IncomingMessage,
  decoders: Transform[],
  maxBytes: number,
  signal: AbortSignal,
): Promise<
  | { ok: true; body: Buffer }
  | { ok: false; reason: FetchFailureReason; bytesRead: number }
> {
  return new Promise((resolve) => {
    let decodedBytes = 0;
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    const streams: (Readable | Transform | Writable)[] = [
      response,
      createByteCounter(maxBytes, () => undefined),
      ...decoders,
      createByteCounter(maxBytes, (total) => {
        decodedBytes = total;
      }),
      sink,
    ];
    pipeline(streams as unknown as [Readable, Writable], (error) => {
      if (!error) {
        resolve({ ok: true, body: Buffer.concat(chunks) });
        return;
      }
      response.destroy();
      if (error instanceof TooLargeError) {
        resolve({ ok: false, reason: "too_large", bytesRead: decodedBytes });
      } else if (signal.aborted) {
        resolve({ ok: false, reason: "timeout", bytesRead: decodedBytes });
      } else {
        resolve({ ok: false, reason: "unreachable", bytesRead: decodedBytes });
      }
    });
  });
}

/**
 * Fetch one document through every guard above. Never throws.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const policy = options.policy ?? STRICT_FETCH_POLICY;
  const resolver = options.resolver ?? SYSTEM_RESOLVER;
  const maxBytes = options.maxBytes ?? MAX_BODY_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const remaining = (options.deadline ?? Number.POSITIVE_INFINITY) - Date.now();
  if (remaining <= 0) return fail("timeout");

  // One timer for the whole document, redirects included: a chain of slow
  // hops must not add up to more than one request's allowance.
  const signal = AbortSignal.timeout(
    Math.max(1, Math.min(timeoutMs, remaining)),
  );

  let next: string = rawUrl;
  for (let hop = 0; ; hop += 1) {
    const normalized = normalizeScanUrl(next, {
      isAllowedPort: policy.isAllowedPort,
    });
    if (!normalized.ok) {
      if (normalized.reason === "blocked_port") return fail("blocked_port");
      return fail(hop === 0 ? "invalid_url" : "redirect_invalid");
    }
    const target = normalized.value;

    if (options.isDenylistedHost?.(target.hostname)) return fail("denylisted");
    const refusal = await options.authorizeUrl?.(target);
    if (refusal) return fail(refusal);
    if (signal.aborted) return fail("timeout");

    const url = new URL(target.href);
    const host = unwrapHostname(url.hostname);
    if (isIP(host) !== 0 && !policy.isAllowedAddress(host)) {
      return fail("blocked_address");
    }

    if (!options.budget.take()) return fail("request_limit");

    const { response, failure } = await request(
      url,
      options.kind,
      policy,
      resolver,
      signal,
    );
    if (!response) return fail(failure ?? "unreachable");

    const status = response.statusCode ?? 0;
    if (REDIRECT_STATUSES.has(status)) {
      const location = response.headers.location;
      response.destroy();
      if (!location) return failStatus(status);
      if (hop >= MAX_REDIRECTS) return fail("redirect_limit");
      try {
        next = new URL(location, url).href;
      } catch {
        return fail("redirect_invalid");
      }
      continue;
    }

    if (status < 200 || status > 299) {
      response.destroy();
      return failStatus(status);
    }

    const type = mediaType(response.headers["content-type"]);
    if (!acceptsType(options.kind, type, url)) {
      response.destroy();
      return fail("not_html");
    }

    const declared = Number(response.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      response.destroy();
      return fail("too_large");
    }

    const encoding = (response.headers["content-encoding"] ?? "")
      .toString()
      .trim()
      .toLowerCase();
    const decoder = decoderFor(encoding);
    if (decoder === "unsupported") {
      response.destroy();
      return fail("unreachable");
    }
    const decoders: Transform[] = [];
    if (decoder === "deflate") decoders.push(createDeflateDecoder());
    else if (decoder) decoders.push(decoder);
    if (isGzipFile(options.kind, type, url)) decoders.push(zlib.createGunzip());

    const body = await readBody(response, decoders, maxBytes, signal);
    if (!body.ok) return fail(body.reason, body.bytesRead);

    return {
      ok: true,
      value: {
        url: target.href,
        status,
        contentType: type,
        body: decodeBody(body.body, response.headers["content-type"]),
        headers: captureHeaders(response.headers),
      },
    };
  }
}
