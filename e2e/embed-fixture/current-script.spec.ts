import { expect, test } from "@playwright/test";
import {
  FIXTURE_EDIT_CODE,
  FIXTURE_EDITOR_GRANT,
  FIXTURE_HANDOFF_CODE,
  FIXTURE_SITE_ID,
  startFixtureServers,
  type FixtureServers,
} from "./servers";

type Entry = "canonical" | "legacy";
type ClobberCount = 0 | 1 | 2;

test.describe("built embed fixture: trusted currentScript", () => {
  let fixture: FixtureServers;

  test.beforeAll(async () => {
    fixture = await startFixtureServers();
  });

  test.beforeEach(() => {
    fixture.api.reset();
  });

  test.afterAll(async () => {
    await fixture.close();
  });

  for (const entry of ["canonical", "legacy"] as const) {
    for (const clobbers of [0, 1, 2] as const) {
      test(`${entry} entry boots with ${clobbers} named currentScript image${clobbers === 1 ? "" : "s"}`, async ({
        page,
      }) => {
        const pageErrors: string[] = [];
        const attackerRequests: Array<{
          resourceType: string;
          method: string;
          postData: string | null;
          url: string;
        }> = [];
        const attackerSockets: string[] = [];

        page.on("pageerror", (error) => pageErrors.push(error.message));
        page.on("websocket", (socket) => {
          if (socket.url().includes("attacker.invalid"))
            attackerSockets.push(socket.url());
        });
        page.on("request", (request) => {
          if (!request.url().includes("attacker.invalid")) return;
          attackerRequests.push({
            resourceType: request.resourceType(),
            method: request.method(),
            postData: request.postData(),
            url: request.url(),
          });
        });
        await page.route("https://attacker.invalid/**", async (route) => {
          if (route.request().resourceType() === "script") {
            await route.fulfill({
              contentType: "application/javascript",
              body: "window.__attackerScriptExecuted = true;",
            });
            return;
          }
          if (["fetch", "xhr"].includes(route.request().resourceType())) {
            await route.fulfill({
              contentType: "application/json",
              body: "[]",
            });
            return;
          }
          await route.abort();
        });
        await page.addInitScript(
          ({ siteId, grant }) => {
            window.localStorage.setItem(
              `rcf_editor_grant:${siteId}`,
              JSON.stringify({
                grant,
                expiresAt: "2099-01-01T00:00:00.000Z",
                email: "fixture@recopyfast.local",
                permissions: ["view", "edit", "publish"],
                remembered: true,
              }),
            );
            (
              window as typeof window & { __attackerScriptExecuted?: boolean }
            ).__attackerScriptExecuted = false;
          },
          { siteId: FIXTURE_SITE_ID, grant: FIXTURE_EDITOR_GRANT },
        );

        const url = new URL(fixture.currentScriptUrl({ entry, clobbers }));
        if (clobbers === 1) url.hash = `rcf_edit=${FIXTURE_EDIT_CODE}`;
        if (clobbers === 2)
          url.searchParams.set("rcf_handoff", FIXTURE_HANDOFF_CODE);
        const canonicalRequests: string[] = [];
        page.on("request", (request) => {
          if (new URL(request.url()).pathname === "/embed/recopyfast.js")
            canonicalRequests.push(request.url());
        });
        await page.goto(url.toString(), { waitUntil: "networkidle" });
        if (entry === "legacy") {
          // The legacy loader must load its canonical sibling with the
          // original query string intact.
          expect(
            canonicalRequests.map((requestUrl) =>
              new URL(requestUrl).searchParams.get("fixture"),
            ),
          ).toContain("1");
        }

        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (
                  window as typeof window & {
                    ReCopyFast?: { isInitialized?: boolean };
                  }
                ).ReCopyFast?.isInitialized,
            ),
          )
          .toBe(true);

        const namedAccess = await page.evaluate(() => {
          const direct = (document as Document & { currentScript: unknown })
            .currentScript;
          const nativeGetter = Object.getOwnPropertyDescriptor(
            Document.prototype,
            "currentScript",
          )?.get;
          const native = nativeGetter?.call(document);
          return {
            direct:
              direct instanceof HTMLCollection
                ? `collection:${direct.length}`
                : direct instanceof HTMLImageElement
                  ? "image"
                  : direct === null
                    ? "null"
                    : typeof direct,
            native: native === null ? "null" : typeof native,
            attackerExecuted: Boolean(
              (
                window as typeof window & {
                  __attackerScriptExecuted?: boolean;
                }
              ).__attackerScriptExecuted,
            ),
          };
        });

        expect(namedAccess.direct).toBe(
          clobbers === 0 ? "null" : clobbers === 1 ? "image" : "collection:2",
        );
        expect(namedAccess.native).toBe("null");
        expect(namedAccess.attackerExecuted).toBe(false);
        expect(pageErrors).toEqual([]);
        expect(attackerSockets).toEqual([]);
        expect(
          attackerRequests.filter(
            (request) => request.resourceType !== "image",
          ),
        ).toEqual([]);
        expect(
          attackerRequests.filter(
            (request) => request.resourceType === "image",
          ),
        ).toHaveLength(clobbers);

        if (clobbers === 0) {
          expect(
            fixture.api.latestRequest("/api/editor/validate-grant", "POST")
              ?.json,
          ).toMatchObject({
            grant: FIXTURE_EDITOR_GRANT,
            siteId: FIXTURE_SITE_ID,
          });
        } else if (clobbers === 1) {
          expect(
            fixture.api.latestRequest("/api/staging/validate", "POST")?.json,
          ).toMatchObject({ editToken: FIXTURE_EDIT_CODE });
        } else {
          expect(
            fixture.api.latestRequest("/api/editor/handoff/redeem", "POST")
              ?.json,
          ).toMatchObject({
            code: FIXTURE_HANDOFF_CODE,
            siteId: FIXTURE_SITE_ID,
          });
        }
      });
    }
  }
});
