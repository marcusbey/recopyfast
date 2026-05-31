import { randomBytes } from "crypto";
import { promises as dnsPromises } from "dns";

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

/**
 * Determine whether an IP address string falls within any range that must not
 * be reachable from the server (SSRF / DNS-rebinding mitigation).
 *
 * Blocked ranges:
 *   IPv4 loopback      127.0.0.0/8
 *   IPv4 link-local    169.254.0.0/16  (includes cloud metadata 169.254.169.254)
 *   IPv4 private       10.0.0.0/8
 *   IPv4 private       172.16.0.0/12
 *   IPv4 private       192.168.0.0/16
 *   IPv6 loopback      ::1
 *   IPv6 link-local    fe80::/10
 */
export function isInternalIP(ip: string): boolean {
  // ── IPv6 ─────────────────────────────────────────────────────────────────
  if (ip.includes(":")) {
    const normalized = ip.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

    // Loopback ::1
    if (normalized === "::1") return true;

    // Link-local fe80::/10  (first 10 bits = 1111 1110 10)
    // Covers fe80:: through febf::
    if (/^fe[89ab][0-9a-f]:/i.test(normalized)) return true;

    return false;
  }

  // ── IPv4 ─────────────────────────────────────────────────────────────────
  const parts = ip.split(".");
  if (parts.length !== 4) return false;

  const [a, b] = parts.map(Number);
  if (parts.some((p) => isNaN(Number(p)) || Number(p) < 0 || Number(p) > 255))
    return false;

  // 127.0.0.0/8  — loopback
  if (a === 127) return true;

  // 169.254.0.0/16 — link-local / cloud metadata (169.254.169.254)
  if (a === 169 && b === 254) return true;

  // 10.0.0.0/8 — private
  if (a === 10) return true;

  // 172.16.0.0/12 — private (172.16.x.x – 172.31.x.x)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true;

  return false;
}

/**
 * Resolve all IP addresses for a hostname (A + AAAA records) and throw an
 * error if any of them fall within an internal/private range.  This prevents
 * DNS-rebinding attacks where an attacker controls DNS to return an internal
 * address after the format validation has already passed.
 *
 * Must be called after `validateDomain` and before any outgoing fetch.
 */
export async function assertNoInternalResolution(
  hostname: string,
): Promise<void> {
  let addresses: string[];

  try {
    // resolve4 / resolve6 each throw when no record of that type exists, so
    // we attempt both and union the results, swallowing ENODATA / ENOTFOUND
    // per-family errors.
    const [v4, v6] = await Promise.allSettled([
      dnsPromises.resolve4(hostname),
      dnsPromises.resolve6(hostname),
    ]);

    addresses = [
      ...(v4.status === "fulfilled" ? v4.value : []),
      ...(v6.status === "fulfilled" ? v6.value : []),
    ];
  } catch {
    // If DNS lookup fails entirely we surface a generic error so callers can
    // return a clean failure rather than proceeding to fetch.
    throw new Error(`DNS resolution failed for domain: ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new Error(`No DNS records found for domain: ${hostname}`);
  }

  for (const addr of addresses) {
    if (isInternalIP(addr)) {
      throw new Error(
        `Domain resolves to a private/internal IP address (${addr}), which is not allowed`,
      );
    }
  }
}

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

/**
 * Generate DNS TXT record content for verification
 */
export function generateDNSTXTRecord(verificationCode: string): string {
  return `recopyfast-verification=${verificationCode}`;
}

/**
 * Generate file verification content
 */
export function generateFileVerificationContent(verificationCode: string): {
  filename: string;
  content: string;
} {
  return {
    filename: `recopyfast-verification-${verificationCode}.txt`,
    content: `ReCopyFast Domain Verification\nVerification Code: ${verificationCode}\nGenerated: ${new Date().toISOString()}`,
  };
}

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

    // SSRF / DNS-rebinding guard: resolve the domain and reject any address
    // that falls within a private, loopback, link-local, or cloud-metadata
    // range before we issue the outgoing fetch request.
    await assertNoInternalResolution(domain);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "ReCopyFast-Verification/1.0",
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        details: { url, status: response.status },
      };
    }

    const content = await response.text();
    const normalizedContent = content.trim();
    const normalizedExpected = expectedContent.trim();

    if (normalizedContent === normalizedExpected) {
      return { success: true };
    } else {
      return {
        success: false,
        error: "File content does not match expected verification content",
        details: {
          url,
          expected: normalizedExpected,
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
