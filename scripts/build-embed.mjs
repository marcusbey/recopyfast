#!/usr/bin/env node
/**
 * Builds the embeddable widget that customer sites load.
 *
 * Why this exists: the widget used to pull socket.io from cdn.socket.io at
 * runtime, which any site serving `script-src 'self'` blocks outright — real-time
 * editing simply died. socket.io-client is now compiled in from node_modules so
 * everything the widget needs is served from our own origin.
 *
 * Layout:
 *   public/embed/recopyfast.src.js         source of truth, readable, hand-edited
 *   public/embed/recopyfast.js             build output — what customers load
 *   public/embed/socket.io-client.min.js   standalone socket.io: the size gate's
 *                                          measure of the transport, and a pinned
 *                                          public URL (middleware-matcher.test.ts).
 *                                          The widget no longer loads it (s67).
 *
 * The source keeps the `.src.js` suffix so the artifact can own the public
 * `/embed/recopyfast.js` URL that is already baked into every issued embed
 * snippet. Editing recopyfast.js by hand is a mistake: it is overwritten here.
 *
 * Usage:
 *   node scripts/build-embed.mjs            build
 *   node scripts/build-embed.mjs --check    fail if the artifact is stale (CI)
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EMBED_DIR = path.join(ROOT, "public", "embed");

const SOURCE = path.join(EMBED_DIR, "recopyfast.src.js");
const BUNDLE_OUT = path.join(EMBED_DIR, "recopyfast.js");
const SOCKET_OUT = path.join(EMBED_DIR, "socket.io-client.min.js");

/**
 * The editing rules (colour parsing, backdrop resolution, contrast, geometry)
 * are shared with the app rather than reimplemented here. This file is compiled
 * and spliced into the widget between the inject markers below, so the widget
 * and `src/lib/editingRules.ts` can never disagree about what "readable" means.
 */
const RULES_SOURCE = path.join(ROOT, "src", "lib", "editingRules.core.ts");
const RULES_GLOBAL = "__rcfRules";
const INJECT_BEGIN = "// @rcf-inject:editing-rules";
const INJECT_END = "// @rcf-inject-end";

/**
 * Namespaced on purpose. Dropping socket.io onto `window.io` would clobber a
 * customer's own socket.io, and inheriting theirs would silently mix versions.
 */
const SOCKET_GLOBAL = "__recopyfastSocketIO";

const STALE_MARKER = "// @generated-from-sha256 ";

/**
 * The byte ceilings, in gzipped bytes, measured by `gzipSize` below.
 *
 * They are seeded at what the artifact measures TODAY (2026-08-16), not at the
 * 30,000-byte budget the product is supposed to hit. That is deliberate: the
 * budget is breached by 16,875 bytes right now, so a ceiling seeded at 30,000
 * would make `npm run build` red on the very first run of this gate, and a gate
 * that is red before anyone has changed anything gets switched off within a day.
 * Seeding at today's size makes the gate mean "no worse than this", which is the
 * only thing it can honestly mean until the widget is shrunk.
 *
 * They ratchet DOWNWARD only. Every story that removes bytes lowers the number
 * it earned; nothing ever raises it. **Raising either constant is a defect, not
 * a fix.** If a change pushes the artifact over the ceiling, the change is too
 * expensive — that is the finding, and the answer is to make the change smaller,
 * not to make the ceiling bigger. `src/__tests__/embed/build-size-gate.test.ts`
 * asserts both constants stay at or below these seeds, so a commit that raises
 * one fails the suite rather than quietly widening the budget.
 *
 * The per-story byte allowances live in docs/stories.md § Byte budget and
 * nowhere else. Do not restate a budget here.
 *
 * WHY 46875 AND NOT THE 46,781 THE DOCS QUOTE. Two compressors are in play and
 * they disagree on the same bytes. The figures written down in docs/stories.md,
 * docs/architecture.md and ADR 004 — 46,781 for the artifact and 13,085 for
 * socket.io — come from GNU `gzip -9c`. The gate uses Node's `zlib.gzipSync` at
 * level 9, which returns 46,875 and 13,141 for those identical files. Neither is
 * wrong; they are different implementations of the same format. The gate is
 * in-process because a subprocess would inherit whatever gzip the machine
 * happens to ship, and a ceiling that moves with the machine is not a ceiling.
 * The consequence, and the reason this note exists: seeding MAX_BUNDLE_GZ from
 * the documented 46,781 would put the build 94 bytes over its own ceiling on the
 * first run. Never compare a `gzip -9c` figure with one of these; re-measure.
 */
