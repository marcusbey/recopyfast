import { randomBytes } from 'crypto';

export interface DomainVerification {
  id: string;
  siteId: string;
  domain: string;
  verificationMethod: 'dns' | 'file';
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
 * Generate verification tokens and codes for domain verification
 */
export function generateVerificationTokens(): {
  token: string;
  code: string;
} {
  const token = randomBytes(32).toString('hex');
  const code = randomBytes(16).toString('hex');
  
  return { token, code };
}

/**
 * Create a new domain verification record
 */
export function createDomainVerification(
  siteId: string,
  domain: string,
  method: 'dns' | 'file'
): Omit<DomainVerification, 'id' | 'createdAt' | 'updatedAt'> {
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
    expiresAt
  };
}

/**
 * Normalize domain format
 */
export function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
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
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  if (!normalized) {
    return { isValid: false, error: 'Domain cannot be empty' };
  }
  
  if (normalized.length > 253) {
    return { isValid: false, error: 'Domain is too long' };
  }
  
  if (!domainRegex.test(normalized)) {
    return { isValid: false, error: 'Invalid domain format' };
  }
  
  // Check for localhost and IP addresses (not allowed for verification)
  if (normalized === 'localhost' || normalized.startsWith('127.') || 
      normalized.startsWith('192.168.') || normalized.startsWith('10.') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(normalized)) {
    return { isValid: false, error: 'Cannot verify local or IP addresses' };
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
    content: `ReCopyFast Domain Verification\nVerification Code: ${verificationCode}\nGenerated: ${new Date().toISOString()}`
  };
}

/**
 * Verify DNS TXT record
 */
export async function verifyDNSTXTRecord(
  domain: string,
  expectedCode: string
): Promise<DomainVerificationResult> {
  try {
    // Import dns module dynamically to avoid issues in browser environment
    const dns = await import('dns').then(m => m.promises);
    
    const records = await dns.resolveTxt(domain);
    const flatRecords = records.flat();
    
    const expectedRecord = generateDNSTXTRecord(expectedCode);
    const found = flatRecords.some(record => record === expectedRecord);
    
    if (found) {
      return { success: true };
    } else {
      return {
        success: false,
        error: 'DNS TXT record not found or incorrect',
        details: {
          expected: expectedRecord,
          found: flatRecords.filter(r => r.startsWith('recopyfast-verification='))
        }
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `DNS verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      details: error
    };
  }
}

/**
 * Verify file on domain
 */
export async function verifyDomainFile(
  domain: string,
  verificationCode: string
): Promise<DomainVerificationResult> {
  try {
    const { filename, content: expectedContent } = generateFileVerificationContent(verificationCode);
    const url = `https://${domain}/.well-known/${filename}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'ReCopyFast-Verification/1.0'
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    
    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        details: { url, status: response.status }
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
        error: 'File content does not match expected verification content',
        details: {
          url,
          expected: normalizedExpected,
          received: normalizedContent.substring(0, 200) // Limit to first 200 chars
        }
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `File verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      details: error
    };
  }
}

/**
 * Perform domain verification
 */
export async function performDomainVerification(
  verification: DomainVerification
): Promise<DomainVerificationResult> {
  // Check if verification has expired
  if (new Date() > verification.expiresAt) {
    return {
      success: false,
      error: 'Verification has expired. Please generate a new verification token.'
    };
  }
  
  // Validate domain format
  const domainValidation = validateDomain(verification.domain);
  if (!domainValidation.isValid) {
    return {
      success: false,
      error: domainValidation.error
    };
  }
  
  // Perform verification based on method
  switch (verification.verificationMethod) {
    case 'dns':
      return await verifyDNSTXTRecord(verification.domain, verification.verificationCode);
    
    case 'file':
      return await verifyDomainFile(verification.domain, verification.verificationCode);
    
    default:
      return {
        success: false,
        error: 'Invalid verification method'
      };
  }
}

/**
 * Check if domain is in whitelist for embed script
 */
export function isDomainWhitelisted(domain: string, verifiedDomains: string[]): boolean {
  const normalized = normalizeDomain(domain);
  return verifiedDomains.some(verifiedDomain => {
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
  private verificationCache: Map<string, { result: DomainVerificationResult; timestamp: number }> = new Map();
  private cacheTimeout: number;

  constructor(cacheTimeoutMs = 5 * 60 * 1000) { // 5 minutes default
    this.cacheTimeout = cacheTimeoutMs;
  }

  async checkDomain(verification: DomainVerification, useCache = true): Promise<DomainVerificationResult> {
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
      timestamp: Date.now()
    });

    return result;
  }

  clearCache(domain?: string): void {
    if (domain) {
      const keysToDelete = Array.from(this.verificationCache.keys())
        .filter(key => key.startsWith(`${domain}-`));
      keysToDelete.forEach(key => this.verificationCache.delete(key));
    } else {
      this.verificationCache.clear();
    }
  }
}

// Export default instance
export const domainVerificationChecker = new DomainVerificationChecker();