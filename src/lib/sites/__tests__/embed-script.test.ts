/**
 * A-27 — `data-ws-url` is always emitted, so "opt-in" real-time is on everywhere.
 *
 * The widget was deliberately made opt-in about real-time. It reads
 * `data-ws-url` and, finding nothing, sets no endpoint and returns before
 * downloading socket.io at all — "Deliberately no derived fallback, and no
 * warning… Real-time is opt-in now: set data-ws-url, or window.RECOPYFAST_WS,
 * or it does not run" (public/embed/recopyfast.src.js:33-46, 2703-2705).
 *
 * The snippet generator defeats that. `getPublicWebSocketUrl` falls through to
 * the app origin when `NEXT_PUBLIC_WS_URL` is unset (embed-script.ts:26-42) and
 * `buildEmbedScript` emits the attribute unconditionally (:53). So every
 * customer's page gets `data-ws-url="https://<our app>"`, `RECOPYFAST_WS` is
 * truthy, the early return never fires, and `io()` retries forever against an
 * origin that serves no Socket.IO endpoint — `server/index.js` is a separate
 * Express process Vercel cannot host.
 *
 * The second-order cost is worse than the reconnects. `this.socket` is non-null
 * but never `connected`, and `sendContentMap` guards only on `this.socket`
 * (:2825-2834), so every rescan pushes the whole content map into socket.io's
 * `sendBuffer` — every 500ms on a carousel or an infinite-scroll page — and it
 * is only ever flushed on a connect that never comes.
 *
 * Extends B-4/B-5.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { buildEmbedScript, getPublicWebSocketUrl } from "../embed-script";

describe("buildEmbedScript", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("generates the canonical embed script with explicit API and WS URLs", () => {
    const script = buildEmbedScript({
      siteId: "site-123",
      siteToken: "site-token-abc",
      appUrl: "https://app.recopyfast.com",
      wsUrl: "https://ws.recopyfast.com",
    });

    expect(script).toContain(
      'src="https://app.recopyfast.com/embed/recopyfast.js"',
    );
    expect(script).toContain('data-site-id="site-123"');
    expect(script).toContain('data-site-token="site-token-abc"');
    expect(script).toContain('data-api-url="https://app.recopyfast.com/api"');
    expect(script).toContain('data-ws-url="https://ws.recopyfast.com"');
  });

  it("uses public environment defaults when URLs are not provided", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://dashboard.example.com/";
    process.env.NEXT_PUBLIC_WS_URL = "wss://socket.example.com/";

    const script = buildEmbedScript({
      siteId: "site-123",
      siteToken: "site-token-abc",
    });

    expect(script).toContain(
      'src="https://dashboard.example.com/embed/recopyfast.js"',
    );
    expect(script).toContain(
      'data-api-url="https://dashboard.example.com/api"',
    );
    expect(script).toContain('data-ws-url="wss://socket.example.com"');
  });
});

describe("the snippet a customer pastes when real-time is not configured", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Production shape: a real app origin, and no websocket endpoint anywhere.
    process.env.NEXT_PUBLIC_APP_URL = "https://www.recopyfa.st";
    delete process.env.NEXT_PUBLIC_WS_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // GUARD for the two marked tests below. `test.failing` passes on ANY throw —
  // a renamed export, an env var the fixture forgot to clear — so each needs an
  // unmarked sibling calling the identical function and asserting something
  // true either way: the snippet is built, and it is built for this site.
  it("still builds a usable snippet with no websocket configured", () => {
    const script = buildEmbedScript({
      siteId: "site-123",
      siteToken: "site-token-abc",
    });

    expect(script).toContain('data-site-id="site-123"');
    expect(script).toContain('data-api-url="https://www.recopyfa.st/api"');
    expect(typeof getPublicWebSocketUrl("https://www.recopyfa.st")).toBe(
      "string",
    );
  });

  test.failing("omits data-ws-url entirely", async () => {
    const script = buildEmbedScript({
      siteId: "site-123",
      siteToken: "site-token-abc",
    });

    // The widget's opt-in check is `if (!window.RECOPYFAST_WS) return;`, and
    // the only way to leave it unset is to not write the attribute. An
    // attribute pointing at the app origin is not "off", it is "on and wrong".
    expect(script).not.toContain("data-ws-url");
  });

  test.failing("never points the websocket at the app origin", async () => {
    expect(getPublicWebSocketUrl("https://www.recopyfa.st")).not.toBe(
      "https://www.recopyfa.st",
    );
  });

  // The controls. Real-time is legitimately configured in these two cases, so
  // the attribute belongs on the snippet and its absence would be the bug.
  it("still emits the attribute when NEXT_PUBLIC_WS_URL is set", () => {
    process.env.NEXT_PUBLIC_WS_URL = "wss://socket.recopyfa.st";

    expect(
      buildEmbedScript({ siteId: "site-123", siteToken: "site-token-abc" }),
    ).toContain('data-ws-url="wss://socket.recopyfa.st"');
  });

  it("still points local development at the websocket process on :4001", () => {
    // `npm run dev` really does start server/index.js there, so this fallback
    // resolves to something that answers.
    expect(getPublicWebSocketUrl("http://localhost:3000")).toContain(":4001");
  });
});

/**
 * The widget half of the same finding.
 *
 * `recopyfast.src.js` is a browser IIFE that reads `document.currentScript` at
 * parse time and cannot be imported, so `sendContentMap` is sliced out of the
 * shipped file and evaluated as an object method. Transcribing it here would
 * pass forever while the widget rotted.
 *
 * It lives beside the snippet tests because it is the consequence of them: the
 * buffering below only happens on installs that received a `data-ws-url` they
 * never asked for.
 */
