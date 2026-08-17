/**
 * The embed byte gate — `scripts/build-embed.mjs` measured and refused.
 *
 * The widget ships to domains we do not control, over a budget that is already
 * breached (docs/stories.md, § Byte budget). Nothing in the build used to know
 * how big the artifact was: it printed raw KB, and raw KB is roughly 10x what
 * the network actually costs, so every byte conversation was held in the wrong
 * unit. These tests pin the gzipped measurement and the refusal built on it.
 *
 * Two rules shape how they are written:
 *
 *   - They never run a build. Every case shells out to `--check`, which writes
 *     nothing, so the suite cannot leave `public/embed/` dirty and cannot make
 *     a green test depend on esbuild being installed.
 *   - The expected numbers are re-derived here from the two files on disk,
 *     independently of the script. One implementation printing its own output
 *     back at itself proves nothing; two implementations agreeing is evidence.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "build-embed.mjs");
const BUNDLE = path.join(ROOT, "public", "embed", "recopyfast.js");
const TRANSPORT = path.join(ROOT, "public", "embed", "socket.io-client.min.js");

const OVERRIDE_ENV = "RCF_EMBED_CEILING_OVERRIDE";

/**
 * The sizes the ceilings were seeded at, 2026-08-16, by
 * `zlib.gzipSync({ level: 9 })` — the gate's own compressor. They are the
 * ratchet's high-water mark and this file is the mechanism that enforces it:
 * a commit that raises MAX_BUNDLE_GZ or MAX_WIDGET_GZ above these fails here.
 *
 * `s06c` will ratchet the constants down. Nothing in this file has to change
 * when it does — these are upper bounds, not equalities.
 */
const SEEDED_MAX_BUNDLE_GZ = 46875;
const SEEDED_MAX_WIDGET_GZ = 34063;

interface CheckRun {
  status: number;
  output: string;
}

/**
 * `spawnSync`, not `execFileSync`: half of these cases assert on a non-zero
 * exit *and* on the message that came with it, and `execFileSync` throws away
 * the run in an exception whose stderr is awkward to recover.
 */
function runCheck(env: Record<string, string> = {}): CheckRun {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };

  // A ceiling override inherited from the developer's own shell would silently
  // change what "the committed ceiling" means in half of these assertions.
  if (!(OVERRIDE_ENV in env)) delete childEnv[OVERRIDE_ENV];

  const result = spawnSync(process.execPath, [SCRIPT, "--check"], {
    cwd: ROOT,
    encoding: "utf8",
    env: childEnv,
  });

  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/** The gate's own definition of the widget slice, re-implemented from scratch. */
function measureIndependently() {
  const bundle = readFileSync(BUNDLE, "utf8");
  const transport = readFileSync(TRANSPORT, "utf8");
  const at = bundle.indexOf(transport);

  if (at === -1) {
    throw new Error(
      "socket.io-client.min.js is not a substring of recopyfast.js — the widget " +
        "slice this suite checks does not exist. Rebuild: npm run build:embed",
    );
  }

  const widget = bundle.slice(0, at) + bundle.slice(at + transport.length);
  const gz = (text: string) =>
    gzipSync(Buffer.from(text, "utf8"), { level: 9 }).length;

  return {
    bundleGz: gz(bundle),
    transportGz: gz(transport),
    widgetGz: gz(widget),
  };
}

interface PrintedFigures {
  bundleGz: number;
  maxBundleGz: number;
  widgetGz: number;
  maxWidgetGz: number;
  transportGz: number;
}

function parseGzLine(output: string): PrintedFigures {
  const match = output.match(
    /bundle (\d+) B \(max (\d+)\) \| widget (\d+) B \(max (\d+)\) \| transport (\d+) B/,
  );

  if (!match) {
    throw new Error(
      `build-embed.mjs printed no gzipped-size line. Output was:\n${output}`,
    );
  }

  return {
    bundleGz: Number(match[1]),
    maxBundleGz: Number(match[2]),
    widgetGz: Number(match[3]),
    maxWidgetGz: Number(match[4]),
    transportGz: Number(match[5]),
  };
}

describe("embed byte gate — measurement", () => {
  it("prints gzipped sizes that match an independent measurement", () => {
    const expected = measureIndependently();

    const run = runCheck();
    const printed = parseGzLine(run.output);

    expect(run.status).toBe(0);
    expect(printed.bundleGz).toBe(expected.bundleGz);
    expect(printed.widgetGz).toBe(expected.widgetGz);
    expect(printed.transportGz).toBe(expected.transportGz);
  });

  it("measures the widget as the artifact minus the transport, not the whole file", () => {
    const printed = parseGzLine(runCheck().output);

    // gzip compresses each input against its own window, so two slices always
    // cost more apart than together. If the slice ever silently degraded into
    // "gzip the whole artifact", widgetGz would equal bundleGz and this sum
    // would collapse to bundleGz + transportGz > bundleGz for the wrong reason
    // — so the tighter assertion below is the one that catches it.
    expect(printed.widgetGz + printed.transportGz).toBeGreaterThan(
      printed.bundleGz,
    );
    expect(printed.widgetGz).toBeLessThan(printed.bundleGz);
  });
});

