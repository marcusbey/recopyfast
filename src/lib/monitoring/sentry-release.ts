/**
 * The one Sentry release every runtime reports (s84).
 *
 * Before s84 each runtime picked its own: the browser read
 * NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA, which exists only when Vercel exposes
 * system variables to the bundle, and server and Edge read
 * VERCEL_GIT_COMMIT_SHA at runtime. When the browser's was missing it sent
 * `release: undefined` — and @sentry/nextjs spreads user options OVER its own
 * build-injected release (`build/cjs/client/index.js`), so that `undefined`
 * erased the value the SDK would have sent. Browser errors then matched no
 * release and no uploaded source map.
 *
 * Now: next.config.ts reads the build's commit SHA once, inlines it as
 * NEXT_PUBLIC_SENTRY_RELEASE for every runtime, and hands the same name to
 * `withSentryConfig` for the source-map upload. The inits spread
 * `releaseOption(process.env.NEXT_PUBLIC_SENTRY_RELEASE)` — written out
 * literally at each call site, which is what lets Next inline it.
 *
 * Imported by next.config.ts with a relative path: no `@/` imports here, and
 * nothing that needs the app runtime.
 */

/** The build's commit SHA, as Vercel provides it to every build. */
export function resolveBuildRelease(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  return sha ? sha : undefined;
}

/**
 * `{ release }` when there is one, `{}` otherwise — never `release: undefined`,
 * which would erase the SDK's own fallback.
 */
export function releaseOption(release: string | undefined): {
  release?: string;
} {
  return release ? { release } : {};
}