/*
 * RE-SEEDED 2026-08-17, from 46875 / 34063. This is the one legitimate reason to
 * raise these numbers, and it is not "the build failed".
 *
 * Both constants were seeded from `main`'s artifact at the moment this gate was
 * written, with zero headroom by construction. `main` then moved underneath the
 * unmerged branch: ADR 023 pinned the embed to `transports: ['websocket']`, which
 * removed socket.io's polling fallback because a polling handshake is stateful and
 * cannot survive being split across processes.
 *
 * That one line costs +19 gz on the bundle and +18 on the widget, and the numbers
 * below are the re-measurement, not an allowance. The delta is itemised precisely so
 * that a future reader can tell this apart from someone widening the budget to make
 * a build pass — which the note above rightly calls a defect.
 *
 * The rule stands unchanged: raise these ONLY when `main` itself has legitimately
 * moved, and only to the newly measured value, with the cause named. If your branch
 * is over, the branch is over. `s06c-embed-shrink` is the story that creates room.
 */
/*
 * RATCHETED DOWN 2026-09-25 (s39-editor-back-to-sites), from 46681 / 33865.
 *
 * s39 needed a control in the editor bar with 5 gz bytes of widget headroom, so it
 * paid for it in the same branch, and the ceiling keeps the difference:
 *
 *   46681 / 33865  ceilings before s39
 *   46635 / 33860  measured on main at 0b8014f, where s39 branched
 *   −465 / −452    CSS comments out of strings: twelve comments inside the widget's
 *                  `style.textContent` template literals shipped as string bytes on
 *                  every customer page; they are JS comments above each literal now
 *                  (esbuild strips those). No CSS rule changed.
 *   +56 / +57      All sites control: the editor bar's way back to /edit
 *   46226 / 33465  measured on the branch — the new ceilings
 *
 * build-size-gate.test.ts pins the same pair, so the freed bytes cannot be handed
 * back by restoring the old constants.
 */
/*
 * RATCHETED DOWN 2026-09-25 (s40-ai-widget-auth), from 46226 / 33465.
 *
 * s40 made the AI modal work for editors, with zero headroom after s39, so it paid
 * for that in the same branch by deleting an unmetered AI control:
 *
 *   46226 / 33465  ceilings before s40 = measured on main at 0e1d5bc (s39 merged)
 *   +26 / +28      AI fetch carries editor credentials + server message: the
 *                  `/ai/suggest` request sends `siteId`, `editorAuthHeaders()` and
 *                  `editorTokenBody()` instead of the site token, and the modal
 *                  shows the server's refusal sentence. Alone, over both ceilings.
 *   −71 / −67      Edit Board auto-translate control removed: the "Auto-translate
 *                  with AI" checkbox made POST /edit-board/languages run one
 *                  unmetered OpenAI call per element into a column nothing reads.
 *   46176 / 33420  measured on the branch — the new ceilings
 *
 * (At 0b8014f, before s39, the same two changes measured +24/+27 and −77/−69:
 * gzip deltas move with the surrounding bytes, so only this branch's own
 * measurement is recorded as the ceiling.) build-size-gate.test.ts pins the same
 * pair.
 */
/*
 * RATCHETED DOWN 2026-09-25 (s41-edit-link-multipage), from 46176 / 33420 (s40).
 *
 * s41 keeps an edit link alive across page loads (ADR 036) and paid first by
 * deleting dead code. Measured on its own base (0e1d5bc) it was −288 / −282;
 * merged over s40 the same changes measure −293 / −298 (gzip context moves):
 *
 *   −398 / −394  dead email-capture modal and its `requiresEmail` branch (no
 *                server path has sent `requiresEmail: true` since 747d210;
 *                staging-access.device-binding.test.ts pins that)
 *   −24 / −22    `escapeHtml`: no caller
 *   +116 / +121  edit-link persistence in sessionStorage, the two 401/403
 *                clears, Preview Live's `noopener`
 *   −8 / −11     Preview Live's two no-op searchParams.delete calls
 *   +26 / +24    editor bar: claim and divider hide at ≤480px (operator T5b)
 *   45883 / 33122  measured on the merged tree — the new ceilings
 *
 * build-size-gate.test.ts pins the same pair.
 */
/*
 * RATCHETED DOWN 2026-09-28 (s55-no-visitor-cookie-by-default), from 45883 / 33122.
 *
 *   45883 / 33122  ceilings before s55 = measured on main at b05666d, where s55 branched
 *   −3 / −2        rcf_vid minted in bucketVisitor behind the active-test guard,
 *                  initVisitorId idempotent, the init-time call removed
 *   45880 / 33120  measured on the branch — the new ceilings
 *
 * build-size-gate.test.ts pins the same pair.
 */
