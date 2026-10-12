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
 *   normalisation (scheme, default port, no user info), the denylist, the host
 *   authoriser (the per-target cap), the URL authoriser (robots.txt) and the
 *   address checks as the first hop.
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
  | "request_limit"
  /** The host authoriser refused the hop (the per-target hourly cap). */
  | "target_limited";

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
  /**
   * Asked for every hop's host before anything else may reach it — the URL
   * authoriser's robots.txt fetch included (the per-target cap in
   * production). A reason refuses the hop. REQUIRED (verification review of
   * e7bdd09, F3): a caller that forgets it is a type error, not an uncharged
   * scan; a test that means "allow every host" says so with a stub.
   */
  authorizeHost: (hostname: string) => Promise<FetchFailureReason | null>;
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

type ContentDecoding = "gzip" | "br" | "deflate";

/**
 * The decoding a Content-Encoding asks for: null for none, "unsupported" for
 * one we do not speak. The decoder itself is only created once the body is
 * known not to be empty (`decodersFor`).
 */
function decodingFor(encoding: string): ContentDecoding | null | "unsupported" {
  switch (encoding) {
    case "":
    case "identity":
      return null;
    case "gzip":
    case "x-gzip":
      return "gzip";
    case "br":
      return "br";
    case "deflate":
      return "deflate";
    default:
      return "unsupported";
  }
}

/**
 * The decoder chain for a body whose first chunk is `first`.
 *
 * - An EMPTY body (`first` null) gets no decoder at all (s96 review round 2,
 *   nit 6): a decoder fed zero bytes calls it a truncated stream, and an
 *   empty 200 sent with `Content-Encoding: gzip` read as `unreachable`.
 * - `deflate` is sent both zlib-wrapped (RFC 9110) and raw (old IIS); the
 *   first byte tells them apart (`isZlibHeader`).
 * - A gzip FILE (a `.gz` sitemap) is decoded after any Content-Encoding.
 */
function decodersFor(
  decoding: ContentDecoding | null,
  isGzipFileBody: boolean,
  first: Buffer | null,
): Transform[] {
  if (first === null) return [];
  const decoders: Transform[] = [];
  if (decoding === "gzip") decoders.push(zlib.createGunzip());
  if (decoding === "br") decoders.push(zlib.createBrotliDecompress());
  if (decoding === "deflate") {
    decoders.push(
      isZlibHeader(first) ? zlib.createInflate() : zlib.createInflateRaw(),
    );
  }
  if (isGzipFileBody) decoders.push(zlib.createGunzip());
  return decoders;
}

/**
 * The first chunk of a body, put back for the pipeline to read, or null when
 * the body is empty or failed. Lets `deflate` pick zlib-wrapped or raw
 * inflate from its first bytes WITHOUT a wrapper stream. (Until the s96
 * review the choice was a Transform wrapping an inner inflater whose output it
 * pushed without backpressure and never destroyed — a deflate bomb inflated
 * into memory long after the cap.)
 */
function peekFirstChunk(stream: Readable): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const cleanup = () => {
      stream.off("readable", onReadable);
      stream.off("end", onDone);
      stream.off("close", onDone);
      stream.off("error", onDone);
    };
    const onReadable = () => {
      const chunk = stream.read() as Buffer | null;
      if (chunk === null) return;
      cleanup();
      stream.unshift(chunk);
      resolve(chunk);
    };
    const onDone = () => {
      cleanup();
      resolve(null);
    };
    stream.on("readable", onReadable);
    stream.once("end", onDone);
    stream.once("close", onDone);
    stream.once("error", onDone);
  });
}

/**
 * Whether a deflate body is zlib-wrapped, from its FIRST BYTE alone: CM = 8
 * (deflate) and CINFO ≤ 7 (s96 review round 2, nit 5). It used to need two
 * bytes for the FCHECK, so a one-byte first chunk picked raw inflate for a
 * zlib body — the answer depended on how the bytes were chunked.
 */
function isZlibHeader(chunk: Buffer): boolean {
  return chunk.length >= 1 && (chunk[0] & 0x0f) === 8 && chunk[0] >> 4 <= 7;
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

type BodyResult =
  | { ok: true; body: Buffer }
  | { ok: false; reason: FetchFailureReason; bytesRead: number };

/**
 * Streams, decompresses and caps the body; resolves with the decoded bytes.
 *
 * SETTLES ON THE FIRST SIGNAL, AND DESTROYS EVERY STREAM ITSELF (s96 review,
 * major 1). It used to resolve only from `pipeline`'s callback. With a
 * decompression bomb — 200 KB of gzip inflating to 200 MB — the decoded-byte
 * counter trips after the RESPONSE has already ended; `pipeline` then waits
 * for every stream to close, the inflater is mid-chunk, the callback never
 * fires, and the abort signal cannot help because the socket is already
 * closed. Measured: hung past 12 s, 3 runs of 3, and `runScan` past 25 s with
 * a 3 s deadline. Now the first error from ANY stream, the abort signal, or
 * the pipeline's own end settles the promise once, and every stream is
 * destroyed on the way out. `pipeline` is kept for its backpressure.
 *
 * EVERY DECODER'S OUTPUT IS COUNTED AND CAPPED (s96 review round 2, minor 4),
 * not only the last one's. A `.xml.gz` sitemap under `Content-Encoding: gzip`
 * has two decoders; with a counter after the last only, an inner file of
 * empty gzip members (decoding to nothing) let the outer layer inflate
 * without limit — 0.86 GB in the review's measurement.
 */
function readBody(
  response: IncomingMessage,
  decoders: Transform[],
  maxBytes: number,
  signal: AbortSignal,
): Promise<BodyResult> {
  return new Promise((resolve) => {
    let decodedBytes = 0;
    let isSettled = false;
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    const countDecoded = () =>
      createByteCounter(maxBytes, (total) => {
        decodedBytes = Math.max(decodedBytes, total);
      });
    const streams: (Readable | Transform | Writable)[] = [
      response,
      createByteCounter(maxBytes, () => undefined),
      ...decoders.flatMap((decoder) => [decoder, countDecoded()]),
      ...(decoders.length === 0 ? [countDecoded()] : []),
      sink,
    ];

    const failureFor = (error: unknown): BodyResult => {
      if (error instanceof TooLargeError) {
        return { ok: false, reason: "too_large", bytesRead: decodedBytes };
      }
      if (signal.aborted) {
        return { ok: false, reason: "timeout", bytesRead: decodedBytes };
      }
      return { ok: false, reason: "unreachable", bytesRead: decodedBytes };
    };
    const onAbort = () =>
      settle({ ok: false, reason: "timeout", bytesRead: decodedBytes });
    const settle = (result: BodyResult) => {
      if (isSettled) return;
      isSettled = true;
      signal.removeEventListener("abort", onAbort);
      for (const stream of streams) stream.destroy();
      resolve(result);
    };

    for (const stream of streams) {
      stream.once("error", (error) => settle(failureFor(error)));
    }
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    pipeline(streams as unknown as [Readable, Writable], (error) => {
      settle(
        error ? failureFor(error) : { ok: true, body: Buffer.concat(chunks) },
      );
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
    const hostRefusal = await options.authorizeHost(target.hostname);
    if (hostRefusal) return fail(hostRefusal);
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
    const decoding = decodingFor(encoding);
    if (decoding === "unsupported") {
      response.destroy();
      return fail("unreachable");
    }
    const isGzipFileBody = isGzipFile(options.kind, type, url);
    const decoders =
      decoding !== null || isGzipFileBody
        ? decodersFor(decoding, isGzipFileBody, await peekFirstChunk(response))
        : [];

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
