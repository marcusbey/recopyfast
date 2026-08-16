---
validated: no
---
# Plan — Story s14a-grant-authorized-editing

Branch: `feature/s14a-grant-authorized-editing`
Research: `docs/research/s14-agency-client-handoff.md` — read it first; this plan does not repeat it.

## Target story

`docs/stories.md` → `s14-agency-client-handoff`, split at research into three. This is the first:
the single-site security floor. Complexity 4. **Depends on nothing — explicitly not on `s13`.**
`s13` decides what "the agency's sites" means, which `s14b` needs; this story is one site and one
grant holder, and it is the security floor everything above it stands on.

Design: `docs/designs/s14a-grant-authorized-editing.md` (+ `.html`, reference only, never copied).

**The story's original premise was false.** `stories.md` said *"the single-site version works."*
It does not. An editor invited through the grant model can sign in and cannot edit — the widget
ships that sentence to every customer's live page (`public/embed/recopyfast.src.js:1130-1131`:
*"— in-page editing isn't enabled for this site yet"*). `validateDeviceGrant` has exactly one
caller in the whole app (`src/app/api/editor/validate-grant/route.ts:51`) plus its own internal use
in `refreshDeviceGrant`. No write path calls it. **`s14a` is the story the old `s14` assumed had
already shipped.** Everything above it — plural invites, cross-site activity — is decoration on a
credential that authorizes nothing until this lands.

Acceptance criteria this story carries, from the parent:

- AC 2 — the invited editor can edit **only** that site; any other site is refused. Enforced today
  but vacuous (they can edit no site at all). This story makes it non-vacuous.
- AC 4, HTTP half — revoking takes effect on the next request; an open editing session cannot
  continue saving. **The WebSocket half is `s07a`'s** — see Task 5.
- AC 8, expiry half — an expired link shows a clear message and a route to a new one. The
  *revoked* half stays deliberately silent (T7) and that is the design, not a gap.
- AC 9 — the invite flow does not reveal whether an email already has an account. Already true by
  construction; this story asserts it so a later change cannot quietly break it.

## Tasks (ordered)

- [ ] **T1 — `extractEditorToken` gains a `device-grant` kind, read from `X-RCF-Editor-Grant`,
      header only.** `src/lib/auth/editor-access.ts:166-197`. Widen `EditorAccessKind` to
      `"staging" | "edit-session" | "device-grant"` (consumed only inside this module — `:216` and
      the `access.kind` attribution fallback in the staging content route — so the compiler finds
      every site). **The header branch is checked first, before `rcf_token` and before
      `Authorization: Bearer`.** That ordering is load-bearing, not cosmetic: the widget already
      sends `Authorization: Bearer <SITE_TOKEN>` on the same content requests
      (`recopyfast.src.js:3289`, `:5120`), and the existing `Bearer` branch would swallow it as a
      staging token, sending a grant-carrying request down the wrong validator.
      *Tests:* a grant supplied as `?rcf_grant=` yields `null`; a grant in the JSON body yields
      `null`; the header yields `{ kind: "device-grant", token }`; a request carrying **both**
      `Authorization: Bearer <site token>` and `X-RCF-Editor-Grant` resolves to `device-grant`.

- [ ] **T2 — `validateEditorAccess` routes `device-grant` to `validateDeviceGrant`, and refuses
      when the `DeviceContext` is absent.** Same file, `:199-226`. The function takes an optional
      `device?: StagingDeviceFingerprint` today. Add a separate, explicitly named
      `deviceContext?: DeviceContext` (`src/lib/auth/editor-grants.ts:110-114`), and make the
      device-grant branch return `{ valid: false, status: 401 }` when it is missing — **never
      default it, never synthesise an origin.** Map `GrantRejection` to a status and a stable
      reason string; do not leak more than `validate-grant` already returns.
      *Tests:* grant + **no** `deviceContext` → refused; grant + a `DeviceContext` whose origin
      belongs to a different site → refused with `origin_mismatch`; grant + the minting origin →
      valid. The first of these is the whole story (see "The point everything turns on").