describe("embed byte gate — the ceiling override", () => {
  /**
   * The gate can only be trusted if its refusal path is exercised, and the
   * refusal path needs an artifact over the ceiling — a 47KB fixture that would
   * have to be regenerated every time the widget changes. The override exists
   * so the refusal can be provoked against the real artifact instead. It is
   * safe to ship precisely because it can only tighten: no value of it lets a
   * fat artifact through, so it is a test instrument, not a back door.
   */
  it("refuses when the measured size is over an overridden ceiling", () => {
    const measured = measureIndependently();
    const tightened = measured.widgetGz - 100;

    const run = runCheck({ RCF_EMBED_CEILING_OVERRIDE: String(tightened) });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("MAX_WIDGET_GZ exceeded");
    expect(run.output).toContain(`${measured.widgetGz} B gzipped`);
    expect(run.output).toContain("over by 100 B");
  });

  it("ignores an override that would raise a ceiling, and says so", () => {
    const raised = String(999999);

    const run = runCheck({ RCF_EMBED_CEILING_OVERRIDE: raised });
    const printed = parseGzLine(run.output);
    const committed = parseGzLine(runCheck().output);

    expect(run.status).toBe(0);
    expect(printed.maxBundleGz).toBe(committed.maxBundleGz);
    expect(printed.maxWidgetGz).toBe(committed.maxWidgetGz);
    expect(run.output).toContain("RCF_EMBED_CEILING_OVERRIDE");
  });

  it("ignores a value that is not a positive integer", () => {
    const run = runCheck({ RCF_EMBED_CEILING_OVERRIDE: "not-a-number" });
    const printed = parseGzLine(run.output);
    const committed = parseGzLine(runCheck().output);

    expect(run.status).toBe(0);
    expect(printed.maxBundleGz).toBe(committed.maxBundleGz);
    expect(printed.maxWidgetGz).toBe(committed.maxWidgetGz);
  });
});

describe("embed byte gate — the ratchet", () => {
  it("holds: the committed artifact is inside both ceilings", () => {
    const run = runCheck();
    const printed = parseGzLine(run.output);

    expect(run.status).toBe(0);
    expect(printed.bundleGz).toBeLessThanOrEqual(printed.maxBundleGz);
    expect(printed.widgetGz).toBeLessThanOrEqual(printed.maxWidgetGz);
  });

  it("never lets a ceiling be raised above the size it was seeded at", () => {
    const printed = parseGzLine(runCheck().output);

    // This is the ratchet, made mechanical. A change that costs more bytes than
    // its budget allows has exactly two honest outcomes: make the change
    // smaller, or take the byte conversation to docs/stories.md § Byte budget.
    // Editing MAX_BUNDLE_GZ upward is neither, and it is the fix a hurried
    // agent reaches for first — so it fails here instead of shipping.
    expect(printed.maxBundleGz).toBeLessThanOrEqual(SEEDED_MAX_BUNDLE_GZ);
    expect(printed.maxWidgetGz).toBeLessThanOrEqual(SEEDED_MAX_WIDGET_GZ);
  });
});

describe("embed byte gate — what the gate must not break", () => {
  it("still fails --check when the artifact is stale", () => {
    const original = readFileSync(BUNDLE);
    const marker = "// @generated-from-sha256 ";
    const at = original.indexOf(marker);

    expect(at).toBeGreaterThan(-1);

    try {
      // Corrupt one hex digit of the recorded source hash: exactly what a
      // committed artifact built from an older recopyfast.src.js looks like.
      const tampered = Buffer.from(original);
      const digitAt = at + marker.length;
      tampered[digitAt] = original[digitAt] === 0x30 ? 0x31 : 0x30;
      writeFileSync(BUNDLE, tampered);

      const run = runCheck();

      expect(run.status).not.toBe(0);
      expect(run.output).toContain("stale");
    } finally {
      // Byte-identical restore, in `finally` so a failed expectation above
      // cannot leave a mangled artifact behind for every later run.
      writeFileSync(BUNDLE, original);
    }

    expect(readFileSync(BUNDLE).equals(original)).toBe(true);
    expect(runCheck().status).toBe(0);
  });

  it("keeps --check free of esbuild, so it needs nothing but Node", () => {
    const script = readFileSync(SCRIPT, "utf8");
    const branchAt = script.indexOf("if (isCheck) {");
    const buildAt = script.indexOf("const esbuild = await loadEsbuild();");

    expect(branchAt).toBeGreaterThan(-1);
    expect(buildAt).toBeGreaterThan(branchAt);

    // Comments are stripped first: the branch is *allowed* to explain why it
    // stays away from esbuild, it is only forbidden to call it.
    const branch = script
      .slice(branchAt, buildAt)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    // `--check` is the step CI runs before `npm run build`, and its whole value
    // is being the cheap one: two files off disk, gzipped in process. A gate
    // that had to rebuild to learn the size would couple staleness-checking to
    // esbuild being installed and double the CI cost of the thing it guards.
    expect(branch).not.toContain("esbuild");
    expect(branch).not.toContain("loadEsbuild");
  });
});
