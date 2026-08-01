#!/usr/bin/env node
/**
 * Builds the embeddable widget that customer sites load.
 *
 * Why this exists: the widget used to pull socket.io from cdn.socket.io at
 * runtime, which any site serving `script-src 'self'` blocks outright — real-time
 * editing simply died. socket.io-client is now compiled in from node_modules so
 * everything the widget needs is served from our own origin.
 *
 * Layout:
 *   public/embed/recopyfast.src.js         source of truth, readable, hand-edited
 *   public/embed/recopyfast.js             build output — what customers load
 *   public/embed/socket.io-client.min.js   standalone socket.io, same-origin fallback
 *
 * The source keeps the `.src.js` suffix so the artifact can own the public
 * `/embed/recopyfast.js` URL that is already baked into every issued embed
 * snippet. Editing recopyfast.js by hand is a mistake: it is overwritten here.
 *
 * Usage:
 *   node scripts/build-embed.mjs            build
 *   node scripts/build-embed.mjs --check    fail if the artifact is stale (CI)
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EMBED_DIR = path.join(ROOT, "public", "embed");

const SOURCE = path.join(EMBED_DIR, "recopyfast.src.js");
const BUNDLE_OUT = path.join(EMBED_DIR, "recopyfast.js");
const SOCKET_OUT = path.join(EMBED_DIR, "socket.io-client.min.js");

/**
 * Namespaced on purpose. Dropping socket.io onto `window.io` would clobber a
 * customer's own socket.io, and inheriting theirs would silently mix versions.
 */
const SOCKET_GLOBAL = "__recopyfastSocketIO";

const STALE_MARKER = "// @generated-from-sha256 ";

async function loadEsbuild() {
  try {
    return await import("esbuild");
  } catch {
    throw new Error(
      "esbuild is required to build the embed script.\n" +
        "  npm install --save-dev esbuild@^0.25.9",
    );
  }
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function socketIoClientVersion() {
  const require = createRequire(import.meta.url);
  return require("socket.io-client/package.json").version;
}

/** socket.io-client compiled to a classic script exposing a namespaced global. */
async function buildSocketIo(esbuild) {
  const result = await esbuild.build({
    stdin: {
      contents: `import { io } from "socket.io-client";\nwindow.${SOCKET_GLOBAL} = { io };\n`,
      resolveDir: ROOT,
      loader: "js",
    },
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2018"],
    platform: "browser",
    legalComments: "none",
    write: false,
  });

  return result.outputFiles[0].text;
}

/** The widget itself. No bundling: it is a self-contained classic-script IIFE. */
async function buildWidget(esbuild, source) {
  const result = await esbuild.transform(source, {
    minify: true,
    target: ["es2018"],
    loader: "js",
    legalComments: "none",
  });

  return result.code;
}

function banner(sourceHash, socketVersion) {
  return [
    "/*! ReCopyFast embed widget — GENERATED FILE, DO NOT EDIT.",
    " *  Source: public/embed/recopyfast.src.js",
    " *  Rebuild: node scripts/build-embed.mjs",
    ` *  Bundled socket.io-client: ${socketVersion}`,
    " */",
    `${STALE_MARKER}${sourceHash}`,
    "",
  ].join("\n");
}

async function readIfExists(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function main() {
  const isCheck = process.argv.includes("--check");

  const source = await readFile(SOURCE, "utf8");
  const sourceHash = sha256(source);

  if (isCheck) {
    const built = await readIfExists(BUNDLE_OUT);
    const expected = `${STALE_MARKER}${sourceHash}`;

    if (built === null) {
      throw new Error(
        `${path.relative(ROOT, BUNDLE_OUT)} is missing. Run: node scripts/build-embed.mjs`,
      );
    }
    if (!built.includes(expected)) {
      throw new Error(
        `${path.relative(ROOT, BUNDLE_OUT)} is stale — it was not built from the ` +
          "current recopyfast.src.js. Run: node scripts/build-embed.mjs",
      );
    }

    console.log("embed artifact is up to date");
    return;
  }

  const esbuild = await loadEsbuild();
  const socketVersion = socketIoClientVersion();

  const [socketIo, widget] = await Promise.all([
    buildSocketIo(esbuild),
    buildWidget(esbuild, source),
  ]);

  // socket.io goes first so `window.__recopyfastSocketIO` already exists by the
  // time the widget runs — no second request, and no injected <script> element
  // for a nonce- or hash-based customer CSP to reject.
  const bundle = `${banner(sourceHash, socketVersion)}${socketIo}\n${widget}\n`;

  await Promise.all([
    writeFile(BUNDLE_OUT, bundle, "utf8"),
    writeFile(SOCKET_OUT, socketIo, "utf8"),
  ]);

  const sourceBytes = Buffer.byteLength(source);
  const bundleBytes = Buffer.byteLength(bundle);

  console.log(
    [
      `source   ${path.relative(ROOT, SOURCE)}  ${formatKb(sourceBytes)}`,
      `bundle   ${path.relative(ROOT, BUNDLE_OUT)}  ${formatKb(bundleBytes)}` +
        ` (widget ${formatKb(Buffer.byteLength(widget))}` +
        ` + socket.io-client ${socketVersion} ${formatKb(Buffer.byteLength(socketIo))})`,
      `fallback ${path.relative(ROOT, SOCKET_OUT)}  ${formatKb(Buffer.byteLength(socketIo))}`,
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
