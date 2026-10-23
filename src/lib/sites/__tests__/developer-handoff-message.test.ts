/**
 * @jest-environment node
 */

import {
  CREDENTIAL_PATTERNS,
  DEVELOPER_GUIDE_PATH,
  MAX_MAILTO_HREF_LENGTH,
  WORDPRESS_GUIDE_PATH,
  buildDeveloperHandoffMessage,
  findCredentialMaterial,
  formatDeveloperHandoffForCopy,
  parseEmbedScript,
} from "@/lib/sites/developer-handoff-message";
import { buildEmbedScript } from "@/lib/sites/embed-script";

const APP = "https://www.recopyfa.st";
const SITE_ID = "6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c";
const SITE_TOKEN = `${SITE_ID}.1761100000.${"a1".repeat(32)}`;
/** The HMAC secret the registration response also carries. Never emailed. */
const API_KEY =
  "b7e1c0ffee5ecret0000000000000000000000000000000000000000deadbeef";

const SCRIPT = buildEmbedScript({
  siteId: SITE_ID,
  siteToken: SITE_TOKEN,
  appUrl: APP,
  wsUrl: "wss://recopyfast-ws.fly.dev",
});

function build(overrides: { embedScript?: string; siteDomain?: string } = {}) {
  return buildDeveloperHandoffMessage({
    embedScript: SCRIPT,
    siteDomain: "www.bellavista.example",
    ...overrides,
  });
}

function messageOf(result: ReturnType<typeof build>) {
  if (!result.ok) throw new Error(`expected a message, got ${result.reason}`);
  return result.message;
}

describe("buildDeveloperHandoffMessage — content", () => {
  it("names the site in the subject and asks for one line, once", () => {
    const message = messageOf(build());

    expect(message.subject).toBe(
      "Could you add one line to www.bellavista.example? (ReCopyFast)",
    );
    expect(message.body).toContain(
      "Could you add this one line to the site, once?",
    );
    expect(message.body).toContain("www.bellavista.example");
  });

  it("carries the exact generated script tag, unmodified, exactly once", () => {
    const { body } = messageOf(build());

    expect(body.split(SCRIPT)).toHaveLength(2);
    expect(body.match(/<script /g)).toHaveLength(1);
  });

  it("gives per-platform recipes and links the public guides on the issuing origin", () => {
    const { body } = messageOf(build());

    for (const platform of [
      "WordPress",
      "Webflow",
      "Framer",
      "Custom or static site",
      "React / Next.js",
    ]) {
      expect(body).toContain(`- ${platform}`);
    }
    expect(body).toContain("WPCode");
    expect(body).toContain(`${APP}${WORDPRESS_GUIDE_PATH}`);
    expect(body).toContain(`${APP}${DEVELOPER_GUIDE_PATH}`);
  });

  it("explains security in three lines", () => {
    const { body } = messageOf(build());
    const section = body
      .split("Security, in three lines:\n")[1]
      .split("\n\n")[0];

    expect(section.split("\n")).toHaveLength(3);
    expect(section).toMatch(/public by design/);
    expect(section).toMatch(/password/);
  });

  it("formats a pasteable block with the subject first", () => {
    const message = messageOf(build());

    expect(formatDeveloperHandoffForCopy(message)).toBe(
      `Subject: ${message.subject}\n\n${message.body}`,
    );
  });
});

