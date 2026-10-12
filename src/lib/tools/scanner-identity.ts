/**
 * How the free tools' scanner names itself (s96): the User-Agent on every
 * request, and the robots.txt product token it obeys (RFC 9309 §2.2.1). The
 * user agent links to /tools, whose "About our scanner" says what it reads,
 * what is stored and how to opt out. Kept apart from the fetcher so static
 * pages can print it without importing node:http.
 */
export const SCANNER_PRODUCT_TOKEN = "RecopyFastToolsBot";

export const SCANNER_USER_AGENT = `${SCANNER_PRODUCT_TOKEN}/1.0 (+https://www.recopyfa.st/tools)`;