- [ ] **T3 — derive the `DeviceContext` at the single chokepoint, and let the preflight through.**
      `validateEditorTokenFromRequest` (`:330-360`) already derives the staging fingerprint at one
      point *"so the device binding is impossible to forget at an individual call site"* — build
      the `DeviceContext` there too, with `readDeviceContext(request)` from
      `src/lib/auth/editor-request.ts:20-29` (it returns `null` when there is no usable `Origin`,
      which is exactly the fail-closed input T2 expects). Separately: add `X-RCF-Editor-Grant` to
      `ALLOW_HEADERS` in `src/lib/http/public-cors.ts:26`. Without it the browser blocks the header
      on preflight and the feature fails silently on every customer domain while passing every
      server-side test.
      *Tests:* `OPTIONS /api/staging/content/[siteId]` returns an `Access-Control-Allow-Headers`
      containing `X-RCF-Editor-Grant`; a `PUT` reaching the route with a grant and a foreign
      `Origin` is refused — asserted **through the route**, not the helper, so a call site that
      forgets cannot pass.

- [ ] **T4 — map a validated grant to `EditorAccess`, graded and attributed.** Permissions come
      from the parent `site_editors` row via `normalizePermissions` (`:55`) — the single widening
      rule, not a second one. `email` is the grant holder's; `stagingAccessId` stays **null** (the
      edit is not attributable to any staging invite); `expiresAt` is the grant row's.
      No route file changes: `src/app/api/staging/content/[siteId]/route.ts:161` and
      `src/app/api/staging/publish/route.ts:76` already call the chokepoint and already grade with
      `requireEditorPermission`. That is the design — the branch lands in one place.
      *Tests:* a `view`-only grant's `PUT` is 403 and writes nothing; an `edit` grant's `PUT` is 200
      and the `staging_history` row carries the grant holder's **email** in `user_email` (not the
      literal `"device-grant"` from the `access.kind` fallback at `route.ts:254`) with
      `staging_access_id` null; a `publish` grant reaches `/api/staging/publish`, an `edit`-only
      grant does not.

- [ ] **T5 — the revocation criterion (AC 4, HTTP half; review finding M5).** A test that mints a
      grant, saves once (200), revokes the `site_editors` row through
      `DELETE /api/editor/editors`, then replays **the same grant** on the next
      `PUT /api/staging/content/:siteId` and asserts it is refused. The behaviour is already true
      at `editor-grants.ts:344` (`editor.revoked_at` → `editor_revoked`, read fresh on every call);
      the test is what makes it a criterion rather than an accident. Assert the second half too:
      `revokeSiteEditor` sweeps the device grants (`editor-directory.ts:206`), so the refusal must
      hold even if the sweep is skipped — revoke the parent row only and confirm the save is still
      refused.
      **The WebSocket half is not planned here and must not be.** `server/index.js:386-405` caches
      permissions at handshake and `:527` reads that cache per message — a live, server-side defect
      that `s07a` owns. It cannot live here for three reasons: no WebSocket service is deployed, so
      a criterion written here would be vacuous when tested; the defect is in `server/`, which
      `s07a` owns end to end while `s08` replaces only the client library; and ADR 004 rule 2 says
      realtime is *provably additive*, which forbids making a security property of the HTTP path
      conditional on a service the ADR insists is optional.

- [ ] **T6 — the widget sends the grant on exactly four call sites, in the header, never a URL.**
      `public/embed/recopyfast.src.js`: `persistContentUpdate` (`:2625`, which today *throws*
      unless `stagingMode`), `hydrateStoredContent` (`:3277`), `startPolling` (`:5107`), and the
      publish call (`:2097`). A grant-authenticated request sends `X-RCF-Editor-Grant` and **no**
      token query parameter and **no** token in the body.
      **`/api/edit-board/*` is deliberately out of reach** — those routes call
      `StagingAccessManager.validateStagingAccess` directly and never touch `extractEditorToken`,
      so a grant cannot reach theme, language or style administration. That is correct scoping, not
      an oversight; leave it. (Research estimated ≈17 reachable call sites; measured, it is **five
      route files** — `staging/content`, `staging/publish`, `staging/validate`,
      `edit-sessions/validate`, `edit-sessions/extend` — and only the first two are write paths.)
      *Tests:* in `src/__tests__/embed/`, assert the fetch options carry the header and that **no**
      request URL produced by any of the four contains the grant string.

