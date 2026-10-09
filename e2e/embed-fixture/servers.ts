import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { fixturePage } from "./fixture-page";
import {
  FIXTURE_ELEMENT_IDS,
  FIXTURE_SITE_ID,
  FIXTURE_SITE_TOKEN,
  FIXTURE_STAGING_TOKEN,
  StubApi,
} from "./stub-api";

export {
  FIXTURE_ELEMENT_IDS,
  FIXTURE_SITE_ID,
  FIXTURE_SITE_TOKEN,
  FIXTURE_STAGING_TOKEN,
};

const LOOPBACK = "127.0.0.1";
const DEFAULT_SERVING_PORT = 4181;
const DEFAULT_HOST_PORT = 4182;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="#b9d8d1" />
  <circle cx="252" cy="44" r="25" fill="#f6c453" />
  <path d="M0 156L86 82l52 47 54-61 128 88v24H0z" fill="#315f59" />
</svg>`;

const REPLACEMENT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="#242d3d" />
  <circle cx="72" cy="58" r="28" fill="#f28c6f" />
  <path d="M0 150l92-64 48 34 65-72 115 102v30H0z" fill="#8fb8ad" />
</svg>`;

export interface FixtureServers {
  readonly servingOrigin: string;
  readonly hostOrigin: string;
  readonly artifactPath: string;
  readonly api: StubApi;
  stagingUrl(): string;
  liveUrl(options?: { widget?: boolean }): string;
  close(): Promise<void>;
}

interface StartFixtureServersOptions {
  artifactPath?: string;
  servingPort?: number;
  hostPort?: number;
}

function portFromEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return parsed;
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, LOOPBACK);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections?.();
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function respondText(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
) {
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body).toString(),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  response.end(body);
}

function fail(response: ServerResponse, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  respondText(
    response,
    500,
    "text/plain; charset=utf-8",
    `Fixture server error: ${message}`,
  );
}

/**
 * Starts the two-origin instrument with no Next server and no credentials.
 *
 * The serving origin reads the committed built artifact and socket fallback
 * directly from disk. `RECOPYFAST_FIXTURE_ARTIFACT` may point at a scratch copy
 * for the mutation proof; production source and generated files stay untouched.
 */
export async function startFixtureServers(
  options: StartFixtureServersOptions = {},
): Promise<FixtureServers> {
  const servingPort =
    options.servingPort ??
    portFromEnvironment(
      "RECOPYFAST_FIXTURE_SERVING_PORT",
      DEFAULT_SERVING_PORT,
    );
  const hostPort =
    options.hostPort ??
    portFromEnvironment("RECOPYFAST_FIXTURE_HOST_PORT", DEFAULT_HOST_PORT);

  if (servingPort === hostPort) {
    throw new Error(
      "The fixture serving and host origins need different ports.",
    );
  }

  const servingOrigin = `http://${LOOPBACK}:${servingPort}`;
  const hostOrigin = `http://${LOOPBACK}:${hostPort}`;
  const artifactPath = path.resolve(
    options.artifactPath ||
      process.env.RECOPYFAST_FIXTURE_ARTIFACT ||
      path.join(process.cwd(), "public/embed/recopyfast.js"),
  );
  const socketPath = path.resolve(
    process.cwd(),
    "public/embed/socket.io-client.min.js",
  );
  const api = new StubApi(servingOrigin, hostOrigin);

  const servingServer = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      void (async () => {
        if (await api.handle(request, response)) return;

        const url = new URL(request.url || "/", servingOrigin);
        if (url.pathname === "/embed/recopyfast.js") {
          respondText(
            response,
            200,
            "application/javascript; charset=utf-8",
            await readFile(artifactPath),
          );
          return;
        }
        if (url.pathname === "/embed/socket.io-client.min.js") {
          respondText(
            response,
            200,
            "application/javascript; charset=utf-8",
            await readFile(socketPath),
          );
          return;
        }
        if (url.pathname === "/assets/replacement.svg") {
          respondText(
            response,
            200,
            "image/svg+xml; charset=utf-8",
            REPLACEMENT_SVG,
          );
          return;
        }

        respondText(response, 404, "text/plain; charset=utf-8", "Not found");
      })().catch((error) => fail(response, error));
    },
  );

  const hostServer = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      try {
        const url = new URL(request.url || "/", hostOrigin);
        if (url.pathname === "/fixture-image.svg") {
          respondText(response, 200, "image/svg+xml; charset=utf-8", SVG);
          return;
        }
        if (url.pathname !== "/") {
          respondText(response, 404, "text/plain; charset=utf-8", "Not found");
          return;
        }

        respondText(
          response,
          200,
          "text/html; charset=utf-8",
          fixturePage({
            servingOrigin,
            hostOrigin,
            widget: url.searchParams.get("widget") !== "0",
          }),
        );
      } catch (error) {
        fail(response, error);
      }
    },
  );

  try {
    await listen(servingServer, servingPort);
    await listen(hostServer, hostPort);
  } catch (error) {
    if (servingServer.listening) await close(servingServer);
    if (hostServer.listening) await close(hostServer);
    throw error;
  }

  return {
    servingOrigin,
    hostOrigin,
    artifactPath,
    api,
    stagingUrl() {
      const url = new URL("/", hostOrigin);
      url.searchParams.set("rcf_staging", "1");
      url.searchParams.set("rcf_token", FIXTURE_STAGING_TOKEN);
      return url.toString();
    },
    liveUrl({ widget = true } = {}) {
      const url = new URL("/", hostOrigin);
      if (!widget) url.searchParams.set("widget", "0");
      return url.toString();
    },
    async close() {
      await Promise.all([close(hostServer), close(servingServer)]);
    },
  };
}

export async function waitForWidget(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const candidate = window as typeof window & {
        ReCopyFast?: { isInitialized?: boolean };
      };
      return candidate.ReCopyFast?.isInitialized === true;
    },
    undefined,
    { timeout: 20_000 },
  );
}