/*
 * RATCHETED DOWN 2026-10-08 (s67-embed-spa-support), from 45880 / 33120.
 *
 * SPA support had an allocation of ≤ +850 gross on each measurement and net ≤ 0
 * (docs/stories.md § Byte budget), with 0 bytes of headroom, so it paid in the
 * branch. Deltas measured in sequence on the branch (gzip deltas do not add
 * exactly; each line is the step's own measurement):
 *
 *   45880 / 33120  ceilings before s67 = measured on main at 659778e
 *   −805 / −838    funding: the CSS inside the five style literals minified at
 *                  build time (minifyStyleLiterals above — this pre-empts part
 *                  of s06c-embed-shrink, which must not count it again); the
 *                  unreachable socket.io fallback loader and its factory helper
 *                  deleted; the unread `rcf-editable` class deleted
 *   +8 / +13       M8: startup endpoints cannot be clobbered
 *   +99 / +103     in-place text writes (the React NotFoundError crash)
 *   +119 / +126    per-path rows cache, edited rows only, variant precedence
 *   +557 / +557    early bounded observer, write cap, rescans that skip mapped
 *                  nodes and prune detached ones, shadow roots, one instance
 *                  per page, destroy(), route change without patching,
 *                  authored restore, discovery gating and coalescing (the old
 *                  discovery fingerprint folded into the known-id claims)
 *   +55 / +58      edit mode: saves and realtime updates refresh the cached row
 *   −40 / −40      second-line reserve: the uncalled assessReadability method
 *                  and the getEditingColors wrapper
 *   −7 / −7        rows/index left unset in the constructor
 *   45866 / 33092  measured on the branch at 05d2025 — the ceilings until the
 *                  review fix
 *   +8 / +7        review fix (docs/reviews/s67-embed-spa-support.md, findings
 *                  1, 4, 5, 6): a text-only route render schedules the debounced
 *                  rescan, the route-change row load is caught, editor saves
 *                  record `written` and keep `originalContent`, the Edit Board
 *                  preview reads getElementText
 *   −14 / −10      funded in the branch, no behaviour change: the `self`
 *                  closures in checkRoute, applyRows and the discovery report
 *                  timer written as arrows, the observer's immediate rescan as
 *                  `return self.rescan()`
 *   45860 / 33089  measured after the review fix — the ceilings until the
 *                  re-review fix
 *   +22 / +21      re-review fix (docs/reviews/s67-embed-spa-support.md,
 *                  finding A, minor 1): the Navigation API handler hands the
 *                  host's pending records to the observer callback, then
 *                  discards the embed's own restores; an empty batch schedules
 *                  no rescan; the form save records the field's value
 *   −30 / −29      funded in the branch, inside s67's own code, no behaviour
 *                  change: one stamp lookup per scanned element instead of
 *                  two, the row index built with for...of, the observer
 *                  created and attached in one expression, loadRows' apply
 *                  closure as an arrow, applyRow's empty-copy check reordered,
 *                  writeText's walker advanced in one place, destroy clearing
 *                  the polling interval with clearTimeout
 *   45852 / 33081  measured after the re-review fix — the ceilings until the
 *                  verification fix
 *   +13 / +14      verification fix (docs/reviews/s67-embed-spa-support.md,
 *                  finding B): the Navigation API's path check runs in the
 *                  microtask after the navigation, through the observer
 *                  callback, then discards the embed's own writes; a destroy()
 *                  in the same task cancels it
 *   −22 / −22      funded in the branch, inside s67's own code, no behaviour
 *                  change: writeText finds the element's first direct text
 *                  node during its text-node walk instead of a sibling scan
 *                  before it
 *   45843 / 33073  measured after the verification fix — the ceilings until
 *                  the PR #69 review fix
 *   +2 / +5        PR #69 review fix (docs/reviews/s67-embed-spa-support.md,
 *                  D2, D3): a route change drops the A/B markers with the
 *                  entry, applyVariants writes through applyContentToElement,
 *                  the row index is Object.create(null). D1 (nested edits,
 *                  +89 / +89 measured) is deferred to s67b
 *   −4 / −5        funded in the branch, inside s67's own code, no behaviour
 *                  change: dropEntry reads data.element once, loadRows' cache
 *                  closure as an arrow
 *   45841 / 33073  measured after the PR #69 review fix — the new ceilings
 *
 * Gross against a funded floor (main with every deletion above and none of the
 * SPA work, measured 45037 / 32248): +804 / +825, final, review, re-review,
 * verification and PR #69 review fixes included. Every funding line since the
 * review is s67 code, so the floor does not move. build-size-gate.test.ts pins
 * the same pair and quotes the same gross.
 */
