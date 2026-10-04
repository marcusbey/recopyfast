import { test, expect, type Page, type Route } from "@playwright/test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  buildEmbedScript,
  buildStableEmbedInstallation,
} from "../src/lib/sites/embed-script";

const APP_ORIGIN = "https://app.example";
const CUSTOMER_ORIGIN = "https://customer.example";
const SITE_ID = "123e4567-e89b-42d3-a456-426614174000";
const SITE_TOKEN =
  "123e4567-e89b-42d3-a456-426614174000.1760000000.9f47c2a8e10b6d35a0f4e9c271bd8a6503ce7f1a94b2d680e51c39af76d084be";
const INSTALLATION = buildStableEmbedInstallation({
  siteId: SITE_ID,
  siteToken: SITE_TOKEN,
  appUrl: APP_ORIGIN,
  wsUrl: "",
  nonce: "AbCdEfGhIjKlMnOpQrStUvWx",
});

type Scenario = {
  id: string;
  stable: boolean;
  delayMs: number;
  firstVisible: string;
  finalVisible: string;
  ab?: "slow";
  shadow?: boolean;
  slowFont?: boolean;
  react?: boolean;
  styleBlocked?: boolean;
  hashCsp?: boolean;
  sameOrigin?: boolean;
};

const scenarios: Scenario[] = [
  {
    id: "legacy-swap",
    stable: false,
    delayMs: 150,
    firstVisible: "Authored headline",
    finalVisible: "Published headline",
  },
  {
    id: "stable-fast",
    stable: true,
    delayMs: 30,
    firstVisible: "Published headline",
    finalVisible: "Published headline",
  },
  {
    id: "stable-deadline",
    stable: true,
    delayMs: 270,
    firstVisible: "Authored headline",
    finalVisible: "Authored headline",
  },
  {
    id: "stable-ab-deadline",
    stable: true,
    delayMs: 20,
    firstVisible: "Published baseline",
    finalVisible: "Published baseline",
    ab: "slow",
  },
  {
    id: "stable-open-shadow-font",
    stable: true,
    delayMs: 35,
    firstVisible: "Published headline",
    finalVisible: "Published headline",
    shadow: true,
    slowFont: true,
  },
  {
    id: "stable-react-19",
    stable: true,
    delayMs: 35,
    firstVisible: "Published headline",
    finalVisible: "Published headline",
    react: true,
  },
  {
    id: "stable-style-csp-fallback",
    stable: true,
    delayMs: 30,
    firstVisible: "Authored headline",
    finalVisible: "Authored headline",
    styleBlocked: true,
  },
  {
    id: "stable-quoted-csp-hashes",
    stable: true,
    delayMs: 30,
    firstVisible: "Published headline",
    finalVisible: "Published headline",
    hashCsp: true,
  },
  {
    id: "stable-same-origin-auth-signal",
    stable: true,
    delayMs: 30,
    firstVisible: "Published headline",
    finalVisible: "Published headline",
    sameOrigin: true,
  },
];

let widgetSource = "";
let reactHydration = "";

