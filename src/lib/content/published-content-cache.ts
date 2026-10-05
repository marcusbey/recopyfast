import { createHash } from "node:crypto";
import { createClient, RESP_TYPES } from "redis";

export const PUBLIC_CONTENT_CACHE_FORMAT = "rcf-public-content-v1";
export const PUBLIC_CONTENT_CACHE_TTL_SECONDS = 300;
export const PUBLIC_CONTENT_CACHE_MAX_BYTES = 1024 * 1024;
const DEFAULT_READ_BUDGET_MS = 30;
const DEFAULT_WRITE_BUDGET_MS = 250;

export interface PublicContentCacheIdentity {
  siteId: string;
  revision: string;
  language: string;
  variant: string;
  pagePath: string | null;
}

export interface PublicContentRow {
  id: string | number;
  site_id: string;
  element_id: string;
  selector: string;
  published_content: string | null;
  original_content: string | null;
  current_content: string;
  language: string;
  variant: string;
  page_path: string | null;
  metadata: Record<string, unknown>;
  published_at: string | null;
}

interface CacheRedisClient {
  isOpen: boolean;
  isReady: boolean;
  connect(): Promise<unknown>;
  destroy(): void;
  on(event: "error", listener: () => void): unknown;
  getRange(key: string, start: number, end: number): Promise<Buffer | null>;
  set(
    key: string,
    value: string,
    options: { expiration: { type: "EX"; value: number } },
  ): Promise<string | null>;
}

interface PublishedContentCacheOptions {
  redisUrl?: string;
  createClient?: (redisUrl: string) => CacheRedisClient;
  readBudgetMs?: number;
  writeBudgetMs?: number;
}

type Connection = {
  client: CacheRedisClient;
  promise: Promise<void>;
};

class CacheTimeoutError extends Error {}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new CacheTimeoutError()), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameIdentity(
  value: unknown,
  expected: PublicContentCacheIdentity,
): boolean {
  if (!isRecord(value)) return false;
  return (
    value.siteId === expected.siteId &&
    value.revision === expected.revision &&
    value.language === expected.language &&
    value.variant === expected.variant &&
    value.pagePath === expected.pagePath
  );
}

const PRIVATE_ROW_FIELDS = new Set([
  "staging_content",
  "staging_updated_at",
  "published_by",
]);

function publicRow(
  value: unknown,
  identity: PublicContentCacheIdentity,
): PublicContentRow | null {
  if (!isRecord(value)) return null;
  if ([...PRIVATE_ROW_FIELDS].some((field) => field in value)) return null;
  if (
    (typeof value.id !== "string" && typeof value.id !== "number") ||
    value.site_id !== identity.siteId ||
    typeof value.element_id !== "string" ||
    typeof value.selector !== "string" ||
    (value.published_content !== null &&
      typeof value.published_content !== "string") ||
    (value.original_content !== null &&
      typeof value.original_content !== "string") ||
    typeof value.current_content !== "string" ||
    value.language !== identity.language ||
    value.variant !== identity.variant ||
    (value.page_path !== null && typeof value.page_path !== "string") ||
    (value.published_at !== null && typeof value.published_at !== "string") ||
    !isRecord(value.metadata) ||
    "staging_attributes" in value.metadata
  ) {
    return null;
  }
  if (
    identity.pagePath !== null &&
    value.page_path !== null &&
    value.page_path !== identity.pagePath
  ) {
    return null;
  }

  return {
    id: value.id,
    site_id: value.site_id,
    element_id: value.element_id,
    selector: value.selector,
    published_content: value.published_content,
    original_content: value.original_content,
    current_content: value.current_content,
    language: value.language,
    variant: value.variant,
    page_path: value.page_path,
    metadata: { ...value.metadata },
    published_at: value.published_at,
  };
}

function validateRows(
  value: unknown,
  identity: PublicContentCacheIdentity,
): PublicContentRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: PublicContentRow[] = [];
  for (const candidate of value) {
    const row = publicRow(candidate, identity);
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

function defaultCreateClient(redisUrl: string): CacheRedisClient {
  return createClient({
    url: redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: DEFAULT_WRITE_BUDGET_MS,
      reconnectStrategy: false,
    },
  }).withTypeMapping({
    [RESP_TYPES.BLOB_STRING]: Buffer,
  }) as unknown as CacheRedisClient;
}

export function isPublicContentCacheEnabled(): boolean {
  return process.env.PUBLIC_CONTENT_CACHE_ENABLED === "true";
}

export function buildPublicContentCacheKey(
  identity: PublicContentCacheIdentity,
): string {
  const tuple = [
    PUBLIC_CONTENT_CACHE_FORMAT,
    identity.siteId,
    identity.revision,
    identity.language,
    identity.variant,
    identity.pagePath,
  ];
  const digest = createHash("sha256")
    .update(JSON.stringify(tuple))
    .digest("hex");
  return `public_content:v1:${digest}`;
}

export class RedisPublishedContentCache {
  private readonly redisUrl?: string;
  private readonly createRedisClient: (redisUrl: string) => CacheRedisClient;
  private readonly readBudgetMs: number;
  private readonly writeBudgetMs: number;
  private client: CacheRedisClient | null = null;
  private connecting: Connection | null = null;

