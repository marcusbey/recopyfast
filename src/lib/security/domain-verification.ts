import { randomBytes } from "crypto";
import { assertSafeWebhookUrl } from "./webhook-url-safety";
import {
  fileDeclaresCode,
  generateDNSTXTRecord,
  generateFileVerificationContent,
} from "./domain-challenge";

export interface DomainVerification {
  id: string;
  siteId: string;
  domain: string;
  verificationMethod: "dns" | "file";
  verificationToken: string;
  verificationCode: string;
  isVerified: boolean;
  verifiedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DomainVerificationResult {
  success: boolean;
  error?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: any;
}

/*
 * TOMBSTONE — s68b M10. `isInternalIP` and `assertNoInternalResolution` lived
 * here: a hand-written denylist of the private ranges its author thought of,
 * resolved with resolve4/resolve6. It let `192.0.0.0/24`, `198.18.0.0/15` and
 * every other special-purpose range nobody enumerated straight through, beside
 * a second guard (`assertSafeWebhookUrl`, an `ipaddr.js` unicast allowlist) that
 * refuses whatever it has not heard of. File verification now calls that guard
 * on the exact URL it fetches. Do not bring a denylist back: two SSRF guards
 * drift, and the denylist is the one that drifts open.
 */

/**
 * Generate verification tokens and codes for domain verification
 */
export function generateVerificationTokens(): {
  token: string;
  code: string;
} {
  const token = randomBytes(32).toString("hex");
  const code = randomBytes(16).toString("hex");

  return { token, code };
}

/**
 * Create a new domain verification record
 */
export function createDomainVerification(
  siteId: string,
  domain: string,
  method: "dns" | "file",
): Omit<DomainVerification, "id" | "createdAt" | "updatedAt"> {
  const { token, code } = generateVerificationTokens();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  return {
    siteId,
    domain: normalizeDomain(domain),
    verificationMethod: method,
    verificationToken: token,
    verificationCode: code,
    isVerified: false,
    expiresAt,
  };
}

/**
 * Normalize domain format
 */
export function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .trim();
}

/**
 * Validate domain format
 */
export function validateDomain(domain: string): {
  isValid: boolean;
  error?: string;
} {
  const normalized = normalizeDomain(domain);

  // Basic domain validation regex
  const domainRegex =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

  if (!normalized) {
    return { isValid: false, error: "Domain cannot be empty" };
  }

  if (normalized.length > 253) {
    return { isValid: false, error: "Domain is too long" };
  }

  if (!domainRegex.test(normalized)) {
    return { isValid: false, error: "Invalid domain format" };
  }

  // Check for localhost and IP addresses (not allowed for verification)
  if (
    normalized === "localhost" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("192.168.") ||
    normalized.startsWith("10.") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(normalized)
  ) {
    return { isValid: false, error: "Cannot verify local or IP addresses" };
  }

  return { isValid: true };
}

// The challenge format and its matcher live in ./domain-challenge, which the
// dashboard can import — this module cannot be bundled for the browser (see
// `crypto` and `dns` above). Re-exported so server callers keep one import.
export {
  generateDNSTXTRecord,
  generateFileVerificationContent,
} from "./domain-challenge";

/**
 * Verify DNS TXT record
 */