- [ ] **T7 — turn `editMode` on from the grant, and delete the sentence that says it is off.**
      `initEditorAuth` / `applyEditorIdentity` (`:1019-1062`) and `showEditorBanner`
      (`:1064-1147`). Set `editMode` from the grant's permissions using the same
      `edit | publish | admin` test the staging path uses at `:990-994`. Delete `:1130-1131`
      entirely — both the visible note and its `title`. Rewrite the long comment above
      `initEditorAuth` (`:1010-1017`), which currently states the old rule as fact; per the house
      style, leave the tombstone: what the banner used to say, and why it now does not.
      Banner content per the design: `<>` mark · "You can edit this page" · email (truncating,
      `title` kept) · save status ("Saved" / "Saving…") · **"Done"** (renamed from "Hide", same
      behaviour). No Publish button, no staging/live vocabulary.
      Then `npm run build:embed` — `recopyfast.js` is generated and `--check` fails on a stale
      artifact. **Record the gzipped delta in the PR.** `docs/stories.md` allocates s14 **zero**
      bytes; deleting a sentence and a `title` should make this net-negative, and if it is not,
      say so rather than absorbing it silently.
      *Tests:* a grant with `["view"]` leaves the page inert (no `editMode`, no affordance); a
      grant with `["edit"]` enables it; the banner renders the email and no longer contains the
      words "isn't enabled".

- [ ] **T8 — the one state the code does not handle, and three off-brand values in the file being
      edited.** The lapsed-handoff first visit: `boot(handoffCode)` where `redeem()` fails (spent,
      60s-expired, or wrong-site) **and** `readStored()` finds nothing (`:456-465`) falls straight
      to `{ status: 'anonymous' }` — today, silence. Open `showEditorCodeUI()` with a third `stage`
      copy variant: *"That link needs refreshing"* / *"Links like this work once. Enter the email
      you edit this site with and we'll send a new code."* This is **not** the revoked case: no
      verification has happened, nothing is being confirmed or denied about the address, so T7's
      enumeration guarantee is untouched. Same file, same function, one branch — not a new
      component. In the same pass, correct the three values the design system already forbids:
      `.rcf-hovering` outline `rgba(59,130,246,.6)` (Tailwind blue-500, a second brand colour) →
      `hsl(174 48% 58% / 0.7)` dashed / `hsl(174 48% 58%)` solid; `.rcf-modal-icon`'s gradient →
      flat `hsl(174 48% 58% / 0.16)` on a `hsl(174 48% 58% / 0.35)` border; `.rcf-hover-hint`'s
      gradient → flat `hsl(200 18% 10% / 0.95)`. Literal values with a comment naming the token
      they came from, per `design-system.md:255-256` — the widget has no token layer and `s06`
      owns closing that.
      *Tests:* a failed redeem with empty storage opens the modal with the third copy; the modal's
      server-supplied `notice` is still passed through unrewritten (`:1302-1308`).

- [ ] **T9 — regression tests for the traps and the prior hardening.** Each of these is true today
      and each is one careless edit from being false:
      - A grant is **not guessable**: the handoff code is 32-byte CSPRNG, stored hashed, 60s TTL
        (`editor-handoff.ts:27`). Assert a wrong code is refused and costs the same rejection as an
        unknown one.
      - A grant is **not reusable across sites**: site-pinned in the signed payload
        (`editor-grants.ts:245`) and re-pinned at redemption (`editor-handoff.ts:118`). Assert a
        grant minted for site A is refused on site B's content route — this is AC 2, and until T1
        it could not be tested at all.
      - A grant is **not valid after redemption by someone else**: `redeemHandoff` consumes before
        minting via a conditional update (`:124-137`). Assert two concurrent redemptions produce
        exactly one grant.
      - **Enumeration (T8 of research, AC 9)**: `/api/editor/request-code` is neutral in body *and*
        timing — minting and mailing both run in `after()` (`route.ts:115`) so a recognised address
        costs no extra latency. Assert the response body and status are byte-identical for a known
        editor and an unknown address.
      - **`728b646` not regressed**: `GET /api/sites` returns `siteToken`/`embedScript` only when
        `permission === 'admin'`; site DELETE still requires the creator
        (`permission === 'admin' && granted_by === null`).
      - **`aca2eb2` not regressed**: the last-admin revoke guard at
        `src/app/api/sites/[siteId]/share/route.ts:445-503` still refuses.

- [ ] **T10 — write the ADR.** `docs/decisions/<next free number>-grant-on-the-content-write-path.md`
      (number assigned at execute time; sibling story branches may claim one first). It must record:
      the grant becomes a third principal accepted by `validateEditorTokenFromRequest`; it travels
      **only** in `X-RCF-Editor-Grant`, never a URL parameter, never a body field, because a grant
      in a URL enters browser history, referrers and server logs; the device-grant branch is
      **fail-closed on a missing `DeviceContext`**; `/api/edit-board/*` is deliberately out of
      reach. Options rejected: consolidating onto the `staging_access` token that already works
      (rejected — migration `20260801100000` deliberately chose an entry URL carrying no secret,
      and reversing that is a downgrade); accepting the grant as a `Bearer` token (rejected — it
      collides with the site token the same requests already carry). Cross-reference ADR 002 rule 3,
      which already names "a scoped editor grant" as a permitted service-role principal without
      saying how it reaches the write path.

