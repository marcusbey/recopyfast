import { createServer, type Server } from "node:http";
import { build } from "esbuild";
import React from "react";
import { renderToString } from "react-dom/server";

/**
 * s67 — the customer sites the embed has to survive, served by a local host.
 *
 * Three kinds of page, each loading the REAL artifact (`<appUrl>/embed/recopyfast.js`)
 * exactly as a customer's snippet does:
 *
 *   - `/spa/*`  a framework-free single-page app. The same shell answers every
 *               path; the outlet renders 600 ms after load, links navigate with
 *               `history.pushState`, Back re-renders on `popstate`, a ticker
 *               rewrites a text node every 100 ms, and the host writes the
 *               authored headline back with `textContent` one second after it
 *               rendered. Each of those is a way the embed lost published copy
 *               on openflows.ai (docs/research/s67-embed-spa-support.md).
 *               A third link (`data-in-place`) navigates the way a param route
 *               does: `pushState`, then the SAME headline and lead get the new
 *               page's text through `nodeValue` — text changes, no added node
 *               (s67 review, finding 1).
 *   - `/react/` React 19 rendering on the client, flushed synchronously BEFORE
 *               the snippet runs, so the embed writes into nodes React owns.
 *   - `/ssr/`   React 19 server-rendered with `renderToString`, then hydrated
 *               after `?hydrateDelay=` ms. `?snippet=after-hydration` injects the
 *               snippet only once hydration has committed.
 *
 * React is bundled here at test time with esbuild in production mode, the
 * build a customer ships. Nothing in this file reaches a network: the API the
 * snippet is pointed at is answered by the spec's `context.route`.
 */

export const SITE_ID = "spa-site";
export const SITE_TOKEN = "spa-site-token";
export const API_ORIGIN = "https://api.rcf-spa.test";
export const API_URL = `${API_ORIGIN}/api`;

export const SPA_PAGES: Record<string, { headline: string; lead: string }> = {
  "/spa": {
    headline: "Home headline, authored",
    lead: "Home lead paragraph, authored",
  },
  "/spa/about": {
    headline: "About headline, authored",
    lead: "About lead paragraph, authored",
  },
};
export const TAGLINE = "Persistent tagline, authored";

/**
 * One React tree for both renderers, as source text, so the server render and
 * the client bundle cannot drift apart. `prefix` names the author-written ids:
 * `r-*` on the client-rendered page, `s-*` on the server-rendered one.
 *
 * The two shapes are the two measured crashes (research R1c / R1d): a text
 * node React removes later (`{show && ' world'}`) and an element React inserts
 * before a text node (`{icon && <b>!</b>}`). `window.__toggle()` flips both in
 * one synchronous commit.
 */
const REACT_APP_SOURCE = `
function App(props) {
  var shown = React.useState(true);
  var iconed = React.useState(false);
  React.useEffect(function () {
    window.__toggle = function () {
      ReactDOM.flushSync(function () {
        shown[1](function (value) { return !value; });
        iconed[1](function (value) { return !value; });
      });
    };
    if (props.onReady) props.onReady();
  }, []);
  return React.createElement(
    "main",
    { id: "app" },
    React.createElement("h1", { "data-rcf-id": props.prefix + "-hero" }, "Hello", shown[0] && " world"),
    React.createElement(
      "p",
      { "data-rcf-id": props.prefix + "-lead" },
      iconed[0] && React.createElement("b", null, "!"),
      "Lead text"
    ),
    React.createElement("p", { className: "plain" }, "Unanchored paragraph, stamped by the embed")
  );
}
`;

/**
 * React's three error channels, collected on `window.__reactErrors`. An
 * `insertBefore`/`removeChild` NotFoundError during a commit lands in
 * `onUncaughtError` and unmounts the whole root; a hydration mismatch (#418)
 * lands in `onRecoverableError`.
 */
const ERROR_CHANNELS = `
window.__reactErrors = [];
function channel(name) {
  return function (error) {
    window.__reactErrors.push(name + ": " + String((error && error.message) || error));
  };
}
var rootOptions = {
  onUncaughtError: channel("uncaught"),
  onCaughtError: channel("caught"),
  onRecoverableError: channel("recoverable")
};
`;

export interface ReactBundles {
  csr: string;
  ssr: string;
}

async function bundle(contents: string): Promise<string> {
  const result = await build({
    stdin: { contents, resolveDir: process.cwd(), loader: "js" },
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    define: { "process.env.NODE_ENV": '"production"' },
    legalComments: "none",
    write: false,
  });
  return result.outputFiles[0].text;
}

export async function buildReactBundles(): Promise<ReactBundles> {
  const imports = `
    import React from "react";
    import * as ReactDOM from "react-dom";
    import { createRoot, hydrateRoot } from "react-dom/client";
  `;
  const [csr, ssr] = await Promise.all([
    bundle(`${imports}
      ${REACT_APP_SOURCE}
      ${ERROR_CHANNELS}
      var root = createRoot(document.getElementById("react-root"), rootOptions);
      ReactDOM.flushSync(function () {
        root.render(React.createElement(App, { prefix: "r" }));
      });
    `),
    bundle(`${imports}
      ${REACT_APP_SOURCE}
      ${ERROR_CHANNELS}
      var config = window.__ssrFixture;
      setTimeout(function () {
        hydrateRoot(
          document.getElementById("react-root"),
          React.createElement(App, {
            prefix: "s",
            onReady: function () {
              window.__hydrated = true;
              if (config.snippetAfterHydration) config.loadSnippet();
            }
          }),
          rootOptions
        );
      }, config.hydrateDelay);
    `),
  ]);
  return { csr, ssr };
}