/*
 * RATCHETED DOWN 2026-10-08 (s70a-embed-ui-not-content), from 45841 / 33073.
 *
 * The embed recorded its own Edit Board, AI suggestions modal and form-field
 * popover as site copy, the editor's "by <email>" included
 * (docs/research/s70-content-changes.md, fact 1). The fix is byte-negative,
 * measured in sequence on the branch:
 *
 *   45841 / 33073  ceilings before s70a = measured on main at 828970c, where
 *                  s70a branched (its base adds docs only)
 *   +6 / +7        two markers (`data-rcf-ignore` on the AI suggestions overlay
 *                  and on the form-field popover) and the corrected id
 *                  (`#rcf-edit-board-panel`), the six skip checks kept
 *   −7 / −7        one `closest()` for the six skip checks, no behaviour change
 *   45840 / 33073  measured on the branch — the new ceilings
 *
 * The two middle lines are not exact to the byte, and no split of them is.
 * The artifact's banner carries the sha256 of the source, so any source edit,
 * a comment included, changes 64 hex characters that gzip packs differently:
 * three comment-only edits of this source measured −2 to +2 (bundle) and 0 to
 * +2 (widget) at the s70a review. The same intermediate tree measured +5 / +7
 * without the branch's comments; the review measured +6 / +8 then −7 / −8, and
 * research −7 / −8 for the consolidation on a copy of the tree. Only the two
 * ends are measurements of shipped bytes. With no headroom, a comment-only
 * edit can fail this gate: one tried in the s70a review fix pass, above
 * shouldSkipElement, measured 45840 / 33074 and was not shipped.
 * build-size-gate.test.ts pins the same pair.
 */
/*
 * RATCHETED DOWN 2026-10-09 (s72-edit-board-history-xss), from 45840 / 33073.
 *
 * The Edit Board's History tab ran a version's author as markup on the
 * customer's origin (s70a review F1). Text, never markup, for anything a
 * response carries — and the fix is byte-negative, measured in sequence on the
 * branch:
 *
 *   45840 / 33073  ceilings before s72 = measured on main at 59d0596, where
 *                  s72 rebased (s70a merged)
 *   −6 / −4        the History meta line as a text node (the date) and one
 *                  span ("by …", textContent), instead of innerHTML
 *   −6 / −5        the restore lines: the refusal as text in an empty div (R1)
 *                  and "Version restored" for the RPC's boolean (R2), together.
 *                  R1 alone measured +6 / +6 — over the widget ceiling — and
 *                  is only shippable with R2
 *   0 / −2         the "THE RULE" comment names the container hint (s70a
 *                  review F4(a)); a comment moves the banner hash only
 *   45828 / 33062  measured on the branch — the new ceilings
 *
 * As s70a's block says: the artifact's banner carries the source's sha256, so
 * every source edit moves gzip by up to ±2 B, and the three middle lines carry
 * that noise. Research measured 45828–45829 / 33062–33064 for the whole edit
 * across eight comment salts. Only the two ends are measurements of shipped
 * bytes. build-size-gate.test.ts pins the same pair.
 */
