# Design — stable initial copy

## Intent

Visitors see one initial version of managed text. Protection is automatic in the new
installation, works across eligible headings, paragraphs, buttons and explicit content
regions, and does not require a hero selector. Speed and stability are separate criteria.

## Installation contract

One generated installation contains a small native inline head bootstrap and the permanent
external runtime tag. The bootstrap only prepares the render gate and starts public reads;
DOM content mutation remains at the platform's safe runtime point. Plain HTML/WordPress
and hydrated frameworks have distinct placement recipes. No toggle disables protection in
the supported new snippet. Old snippets remain functional and need a documented migration.

The external tag carries a required startup-protocol version marker. A new runtime tag
with missing, failed, late or mismatched bootstrap state keeps authored initial content;
it does not silently take the legacy swap path. Old unmarked tags retain compatibility.
The bootstrap only arms while running natively in head before body exists; otherwise it
settles fallback immediately without hiding already visible text.

A site whose CSP blocks the bootstrap stays visible with authored content. Add nonce/hash
instructions for sites with restrictive CSP; do not weaken their policy to unsafe-inline.
A late or blocked bootstrap does not claim first-paint protection and must never start
hiding text after it was already visible. Unsupported paths keep authored text for that
initial document instead of applying a late startup replacement.

## Visitor lifecycle

1. Before page content can paint, install eligibility observation and start one public
   fetch. Arm the monotonic 200 ms visibility deadline when the first eligible text is held. Bind state to site, API origin and normalized path.
2. Hold eligible text leaves/explicit regions as they arrive, preserving their boxes and
   author styles. Ignore exclusions. Pure structural wrappers must remain untouched.
   Confirm the temporary style is effective; if CSP blocks it, settle fallback without
   applying a late replacement. Nonce support must cover both generated script and style.
3. In parallel, load the runtime and gather the final published rows/A/B decision. Font
   readiness remains a requirement only for edit-time geometry. Public prefetch never
   contains private headers or URL credentials. Cross-origin reads use no-referrer;
   same-origin reads send only the explicit bare origin under ADR 044.
   Existing A/B transport remains outside this refactor.
4. When complete before deadline, commit final values synchronously and reveal once.
   Gather before mutation so expiry cannot expose partly applied baseline/variant content.
   Snapshot changed text/attributes/map values and roll back a partial commit if a host
   exception occurs; only then release the gate to the authored fallback.
5. If public rows fail or miss the deadline, reveal authored text, abort what can be aborted,
   and disconnect the gate. If only A/B fails or misses the cap, reveal the valid published baseline
   and reject late public startup responses. Public polling/socket/A/B replay must not resurrect
   this abandoned initial delivery. An explicit user edit is a separate action.

The user rejected the earlier 1.5-second ceiling. The revised 200 ms is a maximum
of actual concealment, starting when the first eligible text is held. Fetch begins
earlier, at the head bootstrap. Pages with no eligible text also expire their observers.
This cap is a proposal, not proof the current 800-900 ms request can satisfy it.

Speed is a rollout prerequisite: more than one authored fallback in twenty representative
cold visits blocks rollout. Prepare a separate delivery-cache plan if the optimized path
cannot meet this; never lengthen the mask or count old-copy fallback as success.

The deadline is checked when committing, not only in a timer callback, since main-thread
work can delay timers. It is a safety limit, not a promised 200 ms wait; success reveals sooner.
JavaScript cannot execute a release while the host main thread is blocked, so tests measure
both scheduled deadline and actual reveal rather than claim impossible real-time guarantees.

## Visible behavior

Eligible text may briefly be absent. Its layout space remains. Unedited eligible text can
also wait on a first visit because the edited set is not yet known. Media outside managed
containers remains visible. An icon/image inside a managed button or declared rich region
can wait with that region; never force originally hidden content visible.

Keep host animation styles intact. If animation reveals text before the replacement is
ready, the temporary gate still wins; removing it restores the host's own visibility.
No spinner, skeleton, dashboard setting or customer-site error banner is added.

## Private editor lifecycle

Retain existing credential validation, URL scrubbing, private endpoints, headers and
geometry rules. After mode resolution, an authorized private flow discards public prefetch.
Private rows never enter shared caches or persistence. A stale-grant modal cannot extend
the visitor visibility deadline. Public A/B must not overwrite a private preview.

## Supported boundaries

This story protects the supported initial full-document load. Existing open shadow roots
need tested local gate styles. A shadow root or dynamic subtree arriving after release,
SPA navigation and host-driven text changes need separate lifecycle support and are not
covered by a blanket no-flash claim. Images keep their existing replacement behavior.

## Alternatives considered

- Faster API alone: useful but leaves original text eligible to paint first.
- Optional concealment: rejected by the user's latest direction.
- Whole-body concealment: too broad; withholds unrelated media and host UI.
- Forcing descendant images visible: can expose intentionally hidden host content.
- Server HTML integration: strongest first-render delivery, but requires separate customer
  integration and is not required for this reusable snippet change.
- Shared CDN response cache: deferred until authorization and atomic invalidation are designed.

## Contract details from independent plan review

- Return a typed installation object with headBootstrap, runtimeTag, protocolVersion and
  CSP hash metadata. Keep legacy buildEmbedScript unchanged for old consumers; new-install
  surfaces use both placements. The inline body is byte-identical across sites; configuration
  is escaped into attributes. Propagate nonce/hash support to both script and style.
- Early cross-origin content fetch uses referrerPolicy: "no-referrer". Same-origin
  requests explicitly send only document.location.origin + "/" with the origin policy
  (ADR 044), preserving the mandatory domain proof without paths or credentials.
  Both omit cookies and editor credentials, copy no query credentials, and retain URL scrubbing. Existing
  A/B query-token transport is outside this refactor; the no-URL-token rule applies to
  the new content prefetch and private credentials.
- The visibility timer always releases. The late-apply lockout governs PUBLIC startup.
  Authorized staging/edit-session/device-grant hydration can complete later; discard the
  public prefetch for that flow. Use canReachStagingContent for both route selection and
  exclusion from public A/B. Test valid, expired, revoked, offline and hung grants.
- If published rows are valid but the A/B decision fails or misses the cap, reveal published
  baseline without variant/impression. Only missing/failed published rows cause authored
  fallback. Late assignments cannot swap the revealed copy.
- Supported open roots present during startup need per-root style and observer injection
  before reveal. Late roots, SPA transitions and later dynamic subtrees remain outside
  the initial-load guarantee.