function renderServerApp(): string {
  const App = new Function(
    "React",
    "ReactDOM",
    `${REACT_APP_SOURCE}; return App;`,
  )(React, null) as React.FC<{ prefix: string }>;
  return renderToString(React.createElement(App, { prefix: "s" }));
}

function snippetAttributes(appUrl: string): Record<string, string> {
  return {
    src: `${appUrl}/embed/recopyfast.js`,
    "data-site-id": SITE_ID,
    "data-site-token": SITE_TOKEN,
    "data-api-url": API_URL,
  };
}

function snippetTag(appUrl: string): string {
  const attributes = Object.entries(snippetAttributes(appUrl))
    .map(([name, value]) => `${name}="${value}"`)
    .join(" ");
  return `<script ${attributes}></script>`;
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

function spaPage(appUrl: string): string {
  return page(
    "SPA fixture",
    `
    <header id="site-header">
      <p class="tagline">${TAGLINE}</p>
      <nav><a href="/spa/" data-nav>Home</a> <a href="/spa/about" data-nav>About</a> <a href="/spa/about/" data-nav data-in-place>About, in place</a></nav>
    </header>
    <main id="outlet"></main>
    <footer><span id="clock">tick 0</span></footer>
    <script>
      var pages = ${JSON.stringify(SPA_PAGES)};
      function current() {
        return pages[location.pathname.replace(/\\/+$/, "")] || pages["/spa"];
      }
      function render() {
        var outlet = document.getElementById("outlet");
        var copy = current();
        var headline = document.createElement("h1");
        headline.textContent = copy.headline;
        var lead = document.createElement("p");
        lead.textContent = copy.lead;
        outlet.replaceChildren(headline, lead);
      }
      function renderInPlace() {
        var copy = current();
        document.querySelector("#outlet h1").firstChild.nodeValue = copy.headline;
        document.querySelector("#outlet p").firstChild.nodeValue = copy.lead;
      }
      setTimeout(function () {
        render();
        setTimeout(function () {
          var headline = document.querySelector("#outlet h1");
          if (headline) headline.textContent = current().headline;
          window.__writeBack = true;
        }, 1000);
      }, 600);
      document.addEventListener("click", function (event) {
        var link = event.target.closest && event.target.closest("a[data-nav]");
        if (!link) return;
        event.preventDefault();
        history.pushState(null, "", link.getAttribute("href"));
        if (link.hasAttribute("data-in-place")) renderInPlace();
        else render();
      });
      window.addEventListener("popstate", render);
      var tick = 0;
      var clock = document.getElementById("clock").firstChild;
      setInterval(function () { clock.nodeValue = "tick " + (++tick); }, 100);
    </script>
    ${snippetTag(appUrl)}
    `,
  );
}

function csrPage(appUrl: string, csrBundle: string): string {
  return page(
    "React client render fixture",
    `<div id="react-root"></div>
    <script>${csrBundle}</script>
    ${snippetTag(appUrl)}`,
  );
}

function ssrPage(
  appUrl: string,
  ssrBundle: string,
  hydrateDelay: number,
  snippetAfterHydration: boolean,
): string {
  const config = `
    window.__ssrFixture = {
      hydrateDelay: ${hydrateDelay},
      snippetAfterHydration: ${snippetAfterHydration},
      loadSnippet: function () {
        var script = document.createElement("script");
        var attributes = ${JSON.stringify(snippetAttributes(appUrl))};
        Object.keys(attributes).forEach(function (name) {
          script.setAttribute(name, attributes[name]);
        });
        document.body.appendChild(script);
      }
    };
  `;
  return page(
    "React server render fixture",
    `<div id="react-root">${renderServerApp()}</div>
    <script>${config}</script>
    <script>${ssrBundle}</script>
    ${snippetAfterHydration ? "" : snippetTag(appUrl)}`,
  );
}

export async function startSpaHost(
  port: number,
  appUrl: string,
  bundles: ReactBundles,
): Promise<Server> {
  const server = createServer((incoming, response) => {
    const url = new URL(incoming.url ?? "/", `http://localhost:${port}`);
    let body: string | null = null;

    if (url.pathname === "/spa" || url.pathname.startsWith("/spa/")) {
      body = spaPage(appUrl);
    } else if (url.pathname === "/react/") {
      body = csrPage(appUrl, bundles.csr);
    } else if (url.pathname === "/ssr/") {
      body = ssrPage(
        appUrl,
        bundles.ssr,
        Number(url.searchParams.get("hydrateDelay") || "0"),
        url.searchParams.get("snippet") === "after-hydration",
      );
    }

    if (body === null) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}
