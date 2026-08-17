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
import { gzipSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EMBED_DIR = path.join(ROOT, "public", "embed");

const SOURCE = path.join(EMBED_DIR, "recopyfast.src.js");
const BUNDLE_OUT = path.join(EMBED_DIR, "recopyfast.js");
const SOCKET_OUT = path.join(EMBED_DIR, "socket.io-client.min.js");

/**
 * The editing rules (colour parsing, backdrop resolution, contrast, geometry)
 * are shared with the app rather than reimplemented here. This file is compiled
 * and spliced into the widget between the inject markers below, so the widget
 * and `src/lib/editingRules.ts` can never disagree about what "readable" means.
 */
const RULES_SOURCE = path.join(ROOT, "src", "lib", "editingRules.core.ts");
const RULES_GLOBAL = "__rcfRules";
const INJECT_BEGIN = "// @rcf-inject:editing-rules";
const INJECT_END = "// @rcf-inject-end";

/**
 * Namespaced on purpose. Dropping socket.io onto `window.io` would clobber a
 * customer's own socket.io, and inheriting theirs would silently mix versions.
 */
const SOCKET_GLOBAL = "__recopyfastSocketIO";

const STALE_MARKER = "// @generated-from-sha256 ";

/**
 * The byte ceilings, in gzipped bytes, measured by `gzipSize` below.
 *
 * They are seeded at what the artifact measures TODAY (2026-08-16), not at the
 * 30,000-byte budget the product is supposed to hit. That is deliberate: the
 * budget is breached by 16,875 bytes right now, so a ceiling seeded at 30,000
 * would make `npm run build` red on the very first run of this gate, and a gate
 * that is red before anyone has changed anything gets switched off within a day.
 * Seeding at today's size makes the gate mean "no worse than this", which is the
 * only thing it can honestly mean until the widget is shrunk.
 *
 * They ratchet DOWNWARD only. Every story that removes bytes lowers the number
 * it earned; nothing ever raises it. **Raising either constant is a defect, not
 * a fix.** If a change pushes the artifact over the ceiling, the change is too
 * expensive — that is the finding, and the answer is to make the change smaller,
 * not to make the ceiling bigger. `src/__tests__/embed/build-size-gate.test.ts`
 * asserts both constants stay at or below these seeds, so a commit that raises
 * one fails the suite rather than quietly widening the budget.
 *
 * The per-story byte allowances live in docs/stories.md § Byte budget and
 * nowhere else. Do not restate a budget here.
 *
 * WHY 46875 AND NOT THE 46,781 THE DOCS QUOTE. Two compressors are in play and
 * they disagree on the same bytes. The figures written down in docs/stories.md,
 * docs/architecture.md and ADR 004 — 46,781 for the artifact and 13,085 for
 * socket.io — come from GNU `gzip -9c`. The gate uses Node's `zlib.gzipSync` at
 * level 9, which returns 46,875 and 13,141 for those identical files. Neither is
 * wrong; they are different implementations of the same format. The gate is
 * in-process because a subprocess would inherit whatever gzip the machine
 * happens to ship, and a ceiling that moves with the machine is not a ceiling.
 * The consequence, and the reason this note exists: seeding MAX_BUNDLE_GZ from
 * the documented 46,781 would put the build 94 bytes over its own ceiling on the
 * first run. Never compare a `gzip -9c` figure with one of these; re-measure.
 */
/*
 * RE-SEEDED 2026-08-17, from 46875 / 34063. This is the one legitimate reason to
 * raise these numbers, and it is not "the build failed".
 *
 * Both constants were seeded from `main`'s artifact at the moment this gate was
 * written, with zero headroom by construction. `main` then moved underneath the
 * unmerged branch: ADR 023 pinned the embed to `transports: ['websocket']`, which
 * removed socket.io's polling fallback because a polling handshake is stateful and
 * cannot survive being split across processes.
 *
 * That one line costs +19 gz on the bundle and +18 on the widget, and the numbers
 * below are the re-measurement, not an allowance. The delta is itemised precisely so
 * that a future reader can tell this apart from someone widening the budget to make
 * a build pass — which the note above rightly calls a defect.
 *
 * The rule stands unchanged: raise these ONLY when `main` itself has legitimately
 * moved, and only to the newly measured value, with the cause named. If your branch
 * is over, the branch is over. `s06c-embed-shrink` is the story that creates room.
 */
const MAX_BUNDLE_GZ = 46681;
const MAX_WIDGET_GZ = 33865;

/**
 * Lets a caller TIGHTEN a ceiling for one run. It can never loosen one.
 *
 * The gate's refusal path is the half that has to work, and provoking it
 * honestly would mean committing a deliberately oversized 47KB fixture and
 * regenerating it every time the widget changes. Instead the test suite tightens
 * the ceiling under the real artifact and watches the build refuse.
 *
 * A value at or above the constant is ignored, with a warning. That asymmetry is
 * the whole safety argument: an override that can only tighten cannot be used —
 * by a CI config, a shell profile, or an agent in a hurry — to get an oversized
 * widget past the gate. If it could raise the ceiling, it would be the ceiling.
 */
const CEILING_OVERRIDE_ENV = "RCF_EMBED_CEILING_OVERRIDE";

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

/**
 * The shared editing rules, compiled from TypeScript to an IIFE that assigns to
 * a local `var` rather than a global — it is spliced inside the widget's own
 * IIFE, so nothing reaches the customer's `window`.
 */
async function buildRules(esbuild) {
  const result = await esbuild.build({
    entryPoints: [RULES_SOURCE],
    bundle: true,
    minify: true,
    format: "iife",
    globalName: RULES_GLOBAL,
    target: ["es2018"],
    platform: "browser",
    legalComments: "none",
    write: false,
  });

  return result.outputFiles[0].text;
}

/**
 * Splice the compiled rules over the marker block in the widget source.
 *
 * The source keeps a runnable fallback between the markers so the raw file is
 * still loadable in a dev page; this replaces it with the real thing.
 */
function injectRules(source, rules) {
  const begin = source.indexOf(INJECT_BEGIN);
  const end = source.indexOf(INJECT_END);

  if (begin === -1 || end === -1) {
    throw new Error(
      `recopyfast.src.js is missing the "${INJECT_BEGIN}" / "${INJECT_END}" markers. ` +
        "The shared editing rules cannot be injected without them.",
    );
  }
  if (end < begin) {
    throw new Error(
      `"${INJECT_END}" appears before "${INJECT_BEGIN}" in recopyfast.src.js.`,
    );
  }

  return (
    source.slice(0, begin) +
    rules +
    "\n" +
    source.slice(end + INJECT_END.length)
  );
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

/**
 * gzip, in process, at the level a CDN actually serves.
 *
 * In process rather than shelling out to `gzip -9c`: a subprocess inherits
 * whatever gzip the machine ships, so the ceiling would drift between a laptop
 * and the CI runner and stop being a ceiling. `zlib.gzipSync` is byte-identical
 * everywhere Node runs.
 */
function gzipSize(text) {
  return gzipSync(Buffer.from(text, "utf8"), { level: 9 }).length;
}

/**
 * The three numbers the budget is argued in: the whole artifact, the transport
 * library, and the widget code alone.
 *
 * "The widget alone" is the artifact with the socket.io-client text cut out of
 * it — not a rebuild of the widget, which would measure something the customer
 * never downloads. socket.io leaves with `s08`; until it does, the artifact and
 * the widget move independently and both need their own ceiling.
 *
 * A missing transport throws instead of degrading to a whole-file measurement.
 * The fallback is the dangerous option: it reports the bundle size as the widget
 * size, which reads as a sudden 12KB regression that nobody caused and sends the
 * next person hunting through a diff that is not there. Both files come out of
 * the same build (see `bundle` below), so absence means something structural
 * changed and the measurement should stop, loudly.
 */
function measureBundle(bundleText, transportText) {
  const at = bundleText.indexOf(transportText);

  if (at === -1) {
    throw new Error(
      `${path.relative(ROOT, SOCKET_OUT)} was not found inside ` +
        `${path.relative(ROOT, BUNDLE_OUT)}, so the widget cannot be measured ` +
        "apart from the transport. The two files are written by the same build " +
        "and must stay byte-identical. Run: node scripts/build-embed.mjs",
    );
  }

  const widgetText =
    bundleText.slice(0, at) + bundleText.slice(at + transportText.length);

  return {
    bundleGz: gzipSize(bundleText),
    transportGz: gzipSize(transportText),
    widgetGz: gzipSize(widgetText),
  };
}

/** The ceilings in force for this run: the constants, optionally tightened. */
function resolveCeilings() {
  const raw = (process.env[CEILING_OVERRIDE_ENV] ?? "").trim();
  const committed = { maxBundleGz: MAX_BUNDLE_GZ, maxWidgetGz: MAX_WIDGET_GZ };

  if (raw === "") return committed;

  const override = Number(raw);
  if (!Number.isInteger(override) || override <= 0) {
    console.warn(
      `${CEILING_OVERRIDE_ENV}=${JSON.stringify(raw)} is not a positive integer — ignored.`,
    );
    return committed;
  }

  const ignoredFor = [
    override >= MAX_BUNDLE_GZ ? "MAX_BUNDLE_GZ" : null,
    override >= MAX_WIDGET_GZ ? "MAX_WIDGET_GZ" : null,
  ].filter(Boolean);

  if (ignoredFor.length > 0) {
    console.warn(
      `${CEILING_OVERRIDE_ENV}=${override} does not lower ${ignoredFor.join(" / ")} ` +
        "and was ignored for it. The override may only tighten a ceiling, never raise one.",
    );
  }

  return {
    maxBundleGz: Math.min(override, MAX_BUNDLE_GZ),
    maxWidgetGz: Math.min(override, MAX_WIDGET_GZ),
  };
}

function formatGzLine(measured, ceilings) {
  return (
    `gzipped  bundle ${measured.bundleGz} B (max ${ceilings.maxBundleGz})` +
    ` | widget ${measured.widgetGz} B (max ${ceilings.maxWidgetGz})` +
    ` | transport ${measured.transportGz} B`
  );
}

/**
 * Refuse a build that grew past a ceiling.
 *
 * The message names the constant, the measured size and the overage on purpose:
 * the person reading it is mid-commit and needs to know which number moved and
 * by how much, without re-running anything. What it must never read as is
 * "edit this constant" — see the ratchet note on MAX_BUNDLE_GZ.
 */
function enforceCeilings(measured, ceilings) {
  const breaches = [
    {
      constant: "MAX_BUNDLE_GZ",
      what: path.relative(ROOT, BUNDLE_OUT),
      size: measured.bundleGz,
      ceiling: ceilings.maxBundleGz,
    },
    {
      constant: "MAX_WIDGET_GZ",
      what: "the widget alone (artifact minus socket.io-client)",
      size: measured.widgetGz,
      ceiling: ceilings.maxWidgetGz,
    },
  ].filter((entry) => entry.size > entry.ceiling);

  if (breaches.length === 0) return;

  throw new Error(
    breaches
      .map(
        (entry) =>
          `${entry.constant} exceeded: ${entry.what} is ${entry.size} B gzipped, ` +
          `ceiling ${entry.ceiling} B — over by ${entry.size - entry.ceiling} B.`,
      )
      .concat(
        "The ceiling ratchets downward only. Make the change smaller; raising " +
          "the constant is a defect, not a fix.",
      )
      .join("\n"),
  );
}

async function main() {
  const isCheck = process.argv.includes("--check");

  const [source, rulesSource] = await Promise.all([
    readFile(SOURCE, "utf8"),
    readFile(RULES_SOURCE, "utf8"),
  ]);

  // Both inputs feed the artifact, so both must feed the staleness marker —
  // otherwise editing the shared rules would silently ship the old widget.
  const sourceHash = sha256(`${source}\0${rulesSource}`);

  if (isCheck) {
    // Two files off disk and nothing else. This branch deliberately never
    // touches esbuild: it is the cheap gate CI runs before the build, and a
    // staleness check that needed `node_modules` to work would stop being able
    // to run in the places a staleness check is worth running. The size gate
    // measures the committed bytes for the same reason — those are the bytes a
    // customer downloads; a fresh rebuild would measure bytes nobody has.
    const [built, transport] = await Promise.all([
      readIfExists(BUNDLE_OUT),
      readIfExists(SOCKET_OUT),
    ]);
    const expected = `${STALE_MARKER}${sourceHash}`;

    if (built === null) {
      throw new Error(
        `${path.relative(ROOT, BUNDLE_OUT)} is missing. Run: node scripts/build-embed.mjs`,
      );
    }
    if (!built.includes(expected)) {
      throw new Error(
        `${path.relative(ROOT, BUNDLE_OUT)} is stale — it was not built from the current ` +
          `${path.relative(ROOT, SOURCE)} + ${path.relative(ROOT, RULES_SOURCE)}. ` +
          "Run: node scripts/build-embed.mjs",
      );
    }
    if (transport === null) {
      throw new Error(
        `${path.relative(ROOT, SOCKET_OUT)} is missing, so the widget cannot be ` +
          "measured apart from the transport. Run: node scripts/build-embed.mjs",
      );
    }

    const ceilings = resolveCeilings();
    const measured = measureBundle(built, transport);

    console.log("embed artifact is up to date");
    console.log(formatGzLine(measured, ceilings));

    enforceCeilings(measured, ceilings);
    return;
  }

  const esbuild = await loadEsbuild();
  const socketVersion = socketIoClientVersion();

  const [socketIo, rules] = await Promise.all([
    buildSocketIo(esbuild),
    buildRules(esbuild),
  ]);

  const widget = await buildWidget(esbuild, injectRules(source, rules));

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

  const ceilings = resolveCeilings();
  const measured = measureBundle(bundle, socketIo);

  // The raw-KB lines stay. They are how a reader sees that the artifact is
  // 174 KB on disk and 46 KB on the wire: raw byte savings land at roughly a
  // tenth of their size after gzip, and every byte estimate made in raw KB on
  // this file has been wrong by that factor.
  console.log(
    [
      `source   ${path.relative(ROOT, SOURCE)}  ${formatKb(sourceBytes)}`,
      `rules    ${path.relative(ROOT, RULES_SOURCE)}  ${formatKb(Buffer.byteLength(rulesSource))}` +
        ` -> inlined ${formatKb(Buffer.byteLength(rules))}`,
      `bundle   ${path.relative(ROOT, BUNDLE_OUT)}  ${formatKb(bundleBytes)}` +
        ` (widget ${formatKb(Buffer.byteLength(widget))}` +
        ` + socket.io-client ${socketVersion} ${formatKb(Buffer.byteLength(socketIo))})`,
      `fallback ${path.relative(ROOT, SOCKET_OUT)}  ${formatKb(Buffer.byteLength(socketIo))}`,
      formatGzLine(measured, ceilings),
    ].join("\n"),
  );

  // Gate last, after the artifact is on disk. Refusing before the write would
  // leave the previous (or no) artifact in place, and `--check` would then
  // report "stale" — a second, louder, entirely misleading error for the same
  // cause. The build fails, the bytes it built are still there to measure.
  enforceCeilings(measured, ceilings);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
