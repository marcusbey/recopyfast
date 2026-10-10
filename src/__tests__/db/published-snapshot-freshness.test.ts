/**
 * @jest-environment node
 */

/**
 * s65a — the snapshot origin read is fresh by construction (ADR 046).
 *
 * The snapshot's freshness is a CDN lifetime, not an invalidation hook: no
 * writer tells the route that copy changed. That is only correct if the origin
 * itself never serves anything but the rows as they are at read time — no
 * memo, no Next data cache, no second layer under the CDN. A route test with a
 * double cannot prove that against the real loader, so this suite changes
 * `published_content` and deletes the element with plain SQL, bypassing every
 * application writer (publish RPC, bulk, v1, discovery, translate), and reads
 * through the real route handler, the real service client and the local
 * PostgREST.
 *
 * Gated like its neighbours: no database → a "[gated]" pass; a database but no
 * PostgREST target → a "[gated]" pass, unless RCF_REQUIRE_TEST_DB=1, which
 * turns either absence into a failure.
 */

import type { NextRequest } from "next/server";
import { describeDb, readConfiguredApiPort } from "./db-harness";

jest.unmock("next/server");

const POSTGREST_BASE_URL = process.env.RCF_TEST_POSTGREST_URL;
const POSTGREST_SERVICE_ROLE_KEY =
  process.env.RCF_TEST_POSTGREST_SERVICE_ROLE_KEY;
const hasPostgrestTarget = Boolean(
  POSTGREST_BASE_URL && POSTGREST_SERVICE_ROLE_KEY,
);

if (process.env.RCF_REQUIRE_TEST_DB === "1" && !hasPostgrestTarget) {
  throw new Error(
    "RCF_REQUIRE_TEST_DB=1 but RCF_TEST_POSTGREST_URL or RCF_TEST_POSTGREST_SERVICE_ROLE_KEY is missing: the snapshot freshness proof cannot run, and it must not pass unrun.",
  );
}

// Same pin as the other PostgREST suites: a service key is in play, so only
// this project's local stack is an acceptable target.
if (POSTGREST_BASE_URL) {
  const target = new URL(POSTGREST_BASE_URL);
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    target.hostname,
  );
  if (
    target.protocol !== "http:" ||
    !isLoopback ||
    target.port !== String(readConfiguredApiPort()) ||
    target.pathname !== "/"
  ) {
    throw new Error(
      `Refusing PostgREST integration target outside this project's local Supabase: ${target.origin}`,
    );
  }
}

// `@/lib/supabase/service` reads these once, at load: set them before the
// route module is imported in beforeAll.
if (hasPostgrestTarget) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = POSTGREST_BASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = POSTGREST_SERVICE_ROLE_KEY;
}

const PAGE = "/s65a-freshness";

interface SnapshotBody {
  rows: Array<{
    id: string;
    element_id: string;
    published_content: string | null;
    current_content: string;
  }>;
}

describeDb("s65a snapshot freshness against the real loader", (suite) => {
  if (!hasPostgrestTarget) {
    test("[gated] no PostgREST target configured — snapshot freshness not checked", () => {
      console.warn(
        "Set RCF_TEST_POSTGREST_URL and RCF_TEST_POSTGREST_SERVICE_ROLE_KEY to read the snapshot through PostgREST (RCF_REQUIRE_TEST_DB=1 makes their absence a failure).",
      );
      expect(hasPostgrestTarget).toBe(false);
    });
    return;
  }

  type Handler = (
    request: NextRequest,
    context: { params: Promise<{ siteId: string }> },
  ) => Promise<Response>;
  let getSnapshot: Handler;
  let RealNextRequest: typeof NextRequest;

  beforeAll(async () => {
    ({ NextRequest: RealNextRequest } = await import("next/server"));
    ({ GET: getSnapshot } = await import("@/app/api/published/[siteId]/route"));
  });

  async function readSnapshot(siteId: string): Promise<SnapshotBody> {
    const query = new URLSearchParams([
      ["page", PAGE],
      ["language", "en"],
      ["variant", "default"],
    ]).toString();
    const response = await getSnapshot(
      new RealNextRequest(`http://localhost/api/published/${siteId}?${query}`, {
        headers: { "x-forwarded-for": "198.51.100.65" },
      }),
      { params: Promise.resolve({ siteId }) },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as SnapshotBody;
  }

  async function seedElement(siteId: string): Promise<string> {
    const { rows } = await suite.query<{ id: string }>(
      `INSERT INTO public.content_elements (
         site_id, element_id, selector, original_content, current_content,
         published_content, language, variant, page_path, metadata
       ) VALUES ($1, 'hero-title', 'h1', 'Authored', 'Before', 'Before',
                 'en', 'default', $2, '{}'::jsonb)
       RETURNING id`,
      [siteId, PAGE],
    );
    return rows[0].id;
  }

  test("a published value changed by direct SQL is served on the next read", async () => {
    const siteId = await suite.createSite("s65a-fresh-update");
    const rowId = await seedElement(siteId);
    expect((await readSnapshot(siteId)).rows).toMatchObject([
      { id: rowId, published_content: "Before", current_content: "Before" },
    ]);

    await suite.query(
      "UPDATE public.content_elements SET published_content = $1 WHERE id = $2",
      ["After, written by SQL", rowId],
    );

    expect((await readSnapshot(siteId)).rows).toMatchObject([
      {
        id: rowId,
        published_content: "After, written by SQL",
        current_content: "After, written by SQL",
      },
    ]);
  });

  test("an element deleted by direct SQL is gone on the next read", async () => {
    const siteId = await suite.createSite("s65a-fresh-delete");
    const rowId = await seedElement(siteId);
    expect((await readSnapshot(siteId)).rows.map((row) => row.id)).toEqual([
      rowId,
    ]);

    await suite.query("DELETE FROM public.content_elements WHERE id = $1", [
      rowId,
    ]);

    expect((await readSnapshot(siteId)).rows).toEqual([]);
  });
});