export async function verifyDNSTXTRecord(
  domain: string,
  expectedCode: string,
): Promise<DomainVerificationResult> {
  try {
    // Import dns module dynamically to avoid issues in browser environment
    const dns = await import("dns").then((m) => m.promises);

    const records = await dns.resolveTxt(domain);
    const flatRecords = records.flat();

    const expectedRecord = generateDNSTXTRecord(expectedCode);
    const found = flatRecords.some((record) => record === expectedRecord);

    if (found) {
      return { success: true };
    } else {
      return {
        success: false,
        error: "DNS TXT record not found or incorrect",
        details: {
          expected: expectedRecord,
          found: flatRecords.filter((r) =>
            r.startsWith("recopyfast-verification="),
          ),
        },
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `DNS verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      details: error,
    };
  }
}

/**
 * Verify file on domain
 */
export async function verifyDomainFile(
  domain: string,
  verificationCode: string,
): Promise<DomainVerificationResult> {
  try {
    const { filename, content: expectedContent } =
      generateFileVerificationContent(verificationCode);
    const url = `https://${domain}/.well-known/${filename}`;

    // SSRF / DNS-rebinding guard, on the exact URL we are about to fetch: every
    // address the host resolves to must be globally routable unicast. Shared
    // with webhooks on purpose (s68b M10) — see the tombstone above.
    const safety = await assertSafeWebhookUrl(url);
    if (!safety.ok) {
      return {
        success: false,
        error: `${domain} must resolve only to a public internet address to be verified by file.`,
        details: { url },
      };
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "ReCopyFast-Verification/1.0",
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
      // s68b M10. The guard above vetted this host only. Following a redirect
      // let a domain the admin controls point our fetch anywhere, and the
      // `HTTP <status>: <statusText>` reply we used to give told them what
      // answered — a probe of internal hosts. A redirect is refused with a fixed message
      // that carries nothing from the upstream response.
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      return {
        success: false,
        error: "Verification file must be served without a redirect.",
        details: { url },
      };
    }

    // Review minor 4: this used to answer `HTTP <status>: <statusText>` (and
    // the status in `details`, which PUT /api/domains/verify returns). The
    // host can re-resolve between the guard and this fetch (DNS rebinding), so
    // that line reported what answered at an address of the admin's choosing.
    // Fixed message, nothing from the upstream status line.
    if (!response.ok) {
      return {
        success: false,
        error: "Verification file could not be fetched from the domain.",
        details: { url },
      };
    }

    const content = await response.text();
    const normalizedContent = content.trim();

    // Match on the CODE, not on byte equality with a regenerated body.
    //
    // The body carries a `Generated: <ISO timestamp>` line, and this function
    // used to rebuild it at check time and require an exact match — so the
    // expected value differed from the file the owner had downloaded by however
    // many milliseconds had passed. The hosted-file method could therefore
    // never succeed for anybody, and once the UI was mounted it became a
    // download button leading to a permanent "File content does not match
    // expected verification content".
    //
    // The code is the secret; the header and timestamp are decoration for the
    // human who opens the file. Matching the labelled line rather than the
    // whole body is also what makes this survive the things that really happen
    // to a hosted text file: a trailing newline added by an editor, CRLF from a
    // Windows checkout, or a static host that serves with different whitespace.
    // A blank code must never verify anything.
    //
    // An empty code collapses the URL to
    // /.well-known/recopyfast-verification-.txt, and the labelled line degrades
    // to a bare `Verification Code:` — so on any domain serving a catch-all 200
    // that happens to render that label the check would pass without the owner
    // having uploaded a thing. A missing column, a half-written row or a caller
    // passing "" was enough to mark a domain verified.
    //
    // Deliberately only an emptiness check, not a minimum length: codes are
    // generated as 32 hex characters, and inventing a length policy here would
    // silently refuse any shorter value already sitting in the table.
    if (verificationCode.trim().length === 0) {
      return {
        success: false,
        error: "Verification code is missing",
        details: { url },
      };
    }

    if (fileDeclaresCode(normalizedContent, verificationCode)) {
      return { success: true };
    } else {
      return {
        success: false,
        error: `File does not declare the verification code ${verificationCode}`,
        details: {
          url,
          expected: expectedContent.trim(),
          received: normalizedContent.substring(0, 200), // Limit to first 200 chars
        },
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `File verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      details: error,
    };
  }
}

/**
 * Perform domain verification
 */
export async function performDomainVerification(
  verification: DomainVerification,
): Promise<DomainVerificationResult> {
  // Check if verification has expired
  if (new Date() > verification.expiresAt) {
    return {
      success: false,
      error:
        "Verification has expired. Please generate a new verification token.",
    };
  }

  // Validate domain format
  const domainValidation = validateDomain(verification.domain);
  if (!domainValidation.isValid) {
    return {
      success: false,
      error: domainValidation.error,
    };
  }

  // Perform verification based on method
  switch (verification.verificationMethod) {
    case "dns":
      return await verifyDNSTXTRecord(
        verification.domain,
        verification.verificationCode,
      );

    case "file":
      return await verifyDomainFile(
        verification.domain,
        verification.verificationCode,
      );

    default:
      return {
        success: false,
        error: "Invalid verification method",
      };
  }
}

/**
 * Check if domain is in whitelist for embed script
 */
export function isDomainWhitelisted(
  domain: string,
  verifiedDomains: string[],
): boolean {
  const normalized = normalizeDomain(domain);
  return verifiedDomains.some((verifiedDomain) => {
    const normalizedVerified = normalizeDomain(verifiedDomain);
    return normalized === normalizedVerified;
  });
}

/**
 * Extract domain from URL or referrer
 */
export function extractDomainFromURL(url: string): string | null {
  try {
    const parsed = new URL(url);
    return normalizeDomain(parsed.hostname);
  } catch {
    return null;
  }
}

/**
 * Domain verification status checker
 */
export class DomainVerificationChecker {
  private verificationCache: Map<
    string,
    { result: DomainVerificationResult; timestamp: number }
  > = new Map();
  private cacheTimeout: number;

  constructor(cacheTimeoutMs = 5 * 60 * 1000) {
    // 5 minutes default
    this.cacheTimeout = cacheTimeoutMs;
  }

  async checkDomain(
    verification: DomainVerification,
    useCache = true,
  ): Promise<DomainVerificationResult> {
    const cacheKey = `${verification.domain}-${verification.verificationCode}`;

    if (useCache) {
      const cached = this.verificationCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.result;
      }
    }

    const result = await performDomainVerification(verification);

    // Cache the result
    this.verificationCache.set(cacheKey, {
      result,
      timestamp: Date.now(),
    });

    return result;
  }

  clearCache(domain?: string): void {
    if (domain) {
      const keysToDelete = Array.from(this.verificationCache.keys()).filter(
        (key) => key.startsWith(`${domain}-`),
      );
      keysToDelete.forEach((key) => this.verificationCache.delete(key));
    } else {
      this.verificationCache.clear();
    }
  }
}

// Export default instance
export const domainVerificationChecker = new DomainVerificationChecker();
