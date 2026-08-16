# Design — Story s14a-grant-authorized-editing

## Screen(s)

This story does not add new screens. It turns an already-injected, currently-inert widget
surface into a working one, and designs one state the code does not handle today. Four
injection points, all in `public/embed/recopyfast.src.js` unless noted:

1. **The in-page editor banner** (`#rcf-editor-banner`, `showEditorBanner()`,
   `recopyfast.src.js:1064-1147`). Today it identifies the signed-in editor and then says, out
   loud, *"— in-page editing isn't enabled for this site yet"* (`:1130`) — the exact sentence the
   research doc quotes as proof the grant authorizes nothing. s14a deletes that sentence and
   turns editing on, so the banner is redesigned from an inert identity notice into a live
   editing banner.
2. **The editable/non-editable affordance** — `.rcf-hovering` / `.rcf-hover-hint` / `.rcf-editing`
   (same file, `:3462-3520`). This is "what the editor can and cannot touch, made obvious
   without a settings screen": editable elements carry `data-rcf-id`; everything else is
   inert. The mechanism already exists for the owner's own edit session — s14a's job is to make
   it correct and on-brand for a grant holder, not to invent a new one.
3. **The in-page verification modal** — `showEditorCodeUI()` (same file, `:1160-1344`). One
   component, three triggers: first-time verification, a returning editor whose device grant
   has expired or was carried to a browser it wasn't minted for, and (newly designed — see
   States) a first visit whose 60-second handoff link lapsed before it was redeemed.
4. **The hub** — `src/app/edit/EditorSignIn.tsx`. Inventoried per instruction. It is already
   on-system: `Button`, `Input`, `Label`, `Alert`, `ShieldCheck`/`Mail`/`Globe` from
   `lucide-react`, `tone-accent-*` for the header icon well, sentence-case copy throughout, and
   both enumeration rules already correct in code (neutral "check your email" copy shown for
   every well-formed address; the site list is fetched only after a code is accepted). **No
   changes proposed.** One minor, out-of-scope drift noted for completeness: its `<h1>` uses
   `text-2xl font-semibold` rather than `.text-display` — not fixed here, since this screen is
   confirmed working and untouched by s14a's acceptance criteria.
5. **The silent "no longer an editor" state.** Deliberately not a screen — see States. Recorded
   here so it isn't mistaken for a missing design.

