/**
 * Edit-board routes used to echo the request Origin together with
 * Access-Control-Allow-Credentials: true. That pair lets any website make a
 * credentialed request as a logged-in owner.
 *
 * These endpoints authenticate with a staging/editor token, not cookies.
 * Public CORS (`*` without credentials) is the correct grant.
 */

import { NextRequest } from "next/server";

const ATTACKER = "https://attacker.example";

const routes = [
  {
    name: "history",
    load: () => import("@/app/api/edit-board/history/route"),
    methods: "GET,POST,OPTIONS",
  },
  {
    name: "history/[versionId]",
    load: () => import("@/app/api/edit-board/history/[versionId]/route"),
    methods: "GET,POST,OPTIONS",
  },
  {
    name: "themes",
    load: () => import("@/app/api/edit-board/themes/route"),
    methods: "GET,POST,PUT,DELETE,OPTIONS",
  },
  {
    name: "styles",
    load: () => import("@/app/api/edit-board/styles/route"),
    methods: "GET,POST,OPTIONS",
  },
  {
    name: "styles/apply",
    load: () => import("@/app/api/edit-board/styles/apply/route"),
    methods: "POST,OPTIONS",
  },
  {
    name: "languages",
    load: () => import("@/app/api/edit-board/languages/route"),
    methods: "GET,POST,PUT,DELETE,OPTIONS",
  },
] as const;

describe("edit-board CORS", () => {
  it.each(routes)(
    "does not reflect $name Origin with credentials",
    async ({ load }) => {
      const { OPTIONS } = await load();
      const request = new NextRequest(
        "https://www.recopyfa.st/api/edit-board/history",
        {
          method: "OPTIONS",
          headers: { origin: ATTACKER },
        },
      );

      const response = await OPTIONS(request);

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe(
        ATTACKER,
      );
      expect(response.headers.get("Access-Control-Allow-Credentials")).not.toBe(
        "true",
      );
    },
  );
});
