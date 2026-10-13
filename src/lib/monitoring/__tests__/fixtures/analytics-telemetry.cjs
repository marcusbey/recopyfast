/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CJS SDK-envelope fixture runs outside Jest and intentionally loads the installed CJS instrumentation. */
// Real installed Sentry SDK, in-memory transport only. No provider or collector.
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");
const sentry = require("@sentry/node");
const root = path.resolve(__dirname, "../../../../..");
let config;
let fetchOptions;
const load = (file) => {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    URL,
    process: { env: { NODE_ENV: "production" }, version: process.version },
    require(name) {
      if (name === "@sentry/nextjs")
        return {
          ...sentry,
          init: (value) => {
            config = value;
          },
          nativeNodeFetchIntegration: (options) => {
            fetchOptions = options;
            return sentry.nativeNodeFetchIntegration(options);
          },
        };
      if (name.startsWith("."))
        return load(path.resolve(path.dirname(file), name + ".ts"));
      throw new Error("Unexpected fixture import");
    },
  });
  return exports;
};
load(path.join(root, "sentry.server.config.ts"));
const envelopes = [];
const secret = "DUMMY_S111_SECRET_CANARY";
const collector = `https://www.google-analytics.com/mp/collect?measurement_id=G-DQ00NEM3WE&api_secret=${secret}`;
sentry.init({
  ...config,
  dsn: "https://dummy@example.invalid/1",
  defaultIntegrations: [],
  tracesSampleRate: 1,
  transport: () => ({
    send: async (envelope) => {
      envelopes.push(envelope);
      return { statusCode: 200 };
    },
    flush: async () => true,
  }),
});
const helpers = require(
  path.join(
    root,
    "node_modules/@sentry/node-core/build/cjs/utils/outgoingFetchRequest.js",
  ),
);
helpers.addFetchRequestBreadcrumb(
  {
    origin: "https://www.google-analytics.com",
    path: new URL(collector).pathname + new URL(collector).search,
    method: "POST",
  },
  { statusCode: 204 },
);
helpers.addFetchRequestBreadcrumb(
  { origin: "https://status.example.invalid", path: "/health", method: "GET" },
  { statusCode: 200 },
);
sentry.captureMessage("safe fixture event");
sentry.startSpan(
  { name: "safe parent transaction", op: "test", forceTransaction: true },
  () => {
    sentry.startSpan(
      {
        name: "POST collector",
        op: "http.client",
        attributes: { "url.full": collector },
      },
      () => {},
    );
    sentry.startSpan(
      {
        name: "safe health span",
        op: "http.client",
        attributes: { "url.full": "https://status.example.invalid/health" },
      },
      () => {},
    );
  },
);
(async () => {
  await sentry.flush(2000);
  const serialized = JSON.stringify(envelopes);
  const events = envelopes.flatMap((envelope) =>
    envelope[1].map((item) => item[1]),
  );
  console.log(
    JSON.stringify({
      leaked: serialized.includes(secret),
      errorCount: events.filter(
        (event) => event.message === "safe fixture event",
      ).length,
      transactionCount: events.filter((event) => event.type === "transaction")
        .length,
      unrelatedBreadcrumb: events.some((event) =>
        event.breadcrumbs?.some((crumb) =>
          crumb.data?.url?.includes("status.example.invalid"),
        ),
      ),
      unrelatedSpan: events.some((event) =>
        event.spans?.some((span) => span.description === "safe health span"),
      ),
      integrationIgnoresCollector:
        fetchOptions?.ignoreOutgoingRequests(collector) === true,
      integrationKeepsHealth:
        fetchOptions?.ignoreOutgoingRequests(
          "https://status.example.invalid/health",
        ) === false,
      collectorSpans: events
        .flatMap((event) => event.spans ?? [])
        .filter((span) =>
          span.data?.["url.full"]?.includes("google-analytics.com"),
        ).length,
    }),
  );
  await sentry.close(1000);
})().catch(() => {
  console.error("Telemetry fixture failed");
  process.exitCode = 1;
});