/*
 * RATCHETED DOWN 2026-10-09 (s76-grant-and-edit-token-hardening), from
 * 45828 / 33062.
 *
 * The owner's "Edit website" link stopped carrying the edit session in its
 * query string (A-29, ADR 055): it lands as `#rcf_edit=<code>`, a 60-second,
 * single-use code the widget sends to its boot check, which answers the
 * session's token. Zero headroom on main, so the story paid in this file,
 * measured on prototypes in sequence (research table):
 *
 *   45828 / 33062  ceilings before s76 = measured on main at 72f4cff
 *   +50 / +56      the code in the edit-token slot: read from the fragment,
 *                  stripped from the address bar, swapped for the answered
 *                  token in memory and storage (a dedicated redeem request
 *                  measured +88 / +79 and was not built)
 *   −5 / −16       one keepEditLink() for parse time and the swap
 *   −18 / −16      `kind: result.kind` — the server sends it with every valid
 *                  answer, so the client-side fallback was dead
 *   −4 / −3        no `rememberDevice` in the refresh body — the server reads
 *                  the lineage and ignores it (A-28)
 *   −10 / −8       init() tests `this.stagingMode` alone; it implies a token
 *   −4 / −5        no `|| null` on the new read; `location.hash`
 *   −12 / −12      `|| undefined` dropped from the boot check's body and
 *                  `editorTokenBody()` (servers read strings only), and a
 *                  destructured restore
 *   +2 / +1        the story's tombstone comments (banner hash only; the
 *                  lines above were measured without them, 45825 / 33058)
 *   45827 / 33059  measured on the branch — the new ceilings
 *
 * Only the two ends are measurements of shipped bytes: every source edit moves
 * the banner hash, and with it gzip, by up to ±2 B, so the middle lines (each
 * a prototype run) carry that noise. build-size-gate.test.ts pins the same pair.
 *
 * RATCHETED DOWN again in the s76 review fix pass, from 45827 / 33059:
 *
 *   45827 / 33059  the s76 ceilings above, re-measured after the rebase on
 *                  main at fc5968b (s73 changed no embed byte)
 *   +13 / +15      a legacy `?rcf_edit_token=` is stripped from the address
 *                  bar, tested for presence and never read (review minor 4)
 *   −27 / −22      offsets: `window.` dropped from globals that always exist —
 *                  `location` ×11, `open` ×2, `addEventListener` ×3,
 *                  `removeEventListener`, `sessionStorage` ×2,
 *                  `localStorage`, `history` — and `urlParams + ''` for
 *                  `.toString()` with the one-use `cleanUrl` inlined
 *   45813 / 33052  measured on the branch — the new ceilings
 *
 * CORRECTED in the s76 review fix pass 2, 45813 / 33052 → 45818 / 33059. Up
 * from fix pass 1's pair, which never reached main; still DOWN from main's
 * 45828 / 33062, the last ceilings that shipped. Fix pass 1's offset was a
 * defect (review major): a bare `open` / `history` / `addEventListener` /
 * `removeEventListener` / `localStorage` / `sessionStorage` resolves to a
 * host page's own top-level `let`/`const` first, and the TypeError lands in
 * the host page (non-negotiable #4, host-page-globals.test.ts).
 *
 *   45813 / 33052  fix pass 1 (branch only)
 *   +10 / +12      `window.` on every use of those names: `open` ×2,
 *                  `history` ×3, `addEventListener` ×3, `removeEventListener`,
 *                  `localStorage`, `sessionStorage` ×5 — five of them (the
 *                  parse-time strip's `history` ×2, the edit link's
 *                  `sessionStorage` ×3) were bare on main too — and the
 *                  tombstone saying why
 *   −5 / −5        `864e5` for the two `24 * 60 * 60 * 1000` products, which
 *                  esbuild keeps as `1440*60*1e3`
 *   45818 / 33059  measured on the branch — the new ceilings
 *
 * `location` ×11 stays bare: it is unforgeable, so a page's top-level
 * `let`/`const`/`class location` is a SyntaxError and `var location` binds
 * nothing new (measured in Chromium 145 and WebKit 26). Tried and rejected,
 * each larger: the scroll listener on the editor's AbortSignal (+6 / +5), a
 * local for `window.visualViewport` (+16 / +10), one storage helper for the
 * auth client (+9 / +5), one captured sessionStorage (+0 / +1). The middle
 * lines carry the banner hash's ±2 B; only the two ends are measurements.
 */
const MAX_BUNDLE_GZ = 45818;
const MAX_WIDGET_GZ = 33059;

/**
 * Lets a caller TIGHTEN a ceiling for one run. It can never loosen one.
 *
 * The gate's refusal path is the half that has to work, and provoking it
 * honestly would mean committing a deliberately oversized 47KB fixture and
 * regenerating it every time the widget changes. Instead the test suite tightens
 * the ceiling under the real artifact and watches the build refuse.
 *
 * A value at or above the constant is ignored, with a warning. That asymmetry is
 * the whole safety argument: an override that can only tighten cannot be used —
 * by a CI config, a shell profile, or an agent in a hurry — to get an oversized
 * widget past the gate. If it could raise the ceiling, it would be the ceiling.
 */
const CEILING_OVERRIDE_ENV = "RCF_EMBED_CEILING_OVERRIDE";

