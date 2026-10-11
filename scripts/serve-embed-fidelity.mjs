#!/usr/bin/env node
/**
 * Serves the edit-mode fidelity harness on loopback (s79, s69 L8).
 *
 *   node scripts/serve-embed-fidelity.mjs          # http://127.0.0.1:4321
 *   FIDELITY_PORT=0 node scripts/…                 # any free port
 *
 * The harness (e2e/fixtures/embed-fidelity/) used to sit in public/, which
 * Next serves verbatim — so production answered it, and its `?widget=<url>`
 * parameter loaded any URL as a script on the app's own origin. It is a local
 * measurement tool; this server is the only thing that serves it.
 *
 * Exactly four paths, by name — no directory is mapped onto the URL space, so
 * there is no traversal to get wrong:
 *
 *   /                     the harness page
 *   /harness.js           its runner
 *   /embed/recopyfast.js  the CURRENT widget build (public/embed/recopyfast.js),
 *                         read per request so a rebuild needs no restart
 *   /head.js              an artifact to A/B against, when one was written
 *                         beside the fixture (see the note in index.html)
 *
 * The widget still talks to the API named by `?apiUrl=` (default
 * http://localhost:3000/api), i.e. a local app you started yourself.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "e2e/fixtures/embed-fidelity");

const ROUTES = new Map([
  ["/", { file: path.join(FIXTURE_DIR, "index.html"), type: "text/html; charset=utf-8" }],
  ["/harness.js", { file: path.join(FIXTURE_DIR, "harness.js"), type: "text/javascript; charset=utf-8" }],
  [
    "/embed/recopyfast.js",
    { file: path.join(ROOT, "public/embed/recopyfast.js"), type: "text/javascript; charset=utf-8" },
  ],
  ["/head.js", { file: path.join(FIXTURE_DIR, "head.js"), type: "text/javascript; charset=utf-8" }],
]);

const DEFAULT_PORT = 4321;
const HOST = "127.0.0.1";

function notFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found\n");
}

const server = createServer(async (request, response) => {
  // The raw path, before any normalisation: `/../x` and `/%2e%2e/x` are not
  // route names, so they are simply not found.
  const rawPath = (request.url ?? "/").split("?")[0];
  const route = request.method === "GET" ? ROUTES.get(rawPath) : undefined;
  if (!route) {
    notFound(response);
    return;
  }

  try {
    const body = await readFile(route.file);
    response.writeHead(200, {
      "Content-Type": route.type,
      // The harness exists to measure the build on disk now; a cached widget
      // produces a plausible but wrong result table.
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    notFound(response);
  }
});

const requestedPort = Number(process.env.FIDELITY_PORT ?? DEFAULT_PORT);

server.listen(Number.isInteger(requestedPort) ? requestedPort : DEFAULT_PORT, HOST, () => {
  const { port } = server.address();
  console.log(`Fidelity harness: http://${HOST}:${port}/`);
});