## Run interdicts

- **No `/api/teams/*` route is touched. No role is introduced.** Grants are per-site and expiring;
  roles are per-org and persistent. `site_editors.permissions` is a capability array on a
  revocable row — it is not a role, and it must not grow into one. Do not extend
  `/api/sites/[siteId]/share`, which joins the graveyard `teams` tables through
  `site_permissions.team_id`.
- **The grant never appears in a URL.** Not a query parameter, not a path segment, not a fragment,
  not a redirect target. A grant in browser history is a credential in browser history.
- **The grant never appears in a request body.** Body-carried tokens are why `extractEditorToken`
  has four body aliases already; do not add a fifth. Header only, one name.
- **No fourth auth path** (AGENTS.md). The branch lands inside `extractEditorToken` /
  `validateEditorAccess` and nowhere else. If a route needs a grant check written inline, the
  chokepoint is wrong — fix the chokepoint.
- **No zod** (ADR 003). Boundary validation via `src/lib/api/validation.ts`, extended if needed.
- **Do not edit `public/embed/recopyfast.js` by hand.** Edit `.src.js`, run `npm run build:embed`.
- **Do not add a `createServiceRoleClient()` call to a route that does not already have one.**
  28 of 77 today; ADR 002 says revisit past ~40, and this story needs none — `validateDeviceGrant`
  already owns its service-role read behind its own validation.
- **Do not make the revoked-editor state visible.** `nextActionFor` returns `hide` for
  `editor_revoked` and `site_mismatch` (`editor-grants.ts:131-144`) and the widget renders nothing
  (`:1044-1049`). Showing "your access ended" would confirm to anyone holding an old link that the
  address once had access. AC 8's "clear message" is scoped to **expiry**, per T7.
- **Do not relax `findActiveSiteEditor`'s null-for-unknown-and-revoked behaviour**
  (`editor-directory.ts:52`). Making those distinguishable is the enumeration leak.
- **Do not modify an existing test to accommodate the new behaviour.** Change the behaviour or add
  a test and say so in the PR (AGENTS.md).

## The point everything turns on

**A grant accepted without its origin pin is a credential that works from any website.**

The origin binding is what makes an exfiltrated grant worthless somewhere else
(`editor-grants.ts:249-257`). It lives inside `validateDeviceGrant`, which needs a `DeviceContext`
built from the `Origin` header. `validateEditorTokenFromRequest` builds only a
`StagingDeviceFingerprint` today, and the `device` parameter it passes is **optional** — so nothing
in the type system stops a caller from omitting the context, and an omitted context is not a
compile error, a test failure, or a 500. It is a silent, permanent, cross-site editing credential
minted with our name on it, redeemable from any page an attacker controls, against a customer's
live site.

That is why T2 makes the device-grant branch refuse on a missing `DeviceContext` rather than
defaulting it, why T3 derives the context at the one chokepoint every token path already passes
through, and why the test for it runs **through a route** rather than against the helper. A helper
test proves the helper is right. A route test proves nobody forgot to call it.

The second, quieter half of the same point: the header. A grant in a URL is a grant in browser
history, in the `Referer` header sent to every third-party asset on the customer's page, and in
every access log between here and there. `staging_access` already puts a bearer token in a URL the
owner hand-delivers (research, section B) — that is the pattern this story must not copy, and
migration `20260801100000` exists precisely because someone already decided the entry URL carries
no secret.

## Files touched

| File | Change |
|---|---|
| `src/lib/auth/editor-access.ts` | `device-grant` kind; header-first extraction; fail-closed device-grant branch; chokepoint `DeviceContext` derivation |
| `src/lib/http/public-cors.ts` | `X-RCF-Editor-Grant` added to `ALLOW_HEADERS` |
| `public/embed/recopyfast.src.js` | grant header on four call sites; `editMode` from the grant; banner redesign; the deleted note + its tombstone comment; lapsed-handoff modal copy; three colour corrections |
| `public/embed/recopyfast.js` | **generated** — `npm run build:embed`, never hand-edited |
| `src/lib/auth/__tests__/editor-access.test.ts` | extraction precedence, fail-closed device context |
| `src/__tests__/api/staging/content-device-grant.test.ts` | new — route-level grant accept/refuse, permission grading, attribution |
| `src/__tests__/api/staging/grant-revocation-midsession.test.ts` | new — T5, the AC 4 criterion |
| `src/__tests__/api/staging/content-put-permissions.test.ts` | extended for the new principal |
| `src/__tests__/embed/editor-auth.test.ts` | header sent, never a URL; `editMode` from permissions; lapsed-handoff modal |
| `src/__tests__/api/editor/request-code/route.test.ts` | enumeration neutrality assertion (AC 9) |
| `docs/decisions/<next>-grant-on-the-content-write-path.md` | new ADR |
| `docs/plans/s14a-grant-authorized-editing.md` | checkboxes ticked as tasks land |