async function loadEsbuild() {
  try {
    return await import("esbuild");
  } catch {
    throw new Error(
      "esbuild is required to build the embed script.\n" +
        "  npm install --save-dev esbuild@^0.25.9",
    );
  }
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function socketIoClientVersion() {
  const require = createRequire(import.meta.url);
  return require("socket.io-client/package.json").version;
}

/** socket.io-client compiled to a classic script exposing a namespaced global. */
async function buildSocketIo(esbuild) {
  const result = await esbuild.build({
    stdin: {
      contents: `import { io } from "socket.io-client";\nwindow.${SOCKET_GLOBAL} = { io };\n`,
      resolveDir: ROOT,
      loader: "js",
    },
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2018"],
    platform: "browser",
    legalComments: "none",
    write: false,
  });

  return result.outputFiles[0].text;
}

/**
 * The shared editing rules, compiled from TypeScript to an IIFE that assigns to
 * a local `var` rather than a global — it is spliced inside the widget's own
 * IIFE, so nothing reaches the customer's `window`.
 */
async function buildRules(esbuild) {
  const result = await esbuild.build({
    entryPoints: [RULES_SOURCE],
    bundle: true,
    minify: true,
    format: "iife",
    globalName: RULES_GLOBAL,
    target: ["es2018"],
    platform: "browser",
    legalComments: "none",
    write: false,
  });

  return result.outputFiles[0].text;
}

/**
 * Splice the compiled rules over the marker block in the widget source.
 *
 * The source keeps a runnable fallback between the markers so the raw file is
 * still loadable in a dev page; this replaces it with the real thing.
 */
function injectRules(source, rules) {
  const begin = source.indexOf(INJECT_BEGIN);
  const end = source.indexOf(INJECT_END);

  if (begin === -1 || end === -1) {
    throw new Error(
      `recopyfast.src.js is missing the "${INJECT_BEGIN}" / "${INJECT_END}" markers. ` +
        "The shared editing rules cannot be injected without them.",
    );
  }
  if (end < begin) {
    throw new Error(
      `"${INJECT_END}" appears before "${INJECT_BEGIN}" in recopyfast.src.js.`,
    );
  }

  return (
    source.slice(0, begin) +
    rules +
    "\n" +
    source.slice(end + INJECT_END.length)
  );
}

/**
 * The widget's stylesheets: every `textContent = \`…\`` template literal. The
 * style-literal test (src/__tests__/embed/style-literal-comments.test.ts) reads
 * the source with the same shape.
 */
const STYLE_LITERAL = /(textContent\s*=\s*)`([^`]*)`/g;
const MIN_STYLE_LITERALS = 5;

/**
 * The widget's own syntax floor. The CSS minifier gets the same target: esbuild
 * applies no CSS lowering for an `es` target, so it prints what the source
 * already uses. The one form it introduces is the 8-digit hex colour
 * (`rgba(0,0,0,.5)` → `#00000080`), supported from Chrome 62, Firefox 49 and
 * Safari 10 — older than every engine that runs es2018.
 */
const WIDGET_TARGET = ["es2018"];

/**
 * Minify the CSS inside each style literal before the widget is minified.
 *
 * s67-embed-spa-support. These literals are strings, so esbuild's JS minifier
 * cannot touch them: every newline and the twelve spaces of indentation in
 * front of each declaration shipped to every visitor of every customer site.
 * Minifying them measured −494 / −525 gz (bundle / widget), the largest of the
 * three items that fund SPA support. It pre-empts part of the never-built
 * `s06c-embed-shrink`; that story should not count these bytes twice.
 *
 * Refuses rather than guesses:
 *   - fewer than five literals means the source changed shape under this
 *     transform, and a silent no-op would quietly hand the bytes back;
 *   - `${`, `\` or a backtick in a literal or in its minified CSS. With none of
 *     the three, a template literal's raw text equals its cooked value, so
 *     writing the minified CSS back between backticks cannot change what the
 *     browser receives, and no escaping question exists. None of today's five
 *     literals contains any of them.
 */
