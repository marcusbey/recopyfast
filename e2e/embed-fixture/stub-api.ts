import type { IncomingMessage, ServerResponse } from "node:http";

export const FIXTURE_SITE_ID = "00000000-0000-4000-8000-000000000006";
export const FIXTURE_SITE_TOKEN = "fixture.site.token";
export const FIXTURE_STAGING_TOKEN = "fixture-staging-token";

export const FIXTURE_ELEMENT_IDS = {
  heading: "fixture-heading",
  copy: "fixture-copy",
  image: "fixture-image",
} as const;

export const FIXTURE_TEXT = {
  heading: "Fixture headline",
  copy: "Fixture body copy.",
} as const;

export interface RecordedFixtureRequest {
  method: string;
  pathname: string;
  search: Record<string, string>;
  headers: Record<string, string>;
  json: unknown;
  rawBody: Buffer;
}

interface FixtureContentRow {
  id: string;
  site_id: string;
  element_id: string;
  selector: string;
  original_content: string;
  current_content: string;
  published_content: string;
  staging_content: string | null;
  language: string;
  variant: string;
  metadata: Record<string, unknown>;
  published_at: string;
  staging_updated_at: string | null;
  staging_updated_by: string | null;
}

interface FixtureLanguage {
  id: string;
  language_code: string;
  language_name: string;
  is_default: boolean;
  translation_coverage: number;
  last_translated_at: string | null;
  created_at: string;
}

interface FixtureVersion {
  id: string;
  version_number: number;
  created_by: string;
  description: string;
  elements_changed: number;
  change_type: string;
  created_at: string;
}

const FIXED_NOW = "2026-01-02T03:04:05.000Z";

const AVAILABLE_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
];

function requestHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) headers[name] = value.join(", ");
    else if (value !== undefined) headers[name] = value;
  }
  return headers;
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseJsonBody(rawBody: Buffer, contentType: string): unknown {
  if (rawBody.byteLength === 0 || !contentType.includes("application/json")) {
    return null;
  }

  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Credential-free stand-in for the route surface the built widget calls.
 *
 * Every success payload below is paired with the production route that owns
 * its shape. The stub deliberately contains no auth policy and no business
 * decisions: it gives the browser deterministic state, records what crossed
 * the wire, and lets the specs judge the widget on both sides of each action.
 */
export class StubApi {
  readonly replacementImageUrl: string;
  readonly requests: RecordedFixtureRequest[] = [];

  private readonly servingOrigin: string;
  private readonly hostOrigin: string;
  private content: FixtureContentRow[] = [];
  private languages: FixtureLanguage[] = [];
  private versions: FixtureVersion[] = [];

  constructor(servingOrigin: string, hostOrigin: string) {
    this.servingOrigin = servingOrigin;
    this.hostOrigin = hostOrigin;
    this.replacementImageUrl = `${servingOrigin}/assets/replacement.svg`;
    this.reset();
  }

  reset() {
    this.requests.length = 0;
    this.content = this.initialContent();
    this.languages = [
      {
        id: "language-en",
        language_code: "en",
        language_name: "English",
        is_default: true,
        translation_coverage: 100,
        last_translated_at: FIXED_NOW,
        created_at: FIXED_NOW,
      },
    ];
    this.versions = [
      {
        id: "version-2",
        version_number: 2,
        created_by: "fixture@recopyfast.local",
        description: "Fixture checkpoint",
        elements_changed: 3,
        change_type: "manual",
        created_at: FIXED_NOW,
      },
    ];
  }

  latestRequest(
    pathname: string,
    method?: string,
  ): RecordedFixtureRequest | undefined {
    const normalizedMethod = method?.toUpperCase();
    return this.requests
      .filter(
        (request) =>
          request.pathname === pathname &&
          (!normalizedMethod || request.method === normalizedMethod),
      )
      .at(-1);
  }

  publishedContent(elementId: string, language = "en"): string | null {
    return this.findContent(elementId, language)?.published_content ?? null;
  }

  stagedContent(elementId: string, language = "en"): string | null {
    return this.findContent(elementId, language)?.staging_content ?? null;
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(request.url || "/", this.servingOrigin);
    if (!url.pathname.startsWith("/api/")) return false;

    const method = (request.method || "GET").toUpperCase();
    const rawBody = await readRequestBody(request);
    const headers = requestHeaders(request);
    const json = parseJsonBody(rawBody, headers["content-type"] || "");
    this.requests.push({
      method,
      pathname: url.pathname,
      search: Object.fromEntries(url.searchParams),
      headers,
      json,
      rawBody,
    });

    if (method === "OPTIONS") {
      this.writeEmpty(response, 204);
      return true;
    }

    const contentMatch = url.pathname.match(/^\/api\/content\/([^/]+)$/);
    if (contentMatch) {
      if (method === "GET") {
        // src/app/api/content/[siteId]/route.ts GET
        const language = url.searchParams.get("language") || "en";
        this.writeJson(response, 200, this.liveRows(language));
        return true;
      }
      if (method === "POST") {
        // src/app/api/content/[siteId]/route.ts POST
        this.recordDiscoveredContent(json);
        this.writeJson(response, 200, { success: true });
        return true;
      }
    }

    const stagingContentMatch = url.pathname.match(
      /^\/api\/staging\/content\/([^/]+)$/,
    );
    if (stagingContentMatch) {
      if (method === "GET") {
        // src/app/api/staging/content/[siteId]/route.ts GET
        const language = url.searchParams.get("language") || "en";
        this.writeJson(response, 200, {
          content: this.stagingRows(language),
          permissions: ["view", "edit", "publish", "admin"],
          email: "fixture@recopyfast.local",
        });
        return true;
      }
      if (method === "PUT") {
        // src/app/api/staging/content/[siteId]/route.ts PUT
        const body = this.objectBody(json);
        const elementId = this.stringField(body, "elementId");
        const language = this.stringField(body, "language") || "en";
        const row = this.findContent(elementId, language);
        if (!row || typeof body.content !== "string") {
          this.writeJson(response, 404, { error: "Content element not found" });
          return true;
        }
        row.staging_content = body.content;
        row.current_content = body.content;
        row.staging_updated_at = FIXED_NOW;
        row.staging_updated_by = "fixture@recopyfast.local";
        if (body.contentType === "image" && typeof body.alt === "string") {
          row.metadata.alt = body.alt;
        }
        this.writeJson(response, 200, {
          success: true,
          elementId,
          updatedAt: FIXED_NOW,
        });
        return true;
      }
    }

    if (url.pathname === "/api/staging/validate" && method === "POST") {
      // src/app/api/staging/validate/route.ts POST
      this.writeJson(response, 200, {
        valid: true,
        kind: "staging",
        verified: true,
        permissions: ["view", "edit", "publish", "admin"],
        email: "fixture@recopyfast.local",
        expiresAt: "2099-01-01T00:00:00.000Z",
        requiresEmail: false,
        requiresVerification: false,
      });
      return true;
    }

    if (url.pathname === "/api/staging/verify" && method === "POST") {
      // src/app/api/staging/verify/route.ts POST
      const body = this.objectBody(json);
      if (body.action === "verify") {
        this.writeJson(response, 200, {
          success: true,
          verified: true,
          email: "fixture@recopyfast.local",
          permissions: ["view", "edit", "publish", "admin"],
          expiresAt: "2099-01-01T00:00:00.000Z",
        });
      } else {
        this.writeJson(response, 200, {
          success: true,
          message:
            body.action === "resend"
              ? "Verification code resent"
              : "Verification code sent to email",
        });
      }
      return true;
    }

    if (url.pathname === "/api/staging/publish") {
      if (method === "GET") {
        // src/app/api/staging/publish/route.ts GET
        const pending = this.pendingRows();
        this.writeJson(response, 200, {
          success: true,
          pendingChanges: pending.length,
          elements: pending.map((row) => ({
            id: row.id,
            elementId: row.element_id,
            selector: row.selector,
            stagingContent: row.staging_content,
            publishedContent: row.published_content,
            stagingUpdatedAt: row.staging_updated_at,
            metadata: row.metadata,
          })),
          canPublish: true,
        });
        return true;
      }
      if (method === "POST") {
        // src/app/api/staging/publish/route.ts POST
        const pending = this.pendingRows();
        const published = pending.map((row) => ({
          element_id: row.element_id,
          content: row.staging_content,
        }));
        for (const row of pending) {
          row.published_content = row.staging_content || row.published_content;
          row.current_content = row.published_content;
          row.staging_content = null;
          row.staging_updated_at = null;
          row.staging_updated_by = null;
        }
        this.writeJson(response, 200, {
          success: true,
          published: published.length,
          elements: published,
          publishedBy: "fixture@recopyfast.local",
        });
        return true;
      }
    }

    if (url.pathname === "/api/edit-board/history") {
      if (method === "GET") {
        // src/app/api/edit-board/history/route.ts GET
        this.writeJson(response, 200, {
          versions: this.versions,
          total: this.versions.length,
          hasMore: false,
        });
        return true;
      }
      if (method === "POST") {
        // src/app/api/edit-board/history/route.ts POST
        const id = `version-${this.versions.length + 2}`;
        this.writeJson(response, 200, { success: true, versionId: id });
        return true;
      }
    }

    const historyMatch = url.pathname.match(
      /^\/api\/edit-board\/history\/([^/]+)$/,
    );
    if (historyMatch && method === "POST") {
      // src/app/api/edit-board/history/[versionId]/route.ts POST
      const snapshotElementIds = new Set<string>(
        Object.values(FIXTURE_ELEMENT_IDS),
      );
      for (const row of this.content.filter((item) =>
        snapshotElementIds.has(item.element_id),
      )) {
        row.staging_content = row.original_content;
        row.current_content = row.original_content;
        row.staging_updated_at = FIXED_NOW;
      }
      const restoredVersion = this.versions.find(
        (version) => version.id === historyMatch[1],
      );
      this.writeJson(response, 200, {
        success: true,
        elementsRestored: restoredVersion?.elements_changed ?? 0,
      });
      return true;
    }

    if (url.pathname === "/api/edit-board/languages") {
      if (method === "GET") {
        // src/app/api/edit-board/languages/route.ts GET
        this.writeJson(response, 200, {
          languages: this.languages,
          availableLanguages: AVAILABLE_LANGUAGES,
        });
        return true;
      }
      if (method === "POST") {
        // src/app/api/edit-board/languages/route.ts POST
        const body = this.objectBody(json);
        const languageCode = this.stringField(body, "languageCode");
        const languageName =
          AVAILABLE_LANGUAGES.find(({ code }) => code === languageCode)?.name ||
          languageCode.toUpperCase();
        const language: FixtureLanguage = {
          id: `language-${languageCode}`,
          language_code: languageCode,
          language_name: languageName,
          is_default: false,
          translation_coverage: body.autoTranslate ? 100 : 0,
          last_translated_at: body.autoTranslate ? FIXED_NOW : null,
          created_at: FIXED_NOW,
        };
        if (
          !this.languages.some((item) => item.language_code === languageCode)
        ) {
          this.languages.push(language);
        }
        this.writeJson(response, 200, {
          success: true,
          language,
          autoTranslated: Boolean(body.autoTranslate),
          translatedCount: body.autoTranslate ? this.content.length : 0,
        });
        return true;
      }
    }

    if (url.pathname === "/api/upload/image" && method === "POST") {
      // src/app/api/upload/image/route.ts POST
      this.writeJson(response, 200, {
        url: this.replacementImageUrl,
        width: 320,
        height: 180,
      });
      return true;
    }

    if (
      url.pathname === `/api/ab-tests/active/${FIXTURE_SITE_ID}` &&
      method === "GET"
    ) {
      // src/app/api/ab-tests/active/[siteId]/route.ts GET
      this.writeJson(response, 200, { tests: [] });
      return true;
    }

    if (
      url.pathname === `/api/ab-tests/bucket/${FIXTURE_SITE_ID}` &&
      method === "GET"
    ) {
      // src/app/api/ab-tests/bucket/[siteId]/route.ts GET
      this.writeJson(response, 200, {
        assignments: {},
        geo: { country: null, region: null },
      });
      return true;
    }

    if (url.pathname === "/api/ab-tests/track" && method === "POST") {
      // src/app/api/ab-tests/track/route.ts POST
      const count = Array.isArray(json) ? json.length : json ? 1 : 0;
      this.writeJson(response, 200, { recorded: count, deduplicated: 0 });
      return true;
    }

    if (url.pathname === "/api/ai/suggest" && method === "POST") {
      // src/app/api/ai/suggest/route.ts POST
      const body = this.objectBody(json);
      this.writeJson(response, 200, {
        success: true,
        suggestions: ["Fixture suggestion"],
        tokensUsed: 0,
        originalText: this.stringField(body, "text"),
      });
      return true;
    }

    this.writeJson(response, 404, {
      error: `No fixture response for ${method} ${url.pathname}`,
    });
    return true;
  }

  private initialContent(): FixtureContentRow[] {
    const initialImage = `${this.hostOrigin}/fixture-image.svg`;
    return [
      this.makeRow(
        "content-heading",
        FIXTURE_ELEMENT_IDS.heading,
        FIXTURE_TEXT.heading,
        { type: "text" },
      ),
      this.makeRow(
        "content-copy",
        FIXTURE_ELEMENT_IDS.copy,
        FIXTURE_TEXT.copy,
        { type: "text" },
      ),
      this.makeRow("content-image", FIXTURE_ELEMENT_IDS.image, initialImage, {
        type: "image",
        alt: "Fixture landscape",
      }),
    ];
  }

  private makeRow(
    id: string,
    elementId: string,
    content: string,
    metadata: Record<string, unknown>,
  ): FixtureContentRow {
    return {
      id,
      site_id: FIXTURE_SITE_ID,
      element_id: elementId,
      selector: `[data-rcf-id="${elementId}"]`,
      original_content: content,
      current_content: content,
      published_content: content,
      staging_content: null,
      language: "en",
      variant: "default",
      metadata,
      published_at: FIXED_NOW,
      staging_updated_at: null,
      staging_updated_by: null,
    };
  }

  private liveRows(language: string): FixtureContentRow[] {
    return this.content
      .filter((row) => row.language === language)
      .map((row) => ({ ...row, current_content: row.published_content }));
  }

  private stagingRows(
    language: string,
  ): Array<FixtureContentRow & { has_staging_changes: boolean }> {
    return this.content
      .filter((row) => row.language === language)
      .map((row) => ({
        ...row,
        current_content: row.staging_content ?? row.published_content,
        has_staging_changes:
          row.staging_content !== null &&
          row.staging_content !== row.published_content,
      }));
  }

  private pendingRows(): FixtureContentRow[] {
    return this.content.filter(
      (row) =>
        row.staging_content !== null &&
        row.staging_content !== row.published_content,
    );
  }

  private findContent(
    elementId: string,
    language = "en",
  ): FixtureContentRow | undefined {
    return this.content.find(
      (row) =>
        row.element_id === elementId &&
        row.language === language &&
        row.variant === "default",
    );
  }

  private recordDiscoveredContent(value: unknown) {
    const body = this.objectBody(value);
    for (const [elementId, candidate] of Object.entries(body)) {
      if (this.findContent(elementId)) continue;
      const data = this.objectBody(candidate);
      const content = this.stringField(data, "content");
      if (!content) continue;
      this.content.push(
        this.makeRow(`content-${this.content.length + 1}`, elementId, content, {
          type: this.stringField(data, "type") || "text",
        }),
      );
    }
  }

  private objectBody(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private stringField(body: Record<string, unknown>, name: string): string {
    return typeof body[name] === "string" ? body[name] : "";
  }

  private writeEmpty(response: ServerResponse, status: number) {
    this.cors(response);
    response.writeHead(status);
    response.end();
  }

  private writeJson(response: ServerResponse, status: number, value: unknown) {
    const body = JSON.stringify(value);
    this.cors(response);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body).toString(),
    });
    response.end(body);
  }

  private cors(response: ServerResponse) {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader(
      "access-control-allow-headers",
      "Authorization, Content-Type, X-Site-Token, X-RCF-Editor-Grant",
    );
    response.setHeader(
      "access-control-allow-methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
  }
}
