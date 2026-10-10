/**
 * @jest-environment node
 */

/**
 * s79 (s69 L8) — the edit-mode fidelity harness is a local tool, not a page
 * of the product.
 *
 * It lived in `public/embed/__fidelity__/`, and Next serves `public/`
 * verbatim, so `https://www.recopyfa.st/embed/__fidelity__/index.html`
 * answered 200 in production — and that page turns `?widget=<url>` into a
 * `<script src>` on the app's own origin. It now lives with the other test
 * fixtures (`e2e/fixtures/embed-fidelity/`) and is served only by
 * `scripts/serve-embed-fidelity.mjs`, on loopback.
 *
 * The server is driven as a process, the way a developer runs it: started on
 * port 0, asked for each path, killed.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

jest.setTimeout(30_000);

const ROOT = path.resolve(__dirname, "../../..");
const PUBLIC_DIR = path.join(ROOT, "public");
const FIXTURE_DIR = path.join(ROOT, "e2e/fixtures/embed-fidelity");
const SERVER = path.join(ROOT, "scripts/serve-embed-fidelity.mjs");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? [full, ...walk(full)] : [full];
  });
}

describe("public/", () => {
  const entries = walk(PUBLIC_DIR).map((full) =>
    path.relative(ROOT, full).split(path.sep).join("/"),
  );

  it("holds no fidelity harness", () => {
    expect(entries.filter((entry) => entry.includes("__fidelity__"))).toEqual(
      [],
    );
  });

  it("holds no page that loads a script named by a `widget` query parameter", () => {
    const loaders = entries
      .filter((entry) => /\.(html?|js)$/.test(entry))
      .filter((entry) =>
        /\.get\(\s*['"]widget['"]\s*\)/.test(
          readFileSync(path.join(ROOT, entry), "utf8"),
        ),
      );

    expect(loaders).toEqual([]);
  });
});

describe("the harness fixture", () => {
  it("lives with the e2e fixtures and loads its runner beside it", () => {
    const page = readFileSync(path.join(FIXTURE_DIR, "index.html"), "utf8");

    expect(existsSync(path.join(FIXTURE_DIR, "harness.js"))).toBe(true);
    expect(page).toContain('<script src="./harness.js"></script>');
    expect(page).not.toContain("__fidelity__");
  });
});

describe("scripts/serve-embed-fidelity.mjs", () => {
  let child: ChildProcess;
  let origin: string;

  beforeAll(async () => {
    child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, FIDELITY_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    origin = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error(`server did not start: ${output}`)),
        10_000,
      );
      const onData = (chunk: Buffer) => {
        output += String(chunk);
        const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(`http://127.0.0.1:${match[1]}`);
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`server exited ${code}: ${output}`));
      });
    });
  });

  afterAll(() => {
    child?.kill();
  });

  it("listens on loopback only", () => {
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("serves the harness page and its runner", async () => {
    const page = await fetch(`${origin}/`);
    const runner = await fetch(`${origin}/harness.js`);

    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toMatch(/text\/html/);
    expect(await page.text()).toBe(
      readFileSync(path.join(FIXTURE_DIR, "index.html"), "utf8"),
    );
    expect(runner.status).toBe(200);
    expect(await runner.text()).toBe(
      readFileSync(path.join(FIXTURE_DIR, "harness.js"), "utf8"),
    );
  });

  it("serves the current widget build", async () => {
    const widget = await fetch(`${origin}/embed/recopyfast.js?v=123`);

    expect(widget.status).toBe(200);
    expect(widget.headers.get("content-type")).toMatch(/javascript/);
    expect(await widget.text()).toBe(
      readFileSync(path.join(PUBLIC_DIR, "embed/recopyfast.js"), "utf8"),
    );
  });

  it.each([
    "/package.json",
    "/../package.json",
    "/%2e%2e/package.json",
    "/embed/recopyfast.src.js",
    "/index.html/../../package.json",
  ])("answers 404 to %s", async (requestPath) => {
    const response = await fetch(`${origin}${requestPath}`);

    expect(response.status).toBe(404);
  });
});