async function minifyStyleLiterals(esbuild, source) {
  const literals = Array.from(source.matchAll(STYLE_LITERAL));

  if (literals.length < MIN_STYLE_LITERALS) {
    throw new Error(
      `recopyfast.src.js has ${literals.length} style literals, expected at least ` +
        `${MIN_STYLE_LITERALS}. minifyStyleLiterals no longer matches the source.`,
    );
  }

  const minified = await Promise.all(
    literals.map(async (match) => {
      const css = match[2];
      const { code } = await esbuild.transform(css, {
        loader: "css",
        minify: true,
        target: WIDGET_TARGET,
      });
      const output = code.trim();

      for (const text of [css, output]) {
        if (/\$\{|\\|`/.test(text)) {
          throw new Error(
            "A style literal in recopyfast.src.js (or its minified CSS) contains " +
              "`${`, `\\` or a backtick, so its raw and cooked values may differ. " +
              "minifyStyleLiterals refuses to rewrite it.",
          );
        }
      }

      return output;
    }),
  );

  let index = 0;
  return source.replace(
    STYLE_LITERAL,
    (_match, assignment) => `${assignment}\`${minified[index++]}\``,
  );
}

/** The widget itself. No bundling: it is a self-contained classic-script IIFE. */
async function buildWidget(esbuild, source) {
  const result = await esbuild.transform(
    await minifyStyleLiterals(esbuild, source),
    {
      minify: true,
      target: WIDGET_TARGET,
      loader: "js",
      legalComments: "none",
    },
  );

  return result.code;
}

function banner(sourceHash, socketVersion) {
  return [
    "/*! ReCopyFast embed widget — GENERATED FILE, DO NOT EDIT.",
    " *  Source: public/embed/recopyfast.src.js",
    " *  Rebuild: node scripts/build-embed.mjs",
    ` *  Bundled socket.io-client: ${socketVersion}`,
    " */",
    `${STALE_MARKER}${sourceHash}`,
    "",
  ].join("\n");
}

async function readIfExists(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * gzip, in process, at the level a CDN actually serves.
 *
 * In process rather than shelling out to `gzip -9c`: a subprocess inherits
 * whatever gzip the machine ships, so the ceiling would drift between a laptop
 * and the CI runner and stop being a ceiling. `zlib.gzipSync` is byte-identical
 * everywhere Node runs.
 */
function gzipSize(text) {
  return gzipSync(Buffer.from(text, "utf8"), { level: 9 }).length;
}

/**
 * The three numbers the budget is argued in: the whole artifact, the transport
 * library, and the widget code alone.
 *
 * "The widget alone" is the artifact with the socket.io-client text cut out of
 * it — not a rebuild of the widget, which would measure something the customer
 * never downloads. socket.io leaves with `s08`; until it does, the artifact and
 * the widget move independently and both need their own ceiling.
 *
 * A missing transport throws instead of degrading to a whole-file measurement.
 * The fallback is the dangerous option: it reports the bundle size as the widget
 * size, which reads as a sudden 12KB regression that nobody caused and sends the
 * next person hunting through a diff that is not there. Both files come out of
 * the same build (see `bundle` below), so absence means something structural
 * changed and the measurement should stop, loudly.
 */
function measureBundle(bundleText, transportText) {
  const at = bundleText.indexOf(transportText);

  if (at === -1) {
    throw new Error(
      `${path.relative(ROOT, SOCKET_OUT)} was not found inside ` +
        `${path.relative(ROOT, BUNDLE_OUT)}, so the widget cannot be measured ` +
        "apart from the transport. The two files are written by the same build " +
        "and must stay byte-identical. Run: node scripts/build-embed.mjs",
    );
  }

  const widgetText =
    bundleText.slice(0, at) + bundleText.slice(at + transportText.length);

  return {
    bundleGz: gzipSize(bundleText),
    transportGz: gzipSize(transportText),
    widgetGz: gzipSize(widgetText),
  };
}

/** The ceilings in force for this run: the constants, optionally tightened. */
function resolveCeilings() {
  const raw = (process.env[CEILING_OVERRIDE_ENV] ?? "").trim();
  const committed = { maxBundleGz: MAX_BUNDLE_GZ, maxWidgetGz: MAX_WIDGET_GZ };

  if (raw === "") return committed;

  const override = Number(raw);
  if (!Number.isInteger(override) || override <= 0) {
    console.warn(
      `${CEILING_OVERRIDE_ENV}=${JSON.stringify(raw)} is not a positive integer — ignored.`,
    );
    return committed;
  }

  const ignoredFor = [
    override >= MAX_BUNDLE_GZ ? "MAX_BUNDLE_GZ" : null,
    override >= MAX_WIDGET_GZ ? "MAX_WIDGET_GZ" : null,
  ].filter(Boolean);

  if (ignoredFor.length > 0) {
    console.warn(
      `${CEILING_OVERRIDE_ENV}=${override} does not lower ${ignoredFor.join(" / ")} ` +
        "and was ignored for it. The override may only tighten a ceiling, never raise one.",
    );
  }

  return {
    maxBundleGz: Math.min(override, MAX_BUNDLE_GZ),
    maxWidgetGz: Math.min(override, MAX_WIDGET_GZ),
  };
}

function formatGzLine(measured, ceilings) {
  return (
    `gzipped  bundle ${measured.bundleGz} B (max ${ceilings.maxBundleGz})` +
    ` | widget ${measured.widgetGz} B (max ${ceilings.maxWidgetGz})` +
    ` | transport ${measured.transportGz} B`
  );
}

/**
 * Refuse a build that grew past a ceiling.
 *
 * The message names the constant, the measured size and the overage on purpose:
 * the person reading it is mid-commit and needs to know which number moved and
 * by how much, without re-running anything. What it must never read as is
 * "edit this constant" — see the ratchet note on MAX_BUNDLE_GZ.
 */
function enforceCeilings(measured, ceilings) {
  const breaches = [
    {
      constant: "MAX_BUNDLE_GZ",
      what: path.relative(ROOT, BUNDLE_OUT),
      size: measured.bundleGz,
      ceiling: ceilings.maxBundleGz,
    },
    {
      constant: "MAX_WIDGET_GZ",
      what: "the widget alone (artifact minus socket.io-client)",
      size: measured.widgetGz,
      ceiling: ceilings.maxWidgetGz,
    },
  ].filter((entry) => entry.size > entry.ceiling);

  if (breaches.length === 0) return;

  throw new Error(
    breaches
      .map(
        (entry) =>
          `${entry.constant} exceeded: ${entry.what} is ${entry.size} B gzipped, ` +
          `ceiling ${entry.ceiling} B — over by ${entry.size - entry.ceiling} B.`,
      )
      .concat(
        "The ceiling ratchets downward only. Make the change smaller; raising " +
          "the constant is a defect, not a fix.",
      )
      .join("\n"),
  );
}

async function main() {
  const isCheck = process.argv.includes("--check");

  const [source, rulesSource] = await Promise.all([
    readFile(SOURCE, "utf8"),
    readFile(RULES_SOURCE, "utf8"),
  ]);

  // Both inputs feed the artifact, so both must feed the staleness marker —
  // otherwise editing the shared rules would silently ship the old widget.
  const sourceHash = sha256(`${source}\0${rulesSource}`);

  if (isCheck) {
    // Two files off disk and nothing else. This branch deliberately never
    // touches esbuild: it is the cheap gate CI runs before the build, and a
    // staleness check that needed `node_modules` to work would stop being able
    // to run in the places a staleness check is worth running. The size gate
    // measures the committed bytes for the same reason — those are the bytes a
    // customer downloads; a fresh rebuild would measure bytes nobody has.
    const [built, transport] = await Promise.all([
      readIfExists(BUNDLE_OUT),
      readIfExists(SOCKET_OUT),
    ]);
    const expected = `${STALE_MARKER}${sourceHash}`;

    if (built === null) {
      throw new Error(
        `${path.relative(ROOT, BUNDLE_OUT)} is missing. Run: node scripts/build-embed.mjs`,
      );
    }
    if (!built.includes(expected)) {
      throw new Error(
        `${path.relative(ROOT, BUNDLE_OUT)} is stale — it was not built from the current ` +
          `${path.relative(ROOT, SOURCE)} + ${path.relative(ROOT, RULES_SOURCE)}. ` +
          "Run: node scripts/build-embed.mjs",
      );
    }
    if (transport === null) {
      throw new Error(
        `${path.relative(ROOT, SOCKET_OUT)} is missing, so the widget cannot be ` +
          "measured apart from the transport. Run: node scripts/build-embed.mjs",
      );
    }

    const ceilings = resolveCeilings();
    const measured = measureBundle(built, transport);

    console.log("embed artifact is up to date");
    console.log(formatGzLine(measured, ceilings));

    enforceCeilings(measured, ceilings);
    return;
  }

  const esbuild = await loadEsbuild();
  const socketVersion = socketIoClientVersion();

  const [socketIo, rules] = await Promise.all([
    buildSocketIo(esbuild),
    buildRules(esbuild),
  ]);

  const widget = await buildWidget(esbuild, injectRules(source, rules));

  // socket.io goes first so `window.__recopyfastSocketIO` already exists by the
  // time the widget runs — no second request, and no injected <script> element
  // for a nonce- or hash-based customer CSP to reject.
  const bundle = `${banner(sourceHash, socketVersion)}${socketIo}\n${widget}\n`;

  await Promise.all([
    writeFile(BUNDLE_OUT, bundle, "utf8"),
    writeFile(SOCKET_OUT, socketIo, "utf8"),
  ]);

  const sourceBytes = Buffer.byteLength(source);
  const bundleBytes = Buffer.byteLength(bundle);

  const ceilings = resolveCeilings();
  const measured = measureBundle(bundle, socketIo);

  // The raw-KB lines stay. They are how a reader sees that the artifact is
  // 174 KB on disk and 46 KB on the wire: raw byte savings land at roughly a
  // tenth of their size after gzip, and every byte estimate made in raw KB on
  // this file has been wrong by that factor.
  //
  // `socket`, not `fallback` (s67 re-review): the standalone socket.io build
  // is the gate's transport measure and a pinned public URL. The widget never
  // loads it; s67 deleted the loader that did.
  console.log(
    [
      `source   ${path.relative(ROOT, SOURCE)}  ${formatKb(sourceBytes)}`,
      `rules    ${path.relative(ROOT, RULES_SOURCE)}  ${formatKb(Buffer.byteLength(rulesSource))}` +
        ` -> inlined ${formatKb(Buffer.byteLength(rules))}`,
      `bundle   ${path.relative(ROOT, BUNDLE_OUT)}  ${formatKb(bundleBytes)}` +
        ` (widget ${formatKb(Buffer.byteLength(widget))}` +
        ` + socket.io-client ${socketVersion} ${formatKb(Buffer.byteLength(socketIo))})`,
      `socket   ${path.relative(ROOT, SOCKET_OUT)}  ${formatKb(Buffer.byteLength(socketIo))}`,
      formatGzLine(measured, ceilings),
    ].join("\n"),
  );

  // Gate last, after the artifact is on disk. Refusing before the write would
  // leave the previous (or no) artifact in place, and `--check` would then
  // report "stale" — a second, louder, entirely misleading error for the same
  // cause. The build fails, the bytes it built are still there to measure.
  enforceCeilings(measured, ceilings);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
