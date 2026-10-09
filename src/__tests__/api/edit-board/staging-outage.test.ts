/**
 * s76 review minor 6 — the Edit Board answers an outage with 503, not 401.
 *
 * s76 made `StagingAccessManager.validateStagingAccess` say when the database,
 * not the token, failed (`unavailable`), and every validator behind
 * `validateEditorAccess` answers that with 503. The fifteen Edit Board call
 * sites call `validateStagingAccess` directly and answered every refusal 401,
 * so one database blip told the widget its share link was refused. They now
 * take the status from one helper, `stagingRefusalStatus`.
 */

import fs from "fs";
import path from "path";

import { NextRequest } from "next/server";

import { stagingRefusalStatus } from "@/lib/auth/staging-access";
import { createServiceRoleClient } from "@/lib/supabase/service";

jest.mock("@/lib/supabase/service");
// staging-access imports the SSR client for its admin-only methods. None of
// them run here, but the module must resolve.
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(),
}));

const SITE_ID = "6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f";
const TOKEN = "staging-token-abc";

describe("stagingRefusalStatus", () => {
  it("is 503 when there is no verdict, and 401 for a verdict", () => {
    expect(stagingRefusalStatus({ unavailable: true })).toBe(503);
    expect(stagingRefusalStatus({})).toBe(401);
    expect(stagingRefusalStatus({ unavailable: false })).toBe(401);
  });
});

describe("every Edit Board refusal takes its status from the helper", () => {
  // The census pattern of staging-token-device.test.ts: discovered, not
  // listed, so a sixteenth call site cannot answer a bare 401.
  const ROUTES_ROOT = path.join(process.cwd(), "src/app/api/edit-board");

  function routeFiles(dir: string = ROUTES_ROOT): string[] {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return routeFiles(full);
        return entry.name === "route.ts" ? [full] : [];
      })
      .sort();
  }

  const files = routeFiles();

  it("found the Edit Board routes", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [path.relative(process.cwd(), file), file]))(
    "%s",
    (_, file) => {
      const source = fs.readFileSync(file, "utf8");
      const calls = source.match(
        /StagingAccessManager\.validateStagingAccess\(/g,
      );
      const helperUses = source.match(/stagingRefusalStatus\(validation\)/g);

      expect(calls?.length ?? 0).toBeGreaterThan(0);
      expect(helperUses?.length ?? 0).toBe(calls?.length ?? 0);
    },
  );
});

describe("GET /api/edit-board/styles during an outage", () => {
  function serviceClient(stagingRead: { data: unknown; error: unknown }) {
    const reads: string[] = [];
    const client = {
      from(table: string) {
        reads.push(table);
        const result =
          table === "staging_access" ? stagingRead : { data: [], error: null };
        const builder: Record<string, unknown> = {
          select: () => builder,
          update: () => builder,
          eq: () => builder,
          gte: () => builder,
          order: () => Promise.resolve(result),
          single: () => Promise.resolve(result),
          maybeSingle: () => Promise.resolve(result),
          then: (
            onOk: (v: unknown) => unknown,
            onErr?: (e: unknown) => unknown,
          ) => Promise.resolve(result).then(onOk, onErr),
        };
        return builder;
      },
    };
    jest
      .mocked(createServiceRoleClient)
      .mockReturnValue(
        client as unknown as ReturnType<typeof createServiceRoleClient>,
      );
    return reads;
  }

  function stylesRequest(): NextRequest {
    return new NextRequest(
      `https://api.recopyfast.test/api/edit-board/styles?siteId=${SITE_ID}`,
      {
        headers: {
          authorization: `Bearer ${TOKEN}`,
          origin: "https://customer.example",
          "user-agent": "Mozilla/5.0 (Macintosh) Chrome/120",
        },
      },
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("answers 503 when the staging token cannot be read, and serves nothing", async () => {
    const reads = serviceClient({
      data: null,
      error: { message: "connection reset" },
    });

    const { GET } = await import("@/app/api/edit-board/styles/route");
    const response = await GET(stylesRequest());

    expect(response.status).toBe(503);
    expect(reads).not.toContain("copy_styles");
  });

  it("still answers 401 for a token the database does not know", async () => {
    // The control: a verdict stays a verdict.
    const reads = serviceClient({ data: null, error: null });

    const { GET } = await import("@/app/api/edit-board/styles/route");
    const response = await GET(stylesRequest());

    expect(response.status).toBe(401);
    expect(reads).not.toContain("copy_styles");
  });
});
