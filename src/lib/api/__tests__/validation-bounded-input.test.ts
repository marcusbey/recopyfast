/**
 * @jest-environment node
 */

/**
 * PR #65 review D3 and D4 — two edges of the bounded-input helpers that the
 * public A/B track route (`POST /api/ab-tests/track`) leans on.
 *
 * D3: `coerceText` kept a lone UTF-16 surrogate. `JSON.stringify` writes it as
 * a `\ud800` escape, which Postgres `jsonb` refuses — so one stray code unit in
 * a host page's `trackConversion(eventName)` failed the insert of the whole
 * beacon. A lone surrogate becomes U+FFFD; a valid pair is kept whole.
 *
 * D4: `readBoundedJson` buffered the entire body (`request.text()`) and only
 * then compared it with the cap, so the 64 KB bound cost whatever the client
 * chose to send. It now refuses a declared `Content-Length` over the cap
 * without reading, and otherwise counts bytes as they stream in, giving up as
 * soon as the running total passes the cap.
 *
 * Real `Request` objects (node environment), so `request.body` is the stream
 * the runtime hands the route.
 */

import { coerceText, readBoundedJson } from "@/lib/api/validation";

const CAP = 4096;
const CHUNK = 1024;
const REFUSAL = { ok: false, error: `Request body exceeds ${CAP} bytes` };

/**
 * A body that never ends. Each read yields one CHUNK; a read past
 * CAP + CHUNK errors the stream, so a reader that keeps going past one chunk
 * over the cap gets "could not be read", never the size refusal.
 * `highWaterMark: 0` — nothing is pulled until someone reads.
 */
function endlessBody() {
  const state = { delivered: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (state.delivered >= CAP + CHUNK) {
          controller.error(new Error("read past the cap plus one chunk"));
          return;
        }
        state.delivered += CHUNK;
        controller.enqueue(new Uint8Array(CHUNK).fill(0x20));
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

/** A finite body delivered in the given chunks. */
function chunkedBody(chunks: Uint8Array[]) {
  let index = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]);
        else controller.close();
      },
    },
    { highWaterMark: 0 },
  );
}

function post(
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
) {
  return new Request("https://recopyfast.com/api/ab-tests/track", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("readBoundedJson — the cap is enforced while reading, not after buffering", () => {
  it("refuses a body over the cap with no Content-Length after reading at most one chunk past it", async () => {
    const { stream, state } = endlessBody();

    const result = await readBoundedJson(post(stream), CAP);

    expect(result).toEqual(REFUSAL);
    expect(state.delivered).toBeLessThanOrEqual(CAP + CHUNK);
    expect(state.cancelled).toBe(true);
  });

  it("refuses a declared Content-Length over the cap before reading the body", async () => {
    const { stream, state } = endlessBody();

    const result = await readBoundedJson(
      post(stream, { "Content-Length": String(CAP + 1) }),
      CAP,
    );

    expect(result).toEqual(REFUSAL);
    expect(state.delivered).toBe(0);
  });

  it("still refuses by count a body whose Content-Length understates it", async () => {
    const { stream, state } = endlessBody();

    const result = await readBoundedJson(
      post(stream, { "Content-Length": "10" }),
      CAP,
    );

    expect(result).toEqual(REFUSAL);
    expect(state.delivered).toBeLessThanOrEqual(CAP + CHUNK);
  });

  it("parses a body of exactly the cap, with multi-byte characters split across chunks", async () => {
    // "é" is two UTF-8 bytes; padding brings the JSON to exactly CAP bytes.
    const prefix = '{"name":"';
    const suffix = '"}';
    const accents = "é".repeat(100);
    const padding = "a".repeat(
      CAP - Buffer.byteLength(prefix + accents + suffix, "utf8"),
    );
    const json = prefix + accents + padding + suffix;
    const bytes = new TextEncoder().encode(json);
    expect(bytes.byteLength).toBe(CAP);
    // Odd-sized chunks: boundaries land inside the two-byte characters.
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < bytes.byteLength; offset += 11) {
      chunks.push(bytes.slice(offset, offset + 11));
    }

    const result = await readBoundedJson(post(chunkedBody(chunks)), CAP);

    expect(result).toEqual({
      ok: true,
      value: { name: accents + padding },
    });
  });
});

describe("coerceText — lone surrogates are replaced, pairs kept whole", () => {
  const options = { fallback: "conversion", maxJsonBytes: 100 };

  it("replaces a lone high surrogate with U+FFFD", () => {
    expect(coerceText("signup\uD800", options)).toBe("signup�");
  });

  it("replaces a lone low surrogate, and a reversed pair, with U+FFFD", () => {
    expect(coerceText("\uDC00signup", options)).toBe("�signup");
    expect(coerceText("a\uDE00\uD83Db", options)).toBe("a��b");
  });

  it("keeps a valid surrogate pair", () => {
    expect(coerceText("sign\u{1F600}up", options)).toBe("sign\u{1F600}up");
  });

  it("measures the replacement, not the escape, against the byte bound", () => {
    // "a" (1 byte) + U+FFFD (3 bytes) fills 4; the lone surrogate's JSON
    // escape `\ud800` would have taken 6.
    expect(
      coerceText("a\uD800b", { fallback: "conversion", maxJsonBytes: 4 }),
    ).toBe("a�");
  });

  it("never splits a pair when truncating", () => {
    // 2 bytes + a 4-byte emoji does not fit in 5: the emoji goes whole.
    expect(
      coerceText("ab\u{1F600}", { fallback: "conversion", maxJsonBytes: 5 }),
    ).toBe("ab");
  });
});