  constructor(options: PublishedContentCacheOptions = {}) {
    this.redisUrl = options.redisUrl ?? process.env.REDIS_URL;
    this.createRedisClient = options.createClient ?? defaultCreateClient;
    this.readBudgetMs = options.readBudgetMs ?? DEFAULT_READ_BUDGET_MS;
    this.writeBudgetMs = options.writeBudgetMs ?? DEFAULT_WRITE_BUDGET_MS;
  }

  private ensureClient(): CacheRedisClient | null {
    if (!this.redisUrl) return null;
    if (this.client) return this.client;
    const client = this.createRedisClient(this.redisUrl);
    client.on("error", () => {
      // Redis error objects may contain hostnames or connection strings. The
      // cache is optional, so a fixed marker is enough for operators and never
      // risks logging credentials or public copy.
      console.error("[public-content-cache] Redis client error");
    });
    this.client = client;
    return client;
  }

  private destroyIfCurrent(client: CacheRedisClient): void {
    if (this.client !== client) return;
    this.client = null;
    if (this.connecting?.client === client) this.connecting = null;
    try {
      client.destroy();
    } catch {
      // The client already closed itself.
    }
  }

  private connectionFor(client: CacheRedisClient): Promise<void> {
    if (client.isReady) return Promise.resolve();
    if (this.connecting?.client === client) return this.connecting.promise;

    const promise = client
      .connect()
      .then(() => undefined)
      .catch((error) => {
        this.destroyIfCurrent(client);
        throw error;
      })
      .finally(() => {
        if (this.connecting?.client === client) this.connecting = null;
      });
    this.connecting = { client, promise };
    return promise;
  }

  private async readyWithin(
    budgetMs: number,
  ): Promise<CacheRedisClient | null> {
    let client: CacheRedisClient | null;
    try {
      client = this.ensureClient();
    } catch {
      console.error("[public-content-cache] Redis client creation failed");
      return null;
    }
    if (!client) return null;
    if (client.isReady) return client;
    try {
      await withTimeout(this.connectionFor(client), budgetMs);
      return client.isReady ? client : null;
    } catch (error) {
      // A timeout deliberately leaves this exact connection attempt alive so
      // the deferred fill can warm it. A later replacement is protected by the
      // identity checks in connectionFor/destroyIfCurrent.
      if (!(error instanceof CacheTimeoutError)) {
        console.error("[public-content-cache] Redis connection failed");
      }
      return null;
    }
  }

  async read(
    identity: PublicContentCacheIdentity,
  ): Promise<PublicContentRow[] | null> {
    const startedAt = Date.now();
    const client = await this.readyWithin(this.readBudgetMs);
    if (!client) return null;
    const remaining = this.readBudgetMs - (Date.now() - startedAt);
    if (remaining <= 0) return null;

    let bytes: Buffer | null;
    try {
      bytes = await withTimeout(
        client.getRange(
          buildPublicContentCacheKey(identity),
          0,
          PUBLIC_CONTENT_CACHE_MAX_BYTES,
        ),
        remaining,
      );
    } catch (error) {
      if (!(error instanceof CacheTimeoutError)) {
        console.error("[public-content-cache] Redis read failed");
      }
      return null;
    }
    if (!bytes || bytes.length === 0) return null;
    if (bytes.length > PUBLIC_CONTENT_CACHE_MAX_BYTES) return null;

    try {
      const parsed: unknown = JSON.parse(bytes.toString("utf8"));
      if (!isRecord(parsed)) return null;
      if (parsed.format !== PUBLIC_CONTENT_CACHE_FORMAT) return null;
      if (!sameIdentity(parsed.identity, identity)) return null;
      return validateRows(parsed.rows, identity);
    } catch {
      return null;
    }
  }

  async write(
    identity: PublicContentCacheIdentity,
    inputRows: PublicContentRow[],
  ): Promise<boolean> {
    const rows = validateRows(inputRows, identity);
    if (!rows) return false;
    const serialized = JSON.stringify({
      format: PUBLIC_CONTENT_CACHE_FORMAT,
      identity,
      rows,
    });
    if (
      Buffer.byteLength(serialized, "utf8") > PUBLIC_CONTENT_CACHE_MAX_BYTES
    ) {
      return false;
    }

    const startedAt = Date.now();
    const client = await this.readyWithin(this.writeBudgetMs);
    if (!client) return false;
    const remaining = this.writeBudgetMs - (Date.now() - startedAt);
    if (remaining <= 0) return false;
    try {
      await withTimeout(
        client.set(buildPublicContentCacheKey(identity), serialized, {
          expiration: { type: "EX", value: PUBLIC_CONTENT_CACHE_TTL_SECONDS },
        }),
        remaining,
      );
      return true;
    } catch (error) {
      if (!(error instanceof CacheTimeoutError)) {
        console.error("[public-content-cache] Redis write failed");
      }
      return false;
    }
  }

  /** Explicit cleanup for owned tests/diagnostics; serverless callers reuse. */
  close(): void {
    if (this.client) this.destroyIfCurrent(this.client);
  }
}

export const publishedContentCache = new RedisPublishedContentCache();
