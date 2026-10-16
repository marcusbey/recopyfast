import { expect, test } from "@playwright/test";
import {
  FIXTURE_SITE_ID,
  FIXTURE_SITE_TOKEN,
  startFixtureServers,
  type FixtureServers,
  waitForWidget,
} from "./servers";

const PARENT_ID = "fixture-nested-parent";
const CHILD_ID = "fixture-nested-child";

test.describe("built embed fixture: nested edited copy", () => {
  let fixture: FixtureServers;

  test.beforeAll(async () => {
    fixture = await startFixtureServers();
  });

  test.afterAll(async () => {
    await fixture.close();
  });

  test("composes parent and child edits without rescan churn and repairs alternating host writes", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    let contentRows = [
      {
        element_id: PARENT_ID,
        original_content: "Buy now",
        current_content: "Shop ",
      },
      {
        element_id: CHILD_ID,
        original_content: "now",
        current_content: "today",
      },
    ];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await page.route(`${fixture.servingOrigin}/api/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization,content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "content-type": "application/json",
      };
      if (request.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers });
        return;
      }
      if (
        request.method() === "GET" &&
        url.pathname === `/api/content/${FIXTURE_SITE_ID}`
      ) {
        await route.fulfill({
          status: 200,
          headers,
          json: contentRows,
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers,
        json: url.pathname.startsWith("/api/ab-tests/active/")
          ? { tests: [] }
          : { success: true },
      });
    });

    const lateAncestor = async (
      order: "child-first" | "parent-first",
      shared: boolean,
    ) => {
      await page.goto(fixture.liveUrl({ widget: false }), {
        waitUntil: "networkidle",
      });
      await page.evaluate(
        ({ servingOrigin, shared, siteId, siteToken }) => {
          document.body.innerHTML = `<main id="mount"><span${shared ? ' data-rcf-id="shared-child"' : ""}>now</span></main>`;
          const script = document.createElement("script");
          script.src = `${servingOrigin}/embed/recopyfast.js`;
          script.dataset.siteId = siteId;
          script.dataset.siteToken = siteToken;
          script.dataset.apiUrl = `${servingOrigin}/api`;
          document.head.appendChild(script);
        },
        {
          servingOrigin: fixture.servingOrigin,
          shared,
          siteId: FIXTURE_SITE_ID,
          siteToken: FIXTURE_SITE_TOKEN,
        },
      );
      await waitForWidget(page);
      return page.evaluate(
        async ({ order, shared }) => {
          const mount = document.getElementById("mount")!;
          const child = mount.querySelector("span")!;
          const rcf = (
            window as typeof window & {
              ReCopyFast: {
                handleContentUpdate(data: Record<string, unknown>): void;
                rescan(): void;
              };
            }
          ).ReCopyFast;

          rcf.handleContentUpdate({
            elementId: child.getAttribute("data-rcf-id")!,
            content: "today",
          });
          await new Promise((resolve) => setTimeout(resolve, 0));

          const parent = document.createElement("h1");
          parent.append("Buy ", child);
          mount.replaceChildren(parent);
          rcf.rescan();
          await new Promise((resolve) => setTimeout(resolve, 0));
          const parentId = parent.getAttribute("data-rcf-id")!;

          if (order === "parent-first") {
            child.remove();
            rcf.rescan();
            const unrelated = document.createElement("p");
            unrelated.textContent = "Aside";
            mount.appendChild(unrelated);
            rcf.rescan();
            parent.appendChild(child);
            rcf.rescan();
            rcf.handleContentUpdate({
              elementId: child.getAttribute("data-rcf-id")!,
              content: "today",
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
          }

          rcf.handleContentUpdate({ elementId: parentId, content: "Shop " });
          await new Promise((resolve) => setTimeout(resolve, 0));

          let childMutations = 0;
          const observer = new MutationObserver((records) => {
            childMutations += records.filter(
              (record) => record.type === "characterData",
            ).length;
          });
          if (shared) {
            observer.observe(child, { characterData: true, subtree: true });
          }

          history.pushState(
            null,
            "",
            `/late-${order}-${shared ? "shared" : "page"}`,
          );
          await new Promise((resolve) => setTimeout(resolve, 0));
          observer.disconnect();

          return {
            parent: parent.textContent,
            child: child.textContent,
            childId: child.getAttribute("data-rcf-id"),
            childMutations,
          };
        },
        { order, shared },
      );
    };

    await page.goto(fixture.liveUrl({ widget: false }), {
      waitUntil: "networkidle",
    });
    await page.evaluate(
      ({ childId, parentId, servingOrigin, siteId, siteToken }) => {
        document.body.innerHTML = `<main><h1 data-rcf-id="${parentId}">Buy <span data-rcf-id="${childId}">now</span></h1></main>`;
        const parent = document.querySelector("h1")!;
        const state = window as typeof window & {
          __nestedMutations?: number;
        };
        state.__nestedMutations = 0;
        new MutationObserver((records) => {
          state.__nestedMutations =
            (state.__nestedMutations || 0) +
            records.filter((record) => record.type === "characterData").length;
        }).observe(parent, {
          childList: true,
          characterData: true,
          subtree: true,
        });
        const script = document.createElement("script");
        script.src = `${servingOrigin}/embed/recopyfast.js`;
        script.dataset.siteId = siteId;
        script.dataset.siteToken = siteToken;
        script.dataset.apiUrl = `${servingOrigin}/api`;
        document.head.appendChild(script);
      },
      {
        childId: CHILD_ID,
        parentId: PARENT_ID,
        servingOrigin: fixture.servingOrigin,
        siteId: FIXTURE_SITE_ID,
        siteToken: FIXTURE_SITE_TOKEN,
      },
    );
    await waitForWidget(page);

    const parent = page.locator(`[data-rcf-id="${PARENT_ID}"]`);
    const child = page.locator(`[data-rcf-id="${CHILD_ID}"]`);
    await expect(parent).toHaveText("Shop today");
    await expect(child).toHaveText("today");
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __nestedMutations?: number })
            .__nestedMutations,
      ),
    ).toBe(3);

    const beforeRescan = await page.evaluate(
      () =>
        (window as typeof window & { __nestedMutations?: number })
          .__nestedMutations,
    );
    await page.evaluate(async () => {
      (
        window as typeof window & { ReCopyFast: { rescan(): void } }
      ).ReCopyFast.rescan();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __nestedMutations?: number })
            .__nestedMutations,
      ),
    ).toBe(beforeRescan);

    const repaired = await page.evaluate(
      async ({ childId, parentId }) => {
        const parent = document.querySelector(`[data-rcf-id="${parentId}"]`)!;
        const child = document.querySelector(`[data-rcf-id="${childId}"]`)!;
        for (let index = 0; index < 12; index++) {
          if (index % 2 === 0) parent.firstChild!.nodeValue = `Host ${index} `;
          else child.firstChild!.nodeValue = `host ${index}`;
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (
            parent.firstChild!.nodeValue !== "Shop " ||
            child.textContent !== "today"
          ) {
            return false;
          }
        }
        return parent.textContent === "Shop today";
      },
      { childId: CHILD_ID, parentId: PARENT_ID },
    );
    expect(repaired).toBe(true);

    contentRows = [];
    await page.goto(fixture.liveUrl({ widget: false }), {
      waitUntil: "networkidle",
    });
    await page.evaluate(
      ({ servingOrigin, siteId, siteToken }) => {
        document.body.innerHTML = "<main><h1>Buy <span>now</span></h1></main>";
        const script = document.createElement("script");
        script.src = `${servingOrigin}/embed/recopyfast.js`;
        script.dataset.siteId = siteId;
        script.dataset.siteToken = siteToken;
        script.dataset.apiUrl = `${servingOrigin}/api`;
        document.head.appendChild(script);
      },
      {
        servingOrigin: fixture.servingOrigin,
        siteId: FIXTURE_SITE_ID,
        siteToken: FIXTURE_SITE_TOKEN,
      },
    );
    await waitForWidget(page);

    const restored = await page.evaluate(async () => {
      const parent = document.querySelector("h1")!;
      const child = parent.querySelector("span")!;
      const rcf = (
        window as typeof window & {
          ReCopyFast: {
            handleContentUpdate(data: Record<string, unknown>): void;
          };
          navigation?: EventTarget;
        }
      ).ReCopyFast;
      const parentId = parent.getAttribute("data-rcf-id")!;
      const childId = child.getAttribute("data-rcf-id")!;

      rcf.handleContentUpdate({ elementId: childId, content: "today" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      rcf.handleContentUpdate({ elementId: parentId, content: "Buy now" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const before = {
        parent: parent.textContent,
        child: child.textContent,
      };

      if (
        !(window as typeof window & { navigation?: EventTarget }).navigation
      ) {
        throw new Error("Chromium fixture requires the Navigation API");
      }
      history.pushState(null, "", "/next");
      await new Promise((resolve) => setTimeout(resolve, 0));

      return {
        before,
        parent: parent.textContent,
        child: child.textContent,
      };
    });
    expect(restored.before).toEqual({
      parent: "Buy nowtoday",
      child: "today",
    });
    expect(restored.parent).toBe("Buy now");
    expect(restored.child).toBe("");

    expect(await lateAncestor("child-first", false)).toMatchObject({
      parent: "Buy now",
      child: "now",
    });
    expect(await lateAncestor("parent-first", false)).toMatchObject({
      parent: "Buy now",
      child: "now",
    });
    expect(await lateAncestor("child-first", true)).toEqual({
      parent: "Buy today",
      child: "today",
      childId: "shared-child",
      childMutations: 0,
    });
    expect(pageErrors).toEqual([]);
  });
});