Two colour systems appear in the mockup because two different runtimes are being designed for
in the same file. The hub (item 4) runs inside the Next.js app and uses `var(--token)` against
app CSS, exactly like every other design in `docs/designs/`. The banner, affordance and modal
(items 1-3) run inside `recopyfast.src.js`, injected into a customer's page — no shadow DOM,
no CSS custom properties, six-plus unlinked `<style>` blocks (`design-system.md:207-227`). Their
colours in this mockup are **literal `hsl()`/`rgba()` values**, each commented with the token it
derives from, matching the system's own instruction for this surface
(`design-system.md:255-256`: *"Derive email and widget colours from these token values, written
as literals with a comment naming the token they came from"*). The existing `#rcf-staging-banner`
already does this correctly — dark chrome (`hsl(200 18% 7% / 0.86)`), teal accent
(`hsl(174 48% 58%)`) — regardless of the host page's own light/dark state, because a floating
control bar has to stay legible over arbitrary customer content. This design keeps that
precedent rather than inventing a second approach.

## Mockup

`docs/designs/s14a-grant-authorized-editing.html` — **reference only**, never copied into
production. Five labeled sections, stacked so every state is visible without interaction:

1. The hub (existing, unchanged) — compact, for continuity, `var()` tokens.
2. On the customer's page — verification needed (the modal, both stages, three copy variants).
3. On the customer's page — editing (the banner + the three content affordance states).
4. On the customer's page — access ended (the deliberately silent state).
5. A footer note on the two off-brand values found and corrected in this design (see below).

## Reused components

| Surface | Component / element | Use here |
|---|---|---|
| Hub | `Card` (implicit — `EditorSignIn` uses a plain column, not a `Card` wrapper; page-level `Card` comes from `src/app/edit/page.tsx`, not re-verified here) | Existing, unchanged |
| Hub | `Input`, `Label`, `Button`, `Alert` | Existing, unchanged |
| Widget | `#rcf-editor-banner` structure (fixed top bar, translucent dark chrome, backdrop-blur) | Kept — same shape as `#rcf-staging-banner`, content redesigned |
| Widget | `.rcf-modal` / `.rcf-modal-icon` / `.rcf-modal-title` / `.rcf-modal-subtitle` / `.rcf-modal-input` / `.rcf-modal-btn-primary` / `.rcf-modal-btn-ghost` (all defined once, shared by every widget modal) | Reused as-is for the verification modal; only copy and two colour values change |
| Widget | `.rcf-hovering` / `.rcf-hover-hint` / `.rcf-editing` | Reused; outline and hint colours corrected to the brand accent |
| Widget | `.rcf-status-dot` pattern from `#rcf-staging-banner` | Adapted: teal, steady (no pulse) rather than amber-and-pulsing — see States |

## States

Every surface needs its states designed explicitly, per the system's rule that empty is never
how an error renders. This story's states map onto `GrantRejection` /
`nextActionFor()` (`src/lib/auth/editor-grants.ts:82-144`) as follows:

| State | Trigger | What's shown |
|---|---|---|
| **Loading** | `EditorAuth.boot()` in flight on page load | Nothing — the boot round trip is one request and the page renders as a visitor's page until it resolves, exactly as today. No skeleton: inventing a loading flash for a sub-second, once-per-page-load check would be more distracting than the wait itself. |
| **Editing (success)** | `outcome.status === 'authenticated'` | The redesigned banner (identity + "you can edit" + save status + Done) and the affordance on every `[data-rcf-id]` element. |
| **Verification needed** | `outcome.status === 'needs-code'` — `GrantRejection` reasons other than `editor_revoked`/`site_mismatch` (`nextActionFor` → `"verify"`): `expired`, `malformed`, `unknown`, `revoked` (a rotated/superseded device), `origin_mismatch`, `device_mismatch` | The verification modal, framed for a non-technical reader — see copy below. This is the AC 8 "expired" half, and it already exists in code; this design corrects two off-brand values on it and specifies copy. |
| **Expired handoff, first visit — currently unhandled** | `boot(handoffCode)` where `redeem()` fails (`ok:false` — spent, 60s-expired, or wrong-site code) **and** `readStored()` finds nothing (`recopyfast.src.js:456-465`) | **Today: silence.** The function falls straight to `{ status: 'anonymous' }` — no banner, no modal, no message of any kind. This is the one gap in the existing implementation against AC 8. It is not the revoked case (T7) — there is no address-enumeration risk here, because no verification has happened yet and nothing is being confirmed or denied about who they are. **Design calls for the same verification modal to appear**, with copy scoped to "this link needs refreshing" rather than "confirm it's you" (the modal already branches on a `stage` variable; this is a third opening copy, not a new component). Flagging this precisely so planning can decide whether it lands in s14a (it touches the exact file and function s14a is already editing) or is carried forward explicitly rather than silently dropped. |
| **Access ended (revoked / no longer an editor)** | `outcome.nextAction === 'hide'` — `editor_revoked` or `site_mismatch` | **Deliberately nothing.** `resolveStored()` already returns `{ status: 'hidden' }` and the caller renders no UI (`recopyfast.src.js:1044-1049`); this design keeps that. The page is the customer's ordinary, fully-rendered live page — not blank, not an error, just no editor chrome. This satisfies AC 8's "never a stack trace, never a blank page" literally: the page the visitor-who-used-to-be-an-editor sees is indistinguishable from what any other visitor sees, which is the whole point (T7: showing *any* message here — even "your access ended" — would confirm to anyone holding an old link that the address once had access to this site). **This is where AC 8's "clear message" cannot apply without reopening the enumeration guarantee**, and the research (T7) already recommends scoping AC 8 to expiry for exactly this reason. Recorded as a state, not a gap: nothing is missing here, the absence is the design. |
| **Wrong device** | A device with no stored grant and no fresh handoff code | Collapses into "verification needed" above — from this device, there is no signal to distinguish "wrong device" from "never verified here." Not a distinct visual state; noted so it isn't designed twice. |
| **Enumeration guarantee, restated for this screen** | — | Every string shown before a code is verified is identical regardless of whether the address can edit anything. The hub already gets this right (`"If that address can edit a site, a code is on its way."`); the in-page modal's `notice` field is server-supplied and passed through unchanged for the same reason (`recopyfast.src.js:1302-1308`, comment: *"rewriting it into 'code sent!' would claim more than the response does"*). The newly designed "link needs refreshing" copy follows the same rule — it never says whether the address is a known editor, only that the link itself is spent. |

### Banner content (redesigned)

Left to right: a small `<>` mark (teal tile, matching the brand mark rule — flat, no gradient) ·
**"You can edit this page"** · a divider · the editor's email, truncating with a `title` tooltip
(kept from the existing implementation) · flex space · a save-status label ("Saved" with a small
check, or "Saving…" while a write is in flight — text only, no toast, because none exists) ·
**"Done"** (renamed from "Hide" — same behaviour: dismisses the banner for this page load only,
does not sign out; a session ending on its own because someone closed a bar would be a strange
thing for a return visit to explain).

No "Publish" button and no staging/live language anywhere on this banner, unlike
`#rcf-staging-banner`. Whether the write path underneath autosaves directly or stages-then-
auto-publishes is an open question for planning (the research names both `/staging/content` and
`/staging/publish` as the routes the grant will call) — but exposing that distinction to this
audience would be exactly the kind of "mode" the PRD's angle 5 rules out. The banner is designed
to make sense either way: "Saved" only ever claims that the edit was written, never that it was
"published."

### Verification modal copy (three openings, one component)

| Trigger | Title | Subtitle |
|---|---|---|
| First-time verification | "Confirm it's you" *(unchanged)* | "Enter the email you edit this site with and we'll send a 6-digit code." *(unchanged)* |
| Device grant expired / wrong device | "Sign in again to keep editing" | "Your last sign-in expired. Enter the email you edit this site with and we'll send a new code." |
| Handoff link lapsed (new) | "That link needs refreshing" | "Links like this work once. Enter the email you edit this site with and we'll send a new code." |

All three share the same email → code stages, the same neutral notice text, the same "Continue
as a visitor" escape, and the same footer disclosure the code already gives: *"expires in
10 minutes"* on the hub, none currently stated in the widget modal — recommend adding it there
too for consistency, not a new copy pattern.

### Content affordance

- **At rest:** no visual change to the customer's content.
- **Hover** (`.rcf-hovering`): 2px dashed outline in the brand accent, 4px offset, plus a small
  fixed-position hint ("Click to edit") — both corrected to teal (see gaps below).
- **Active edit** (`.rcf-editing`): solid outline in the same accent, `cursor: text`, native
  text selection — no resize, no layout shift (the existing implementation is already careful
  about this; not changed).
- Nothing else on the page responds. This is the entire answer to "what can and cannot be
  touched, without a settings screen": touchable content visibly reacts to the cursor;
  everything else does not.

## Design system gaps

None new. The one gap that applies to this surface is already recorded in
`design-system.md`'s "Open design system gaps" list, item 4: *"Widget has no token layer... Fold
into s06."* This design does not invent a workaround for that — it follows the system's own
documented instruction for widget surfaces (literal values derived from tokens, commented) until
`s06` closes it.

**Two corrections, not gaps — the system already covers these, the code doesn't yet:**

1. `.rcf-hovering` outline is `rgba(59, 130, 246, 0.6)` — Tailwind blue-500. The design system
   forbids a second brand colour outright and this file already has the correct value two
   hundred lines away (`.rcf-banner-btn:focus-visible { outline: 2px solid hsl(174 48% 58%) }`,
   `:1815`). Corrected here to `hsl(174 48% 58% / 0.7)` dashed / `hsl(174 48% 58%)` solid —
   the dark-mode accent literal, chosen for contrast over arbitrary host content, consistent
   with the rest of the widget's chrome.
2. `.rcf-modal-icon` background on the verification modal is a gradient —
   `linear-gradient(135deg, rgba(45, 212, 191, 0.2), rgba(13, 148, 136, 0.2))` — against the
   system's explicit "no gradient, ever — including... icon tiles" rule. Corrected to a flat
   `hsl(174 48% 58% / 0.16)` fill with a `hsl(174 48% 58% / 0.35)` border, matching `IconTile`'s
   `accent` treatment in spirit (flat tone-surface, not a gradient wash).
3. `.rcf-hover-hint` background is also a gradient (`rgba(30,41,59,.95)→rgba(15,23,42,.95)`) —
   same rule, same fix: flat `hsl(200 18% 10% / 0.95)`.

These are pre-existing drift in a file s14a is already required to edit (the banner and the
`editMode`/write-path wiring live in the same functions), not new design work — flagged so the
Plan step scopes the one-line colour fixes alongside the functional change rather than treating
them as separate follow-up.