describe("sendContentMap while the socket is not connected", () => {
  const WIDGET_SOURCE = path.join(
    process.cwd(),
    "public",
    "embed",
    "recopyfast.src.js",
  );

  const METHOD_BEGIN = "    sendContentMap() {";
  const NEXT_MEMBER_DOC = "Announce discovered elements to the API";

  interface FakeSocket {
    connected: boolean;
    emit: jest.Mock;
  }

  interface FakeWidget {
    elements: Map<
      string,
      { selector: string; originalContent: string; type: string }
    >;
    socket: FakeSocket | null;
    stagingMode: boolean;
    stagingToken: string | null;
    postContentMap: jest.Mock;
    sendContentMap: () => void;
  }

  function loadSendContentMap(): () => void {
    const source = readFileSync(WIDGET_SOURCE, "utf8");
    const begin = source.indexOf(METHOD_BEGIN);
    const announce = source.indexOf(NEXT_MEMBER_DOC);
    const end = source.lastIndexOf("/**", announce);

    if (begin === -1 || announce === -1 || end < begin) {
      throw new Error(
        "public/embed/recopyfast.src.js no longer exposes sendContentMap in the " +
          "shape this loader slices. Update the loader rather than transcribing " +
          "the method.",
      );
    }

    const block = source.slice(begin, end);
    // SITE_ID and SITE_TOKEN are module-scope consts in the widget.
    return new Function("SITE_ID", "SITE_TOKEN", `return { ${block} };`)(
      "site-123",
      "site-token-abc",
    ).sendContentMap;
  }

  function makeWidget(socket: FakeSocket | null): FakeWidget {
    return {
      elements: new Map([
        [
          "rcf-headline",
          { selector: "h1", originalContent: "Hello", type: "text" },
        ],
      ]),
      socket,
      stagingMode: false,
      stagingToken: null,
      postContentMap: jest.fn(),
      sendContentMap: loadSendContentMap(),
    };
  }

  // GUARD for the two marked tests below: the slicing loader still finds
  // sendContentMap in the shipped widget, and calling it on a disconnected
  // widget runs to completion. Without this, a loader that stopped matching
  // the source would read as a confirmed defect.
  it("extracts and runs sendContentMap against a disconnected widget", () => {
    const widget = makeWidget({ connected: false, emit: jest.fn() });

    expect(typeof widget.sendContentMap).toBe("function");
    expect(() => widget.sendContentMap()).not.toThrow();
    expect(widget.postContentMap).toHaveBeenCalledTimes(1);
  });

  test.failing("does not emit content-map over a disconnected socket", () => {
    const socket: FakeSocket = { connected: false, emit: jest.fn() };
    const widget = makeWidget(socket);

    widget.sendContentMap();

    // socket.io queues an emit made while disconnected into `sendBuffer` and
    // flushes it on connect. Against an origin with no Socket.IO endpoint the
    // connect never happens, so every rescan appends another full content map
    // to a buffer that is only ever drained by the garbage collector.
    expect(socket.emit).not.toHaveBeenCalled();
  });

  // GUARD for the rescan test below: twenty rescans complete and each one
  // reports over HTTP, so the marked assertion is about the socket alone.
  it("survives twenty rescans and reports each one over HTTP", () => {
    const widget = makeWidget({ connected: false, emit: jest.fn() });

    for (let rescan = 0; rescan < 20; rescan++) {
      widget.sendContentMap();
    }

    expect(widget.postContentMap).toHaveBeenCalledTimes(20);
  });

  test.failing(
    "does not grow an unbounded buffer across repeated rescans",
    () => {
      // A carousel or an infinite-scroll page rescans roughly twice a second.
      const socket: FakeSocket = { connected: false, emit: jest.fn() };
      const widget = makeWidget(socket);

      for (let rescan = 0; rescan < 20; rescan++) {
        widget.sendContentMap();
      }

      expect(socket.emit).toHaveBeenCalledTimes(0);
    },
  );

  // The controls.
  it("reports over HTTP regardless of socket state", () => {
    // POST /api/content/:siteId is the real delivery mechanism, and it is what
    // moves a site off "Verifying". It must not depend on the socket.
    const widget = makeWidget({ connected: false, emit: jest.fn() });

    widget.sendContentMap();

    expect(widget.postContentMap).toHaveBeenCalledWith({
      "rcf-headline": { selector: "h1", content: "Hello", type: "text" },
    });
  });

  it("does emit to other live editors when the socket is connected", () => {
    // The feature this guard must not break: fanning discovery out to another
    // editor viewing the same page.
    const socket: FakeSocket = { connected: true, emit: jest.fn() };
    const widget = makeWidget(socket);

    widget.sendContentMap();

    expect(socket.emit).toHaveBeenCalledWith(
      "content-map",
      expect.objectContaining({ siteId: "site-123" }),
    );
  });

  it("emits nothing at all when real-time was never configured", () => {
    // `this.socket` stays null when RECOPYFAST_WS is unset, which is the state
    // every install should be in and — because of buildEmbedScript above —
    // none of them are.
    const widget = makeWidget(null);

    expect(() => widget.sendContentMap()).not.toThrow();
    expect(widget.postContentMap).toHaveBeenCalled();
  });
});