Not touched, deliberately: `src/app/api/staging/content/[siteId]/route.ts`,
`src/app/api/staging/publish/route.ts` (the chokepoint is the point — if these need editing, the
branch is in the wrong place), `src/app/api/edit-board/*`, `src/app/api/teams/*`, `server/`,
`src/app/edit/EditorSignIn.tsx` (confirmed working and on-system; its one `<h1>` drift is
out of scope).

## Test strategy

**Where the tests must run from.** Every authorization assertion in this story runs at the route
level, through `PUT /api/staging/content/[siteId]` and `POST /api/staging/publish`. Helper-level
tests are welcome as a second layer, but they cannot be the only layer: the failure this story
guards against is *a call site that forgets to pass the device context*, which a helper test
passes by construction.

**The tests that must fail before the code exists** (TDD; `/ks-execute` runs red-green):

1. A grant in `X-RCF-Editor-Grant` is accepted on the content path — fails today, because
   `extractEditorToken` returns `null` for it (this is the false-premise test).
2. The same grant with **no** `Origin` header is refused.
3. The same grant with an `Origin` belonging to a different registered site is refused.
4. A grant minted for site A is refused on site B (AC 2, previously untestable).
5. A grant whose parent `site_editors` row was revoked mid-session is refused on the next save
   (AC 4, M5).
6. A `view`-only grant's save is 403; the element is unchanged in the database.
7. `OPTIONS` on the content route allows `X-RCF-Editor-Grant`.
8. No request the widget builds carries the grant in a URL.

**Mocking.** Follow `src/lib/auth/__tests__/editor-grants.replay.test.ts`'s operation-log shape for
Supabase — it already asserts *which writes happened*, which is what T5 and T4's attribution test
need. Do not mock `validateDeviceGrant` itself in the route tests; mocking the thing under
protection is how a fail-open ships green.

**Widget tests.** `src/__tests__/embed/editor-auth.test.ts` and `handoff-roundtrip.test.ts` are the
existing pattern. Note `jest.setup.js:177-182` mocks `IntersectionObserver` with a no-op — no test
here should depend on intersection behaviour, but if one does it must supply its own mock or it
passes vacuously.

**Coverage.** `jest.config.js` thresholds are a ratchet at today's floor (22% lines). This story
adds tests to the highest-consequence module in the repo; raise the ratchet by whatever it earns
and never lower it.

**Not tested here, and why:** revocation over an established WebSocket. No WebSocket service is
deployed (`architecture.md:52`, `server/fly.toml:22` still carries the placeholder app name), so a
test written here would pass against nothing. `s07a` owns it.

## Definition of Done

- [ ] Every task above checked, with its named tests present and green.
- [ ] An editor invited by email, who has never had an account, can open the customer's page, enter
      the emailed code, and change a paragraph — and it persists. Verified by hand against a real
      site row, not only in tests. **This is the story.**
- [ ] The sentence *"in-page editing isn't enabled for this site yet"* appears nowhere in
      `recopyfast.src.js` or in the built `recopyfast.js`.
- [ ] `npm run build:embed` run; artifact fresh (`--check` passes); the gzipped delta stated in the
      PR against the zero-byte allocation `docs/stories.md` gives this story.
- [ ] `lint`, `type-check`, `format:check`, `build`, `test` all green.
- [ ] The ADR is written and committed on this branch.
- [ ] The four run interdicts that can be checked mechanically are checked and stated in the PR:
      no `/api/teams/*` in the diff; no new `createServiceRoleClient` call site; no `zod` import;
      no grant in any URL-building expression.
- [ ] `docs/reviews/s14a-grant-authorized-editing.md` ends `Ship allowed: yes` with no critical
      finding. Given what this story is, a security review pass is not optional — this is the
      routes-where-a-missing-`if`-is-a-breach category ADR 002 names.
