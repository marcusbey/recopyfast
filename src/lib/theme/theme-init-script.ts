/**
 * The one inline script this app writes itself: it applies the stored theme
 * before first paint, so the page does not render in the OS theme and then
 * snap to the user's choice on hydration. `src/app/layout.tsx` renders it in
 * `<head>`, synchronous, before the body.
 *
 * It lives here rather than inline in the layout because the Content Security
 * Policy allows it by its SHA-256 (s79, ADR 059): Next stamps the per-request
 * nonce on its own scripts, never on one we render, so on the app surface this
 * script runs only because `src/lib/security/content-security-policy.ts`
 * hashes this exact string. One constant, rendered and hashed, cannot drift;
 * an edit here changes both at once.
 *
 * The key must stay `THEME_STORAGE_KEY` (`src/hooks/useTheme.ts`). It is
 * written out rather than imported: that module is `"use client"`, and a
 * server component importing from it receives a client reference, not the
 * string. `content-security-policy.test.ts` pins the two together.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("recopyfast-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}})();`;