describe("buildDeveloperHandoffMessage — no credential ever leaves", () => {
  it("contains no editor link, session, staging token or secret", () => {
    const message = messageOf(build());
    const everything = `${formatDeveloperHandoffForCopy(message)}\n${decodeURIComponent(message.mailtoHref)}`;

    for (const pattern of CREDENTIAL_PATTERNS) {
      expect([pattern.source, pattern.test(everything)]).toEqual([
        pattern.source,
        false,
      ]);
    }
    expect(everything).not.toContain(API_KEY);
    expect(everything).not.toMatch(/\/edit\b/);
    expect(everything).not.toMatch(/rcf_/);
  });

  it("only carries the token that is already public in the page's HTML", () => {
    const { body } = messageOf(build());
    const tokens = [...body.matchAll(/data-site-token="([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(tokens).toEqual([SITE_TOKEN]);
    // The token appears nowhere outside its attribute.
    expect(body.split(SITE_TOKEN)).toHaveLength(2);
  });

  it.each([
    [
      "an extra attribute",
      SCRIPT.replace("></script>", ` data-api-key="${API_KEY}"></script>`),
    ],
    ["an editor link appended", `${SCRIPT}\n${APP}/edit#rcf_edit=abc123`],
    [
      "a staging token in the src",
      SCRIPT.replace(
        "/embed/recopyfast.js",
        "/embed/recopyfast.js?rcf_staging=1&rcf_token=abc",
      ),
    ],
    [
      "an API on another origin",
      SCRIPT.replace(`${APP}/api`, "https://evil.example/api"),
    ],
    ["the docs placeholder", '<script src="test.js"></script>'],
    ["two tags", `${SCRIPT}${SCRIPT}`],
    ["an empty string", ""],
  ])("refuses a snippet with %s", (_label, embedScript) => {
    expect(build({ embedScript })).toEqual({
      ok: false,
      reason: "invalid_snippet",
    });
  });

  it.each(["", "bella vista.com", "example.com\nBcc: x@y.z", "https://x.com/"])(
    "refuses a domain that is not a hostname: %j",
    (siteDomain) => {
      expect(build({ siteDomain })).toEqual({
        ok: false,
        reason: "invalid_domain",
      });
    },
  );

  it("accepts the snippet without a websocket and a localhost port", () => {
    const local = buildEmbedScript({
      siteId: SITE_ID,
      siteToken: SITE_TOKEN,
      appUrl: "http://localhost:3000",
      wsUrl: "",
    });

    expect(parseEmbedScript(local)).toEqual({
      script: local,
      appOrigin: "http://localhost:3000",
    });
    expect(build({ embedScript: local, siteDomain: "localhost:8080" }).ok).toBe(
      true,
    );
  });

  it.each([
    ["a Stripe secret as the site token", { token: "sk_live_abc123" }],
    ["an editor-entry parameter as the site id", { id: "x?rcf_token=abc" }],
    ["a session token name as the site id", { id: "access_token" }],
    ["an api_key label as the site token", { token: "api_key=abc" }],
  ])(
    "refuses a parser-valid tag carrying %s (the final scan)",
    (_label, values) => {
      const embedScript = SCRIPT.replace(
        `data-site-id="${SITE_ID}"`,
        `data-site-id="${"id" in values ? values.id : SITE_ID}"`,
      ).replace(
        `data-site-token="${SITE_TOKEN}"`,
        `data-site-token="${"token" in values ? values.token : SITE_TOKEN}"`,
      );
      // The shape check passes: only the credential scan can refuse it.
      expect(parseEmbedScript(embedScript)).not.toBeNull();

      expect(build({ embedScript })).toEqual({
        ok: false,
        reason: "credential_detected",
      });
    },
  );

  it.each(["api-key.example", "www.apikey.example", "apikey.example:8080"])(
    "does not mistake a hostname containing api-key for a secret: %s",
    (siteDomain) => {
      expect(build({ siteDomain }).ok).toBe(true);
    },
  );

  it("detects each credential shape it guards against", () => {
    for (const sample of [
      "https://www.recopyfa.st/edit",
      "?rcf_handoff=x",
      "#rcf_edit=abc",
      "rcf_token=abc",
      "access_token=abc",
      "service_role",
      "sk_live_abc",
      "whsec_abc",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig",
      "api_key",
      "apiKey: abc",
      "X-Api-Key: abc",
      "https://www.recopyfa.st/dashboard/sites",
    ]) {
      expect([sample, findCredentialMaterial(sample)]).toEqual([
        sample,
        expect.any(RegExp),
      ]);
    }
    expect(findCredentialMaterial(SCRIPT)).toBeNull();
  });
});

describe("buildDeveloperHandoffMessage — mailto", () => {
  it("encodes subject and body with CRLF line breaks", () => {
    const { mailtoHref, subject } = messageOf(build());

    expect(mailtoHref.startsWith("mailto:?subject=")).toBe(true);
    const params = new URLSearchParams(mailtoHref.slice("mailto:?".length));
    expect(params.get("subject")).toBe(subject);
    expect(params.get("body")).toContain("\r\n");
    expect(mailtoHref).not.toMatch(/[\s<>"]/);
  });

  it("never exceeds the safe mailto length and keeps the snippet whole", () => {
    const message = messageOf(build());
    const body = new URLSearchParams(
      message.mailtoHref.slice("mailto:?".length),
    ).get("body");

    expect(message.mailtoHref.length).toBeLessThanOrEqual(
      MAX_MAILTO_HREF_LENGTH,
    );
    // The full message does not fit, so the email app gets the short one.
    expect(message.mailtoBody).toBe("short");
    expect(body).toContain(SCRIPT);
    expect(body).toContain(`${APP}${DEVELOPER_GUIDE_PATH}`);
    expect(body).toContain("Paste the full message");
  });

  it("opens a subject-only draft rather than a truncated snippet", () => {
    const longToken = `${SITE_ID}.1761100000.${"f".repeat(1500)}`;
    const embedScript = buildEmbedScript({
      siteId: SITE_ID,
      siteToken: longToken,
      appUrl: APP,
      wsUrl: "",
    });
    const message = messageOf(build({ embedScript }));

    expect(message.mailtoBody).toBe("none");
    expect(message.mailtoHref).not.toContain("body=");
    expect(message.mailtoHref.length).toBeLessThanOrEqual(
      MAX_MAILTO_HREF_LENGTH,
    );
    expect(message.body).toContain(embedScript);
  });
});
