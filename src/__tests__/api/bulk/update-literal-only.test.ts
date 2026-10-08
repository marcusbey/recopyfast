/**
 * s68b M2 — bulk find/replace is literal only (ADR 048).
 *
 * `useRegex: true` used to build `new RegExp(find, "g")` from request input and
 * run it over the element's copy. Its guard (`isDangerousRegex`) could not see
 * nesting: `((a+))+$` passed it, and against thirty `a`s and a `!` it held a
 * serverless function for ~16 s per operation, with no cap on operations. The
 * mode had no caller. It is refused per operation now, nothing builds a RegExp
 * from the request, and a literal operation in the same batch still applies.
 */

import { POST } from "@/app/api/bulk/update/route";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { checkOwnerCanEdit } from "@/lib/billing/owner-can-edit";

jest.mock("@supabase/ssr");
jest.mock("@/lib/supabase/service");
jest.mock("@/lib/api/rate-limit", () => ({ enforceRateLimit: jest.fn() }));
jest.mock("@/lib/billing/owner-can-edit", () => ({
  ...jest.requireActual("@/lib/billing/owner-can-edit"),
  checkOwnerCanEdit: jest.fn(),
}));

const SITE_ID = "22222222-2222-4222-8222-222222222222";
const EVIL_PATTERN = "((a+))+$";
const REFUSAL =
  "Regex find/replace is not supported; use literal find/replace.";

const elements: Record<string, { id: string; current_content: string }> = {
  evil: { id: "row-evil", current_content: "a".repeat(30) + "!" },
  title: { id: "row-title", current_content: "Hello world" },
};

/** Each `writer.from().update(...).eq("id", …)` — one per content write. */
const writes: Array<{ payload: Record<string, unknown>; id?: unknown }> = [];

function userClient() {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u-1" } } }),
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.insert = () => Promise.resolve({ error: null });
      chain.update = () => chain;
      chain.eq = (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      };
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(resolve);
      chain.single = () => {
        if (table === "site_permissions") {
          return Promise.resolve({ data: { permission: "edit" } });
        }
        const element = elements[filters.element_id as string];
        return Promise.resolve(
          element
            ? { data: element, error: null }
            : { data: null, error: { message: "not found" } },
        );
      };
      return chain;
    },
  };
}

function writerClient() {
  return {
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        const write: { payload: Record<string, unknown>; id?: unknown } = {
          payload,
        };
        writes.push(write);
        const chain = {
          eq: (column: string, value: unknown) => {
            if (column === "id") write.id = value;
            return chain;
          },
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ error: null }).then(resolve),
        };
        return chain;
      },
    }),
  };
}

describe("POST /api/bulk/update — literal only (ADR 048)", () => {
  const OriginalRegExp = global.RegExp;
  const regexSources: unknown[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    writes.length = 0;
    regexSources.length = 0;
    (enforceRateLimit as jest.Mock).mockResolvedValue(null);
    (checkOwnerCanEdit as jest.Mock).mockResolvedValue({
      ok: true,
      ownerId: "owner-1",
    });
    (createServerClient as jest.Mock).mockReturnValue(userClient());
    (createServiceRoleClient as jest.Mock).mockReturnValue(writerClient());
    // Records every pattern handed to the RegExp constructor while the request
    // runs. A Proxy keeps `instanceof RegExp` and literal regexes working.
    global.RegExp = new Proxy(OriginalRegExp, {
      construct(target, args) {
        regexSources.push(args[0]);
        return Reflect.construct(target, args);
      },
      apply(target, thisArg, args) {
        regexSources.push(args[0]);
        return Reflect.apply(target, thisArg, args);
      },
    });
  });

  afterEach(() => {
    global.RegExp = OriginalRegExp;
  });

  it("refuses useRegex per operation, fast, without a RegExp from input; a literal operation still applies", async () => {
    const request = new NextRequest("http://localhost/api/bulk/update", {
      method: "POST",
      body: JSON.stringify({
        site_id: SITE_ID,
        operations: [
          {
            element_id: "evil",
            operation: "find_replace",
            find: EVIL_PATTERN,
            replace: "x",
            useRegex: true,
          },
          {
            element_id: "title",
            operation: "find_replace",
            find: "Hello",
            replace: "Hi",
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const started = Date.now();
    const response = await POST(request);
    const elapsed = Date.now() - started;
    global.RegExp = OriginalRegExp;

    expect(elapsed).toBeLessThan(100);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results.failed).toBe(1);
    expect(body.results.successful).toBe(1);
    expect(body.results.errors).toEqual([`Element evil: ${REFUSAL}`]);
    expect(body.results.updated_elements).toEqual(["title"]);

    expect(writes.map((write) => write.id)).toEqual(["row-title"]);
    expect(writes[0].payload).toMatchObject({ current_content: "Hi world" });

    expect(regexSources).not.toContain(EVIL_PATTERN);
  });
});