test.beforeAll(async () => {
  widgetSource = await readFile("public/embed/recopyfast.js", "utf8");
  const built = await build({
    stdin: {
      contents: `
        import React from "react";
        import { hydrateRoot } from "react-dom/client";
        window.__reactRecoverableErrors = [];
        hydrateRoot(
          document.getElementById("react-root"),
          React.createElement(
            "section",
            { id: "react-shell" },
            React.createElement(
              "h1",
              { id: "headline", "data-rcf-id": "hero", "data-rcf-content": "" },
              React.createElement("span", null, "Authored"),
              " ",
              React.createElement("span", null, "headline"),
            ),
            React.createElement("p", { "data-rcf-ignore": "", id: "ignored" }, "Ignored host copy"),
          ),
          { onRecoverableError(error) { window.__reactRecoverableErrors.push(String(error)); } },
        );
      `,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    write: false,
  });
  reactHydration = built.outputFiles[0].text;
});

function probeScript() {
  return `<script>
    window.__proof={start:performance.now(),frames:[],cls:0};
    try{new PerformanceObserver(function(list){list.getEntries().forEach(function(e){if(!e.hadRecentInput)window.__proof.cls+=e.value})}).observe({type:'layout-shift',buffered:true})}catch(e){}
    (function frame(){
      var hero=document.getElementById('headline');
      var host=document.getElementById('shadow-host');
      var shadow=host&&host.shadowRoot&&host.shadowRoot.getElementById('shadow-headline');
      var text=hero&&getComputedStyle(hero).visibility!=='hidden'?hero.textContent:null;
      var shadowText=shadow&&getComputedStyle(shadow).visibility!=='hidden'?shadow.textContent:null;
      var frames=window.__proof.frames,last=frames[frames.length-1];
      if((text||shadowText)&&(!last||last.text!==text||last.shadow!==shadowText))frames.push({at:performance.now()-window.__proof.start,text:text,shadow:shadowText});
      requestAnimationFrame(frame);
    })();
  </script>`;
}

function fixtureHtml(scenario: Scenario) {
  const installation = scenario.sameOrigin
    ? buildStableEmbedInstallation({
        siteId: SITE_ID,
        siteToken: SITE_TOKEN,
        appUrl: CUSTOMER_ORIGIN,
        wsUrl: "",
      })
    : INSTALLATION;
  const runtime = scenario.stable
    ? installation.runtimeTag
    : buildEmbedScript({
        siteId: SITE_ID,
        siteToken: SITE_TOKEN,
        appUrl: APP_ORIGIN,
        wsUrl: "",
      });
  const shadowPrelude = scenario.styleBlocked
    ? `<script>window.__nativeAttachShadow=Element.prototype.attachShadow</script>`
    : "";
  const head = `${
    scenario.slowFont
      ? `<style nonce="AbCdEfGhIjKlMnOpQrStUvWx">@font-face{font-family:SlowProof;src:url('${APP_ORIGIN}/slow-font.woff2')}#headline{font-family:SlowProof,sans-serif}</style>`
      : ""
  }${shadowPrelude}${scenario.stable ? installation.headBootstrap : ""}${probeScript()}`;
  const ordinary = `<main><h1 id="headline" data-rcf-id="hero">Authored headline</h1><p data-rcf-ignore id="ignored">Ignored host copy</p></main>`;
  const react = `<div id="react-root"><section id="react-shell"><h1 id="headline" data-rcf-id="hero" data-rcf-content><span>Authored</span> <span>headline</span></h1><p data-rcf-ignore id="ignored">Ignored host copy</p></section></div><script nonce="AbCdEfGhIjKlMnOpQrStUvWx">${reactHydration}</script>`;
  const shadow = scenario.shadow
    ? `<div id="shadow-host"></div><script nonce="AbCdEfGhIjKlMnOpQrStUvWx">document.getElementById('shadow-host').attachShadow({mode:'open'}).innerHTML='<h2 id="shadow-headline" data-rcf-id="shadow">Authored shadow</h2>'</script>`
    : "";
  return `<!doctype html><html><head>${head}</head><body>${scenario.react ? react : ordinary}${shadow}${runtime}</body></html>`;
}

function hashSource(value: string) {
  return `sha256-${createHash("sha256").update(value).digest("base64")}`;
}

function inlineBody(tag: string) {
  return tag.slice(tag.indexOf(">") + 1, tag.lastIndexOf("</script>"));
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": CUSTOMER_ORIGIN },
    body: JSON.stringify(body),
  });
}

async function proof(page: Page) {
  return page.evaluate(() => ({
    ...(
      window as unknown as {
        __proof: {
          frames: Array<{
            at: number;
            text: string | null;
            shadow: string | null;
          }>;
          cls: number;
        };
      }
    ).__proof,
    startup:
      (
        window as unknown as {
          __rcfStartup?: { status: string; code: string | null };
        }
      ).__rcfStartup ?? null,
    reactErrors:
      (window as unknown as { __reactRecoverableErrors?: string[] })
        .__reactRecoverableErrors ?? [],
    hookRestored:
      !(window as unknown as { __nativeAttachShadow?: unknown })
        .__nativeAttachShadow ||
      Element.prototype.attachShadow ===
        (window as unknown as { __nativeAttachShadow?: unknown })
          .__nativeAttachShadow,
  }));
}

test("stable startup controls the first visible managed frame", async ({
  page,
}) => {
  let scenario = scenarios[0];
  let trackRequests = 0;
  let contentGets = 0;
  let contentHeaders: Record<string, string> = {};
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === CUSTOMER_ORIGIN && url.pathname === "/pricing") {
      const probeHash = hashSource(inlineBody(probeScript()));
      const connectSources = INSTALLATION.csp.connectSources.join(" ");
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        headers:
          scenario.styleBlocked || scenario.hashCsp
            ? {
                "content-security-policy": scenario.styleBlocked
                  ? `default-src 'none'; script-src 'unsafe-inline' ${APP_ORIGIN}; connect-src ${APP_ORIGIN}; style-src 'none'`
                  : `default-src 'none'; script-src ${APP_ORIGIN} '${INSTALLATION.csp.scriptHash}' '${probeHash}'; connect-src ${connectSources}; style-src '${INSTALLATION.csp.styleHash}'`,
              }
            : {},
        body: fixtureHtml(scenario),
      });
      return;
    }
    const runtimeOrigin = scenario.sameOrigin ? CUSTOMER_ORIGIN : APP_ORIGIN;
    if (url.href === `${runtimeOrigin}/embed/recopyfast.js`) {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: widgetSource,
      });
      return;
    }
    if (url.href === `${APP_ORIGIN}/slow-font.woff2`) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.abort();
      return;
    }
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": CUSTOMER_ORIGIN,
          "access-control-allow-headers": "authorization,content-type",
          "access-control-allow-methods": "GET,POST,OPTIONS",
        },
      });
      return;
    }
    if (
      url.pathname.endsWith(`/api/content/${SITE_ID}`) &&
      request.method() === "GET"
    ) {
      contentGets += 1;
      contentHeaders = request.headers();
      await new Promise((resolve) => setTimeout(resolve, scenario.delayMs));
      await fulfillJson(route, [
        {
          element_id: "hero",
          current_content:
            scenario.ab === "slow"
              ? "Published baseline"
              : "Published headline",
        },
        ...(scenario.shadow
          ? [{ element_id: "shadow", current_content: "Published shadow" }]
          : []),
      ]);
      return;
    }
    if (
      url.pathname.endsWith(`/api/content/${SITE_ID}`) &&
      request.method() === "POST"
    ) {
      await fulfillJson(route, { success: true });
      return;
    }
    if (url.pathname.endsWith(`/api/ab-tests/active/${SITE_ID}`)) {
      await fulfillJson(
        route,
        scenario.ab === "slow"
          ? {
              tests: [
                {
                  id: "slow-test",
                  target_element_id: "hero",
                  variants: [
                    {
                      id: "late-variant",
                      variant_content: "Late assigned headline",
                      traffic_percentage: 100,
                      is_control: false,
                    },
                  ],
                },
              ],
            }
          : { tests: [] },
      );
      return;
    }
    if (url.pathname.endsWith(`/api/ab-tests/bucket/${SITE_ID}`)) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await fulfillJson(route, {
        assignments: { "slow-test": "late-variant" },
        geo: null,
      });
      return;
    }
    if (url.pathname.endsWith("/api/ab-tests/track")) {
      trackRequests += 1;
      await fulfillJson(route, { success: true });
      return;
    }
    await route.abort();
  });

  for (const candidate of scenarios) {
    await test.step(candidate.id, async () => {
      scenario = candidate;
      trackRequests = 0;
      contentGets = 0;
      contentHeaders = {};
      await page.goto(`${CUSTOMER_ORIGIN}/pricing?case=${candidate.id}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator("#headline")).toHaveText(
        candidate.finalVisible,
        {
          timeout: 1000,
        },
      );
      if (candidate.delayMs > 200 || candidate.ab === "slow") {
        await page.waitForTimeout(300);
      }

      const captured = await proof(page);
      expect(captured.frames[0]?.text).toBe(candidate.firstVisible);
      expect(captured.frames.at(-1)?.text).toBe(candidate.finalVisible);
      expect(captured.cls).toBe(0);
      expect(await page.locator("#ignored").textContent()).toBe(
        "Ignored host copy",
      );
      expect(contentGets).toBe(candidate.styleBlocked ? 0 : 1);
      if (candidate.sameOrigin) {
        expect(contentHeaders.authorization).toBe(`Bearer ${SITE_TOKEN}`);
        expect(contentHeaders.origin).toBeUndefined();
        expect(contentHeaders.referer).toBe(`${CUSTOMER_ORIGIN}/`);
        expect(contentHeaders.referer).not.toContain("pricing");
        expect(contentHeaders.referer).not.toContain("rcf_");
      } else if (candidate.stable && !candidate.styleBlocked) {
        expect(contentHeaders.referer).toBeUndefined();
      }

      if (
        candidate.stable &&
        !candidate.styleBlocked &&
        candidate.delayMs <= 200
      ) {
        expect(captured.startup?.status).toBe("d");
      }
      if (candidate.id === "stable-deadline") {
        expect(captured.startup).toMatchObject({ status: "f", code: "d" });
      }
      if (candidate.ab === "slow") {
        expect(trackRequests).toBe(0);
        expect(
          await page.locator("#headline").getAttribute("data-rcf-variant"),
        ).toBeNull();
      }
      if (candidate.shadow) {
        expect(captured.frames[0]?.shadow).toBe("Published shadow");
      }
      if (candidate.react) {
        expect(captured.reactErrors).toEqual([]);
      }
      if (candidate.styleBlocked) {
        expect(captured.startup).toMatchObject({ status: "f", code: "s" });
        expect(captured.hookRestored).toBe(true);
      }
    });
  }
});
