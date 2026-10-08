# ADR 047 — An edit session carries no authority of its own; the holder's live grant decides

- Status: accepted
- Date: 2026-10-08
- Scope: story s68a-edit-session-authority
- Amends:
  - [ADR 042](./042-content-writes-are-service-role-only.md) — its "Watch" entry "Direct
    credential issuance is still open … It is not a content bypass: every write those
    credentials make is route-gated" is **wrong for `edit_sessions`**. The routes gate on the
    permissions written *inside* the session row, and a member writes that row. ADR 042's body is
    not edited; this ADR retracts that sentence for `edit_sessions` and closes the issuance half.
- Numbering: 043–045 are taken on the unmerged s61/s62 branches; s66/s67 may also claim 047/048.
  Renumber at merge if one of them lands first.

## Context

`edit_sessions` is a bearer credential: whoever presents the token in `body.editToken` or
`?rcf_edit_token=` is treated as the session's holder. Two facts combined into a privilege
escalation that is live in production (owner's read-only SQL, 2026-10-08):

- **Members can write the row.** `20250817000000_complete_database_setup.sql:483-492` creates
  "Users can create edit sessions for sites they have access to": `FOR INSERT` to PUBLIC, `WITH
  CHECK (user_id = auth.uid() AND <an edit or admin row exists>)`. It constrains *who* inserts,
  never *what* they insert. `anon` and `authenticated` also hold Supabase's default
  `arwdDxt` on the table. Reproduced on a fresh replay on 2026-10-08: an `edit` member's own JWT
  inserted `{permissions: ['admin'], expires_at: '2099-01-01'}` and the row was accepted.
- **The validator trusts the row.** `validateEditSessionAccess`
  (`src/lib/auth/editor-access.ts:416-457`) returns `normalizePermissions(session.permissions)`
  and nothing else. `POST /api/staging/publish` (`src/app/api/staging/publish/route.ts:106-138`)
  then asks `requireEditorPermission(access, "publish")` of exactly those permissions. So does
  every other route that accepts an edit token: staging content, edit-board history, AI suggest,
  edit-session extend and validate.

So an `edit` member publishes to the live site by presenting a self-minted `admin` session with no
cookie. The session also outlives the member's removal: `DELETE /api/sites/[siteId]/share`
(`route.ts:514-518`) deletes the `site_permissions` row and never touches `edit_sessions`. The
24-hour lifetime ceiling exists only in `/api/edit-sessions/extend`; a row inserted directly with
`expires_at` in 2099 is never measured against it.

The realtime service repeats the same trust (`server/auth.js:219-241`); it is broadcast-only, so
there the cost is disclosure of staged copy, not a write. That copy is closed in s68c.

## Decision

**An edit session never grants more than its holder's live `site_permissions` row for that site,
read at every validation. The session row only narrows. Only the service role writes the table.**

1. Validation reads the holder's direct `site_permissions` row (`site_id`, `user_id` = the
   session's `user_id`), the same row `authorizeFirstPartyEditorAccess` reads. The granted set is
   `normalizePermissions(session.permissions) ∩ normalizePermissions([live.permission])`. No row,
   a NULL `user_id`, or an empty intersection is a 401 — "Invalid or expired edit session", the
   message the route already returns, so the refusal leaks nothing new.
2. A session past `MAX_SESSION_LIFETIME_HOURS` from its `created_at` is refused, whatever its
   `expires_at`. The ceiling is enforced where the credential is used, not only where it is
   extended.
3. Removing a member deactivates their edit sessions for that site (`is_active = false`,
   `revoked_at = now()`), scoped by `site_id` and `user_id`. With rule 1 this is not load-bearing
   for authorization; it is what makes the dashboard's session list and the realtime sweep tell the
   truth immediately.
4. `EditSessionManager.createEditSession` keeps its permission check under the user's RLS client
   and inserts through the service client. No other writer exists.
5. Migration `20261008100000_edit_sessions_service_role_writes.sql` drops the INSERT policy,
   revokes INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER from PUBLIC, `anon` and
   `authenticated` (and SELECT from PUBLIC and `anon`), keeps `authenticated` SELECT under the
   own-rows policy, deactivates every active row that rule 1 or 2 would refuse, and asserts the end
   state in a postcondition.

## Considered options

- **Tighten the INSERT policy's `WITH CHECK`** to compare `permissions` with the member's level —
  rejected. It fixes issuance and leaves validation trusting a stored value, so the next path
  that writes the row (a restore migration — see `20260803010000`'s header for how one already
  reverted a fix on this exact table) reopens the hole. Removal would still not revoke.
- **Revoke direct writes only (DB layer alone)** — rejected as insufficient. It closes minting but
  not removal: a session issued legitimately to an `admin` who is later demoted or removed keeps
  its stored `admin` until expiry.
- **Delete `edit_sessions` and route everyone through device grants** — rejected for now. The
  dashboard "Edit website" button and two e2e specs depend on the edit-session path; replacing a
  credential type is a product change, not a security fix. Recorded so it stays a decision.
- **Cache the live grant on the session row** — rejected. A cache is a second copy of the grant,
  which is the defect being removed; one indexed read per validation is proportionate (the same
  choice `server/auth.js` made for revocation, M5 tombstone at `:127-152`).

## Consequences

- Every edit-token validation costs one more indexed read of `site_permissions`.
- A downgrade or removal takes effect on the next request, not at expiry.
- `publish` is not a `site_permissions` level (`CHECK (permission IN ('view','edit','admin'))`,
  `20250817000000:56`), so publishing through an edit session requires an `admin` row. That is
  already true of first-party access and of `createEditSession`; it is stated here so nobody
  "fixes" it by widening the intersection.
- Seed data that inserts edit sessions without a `user_id` (`e2e/share-edit-publish.spec.ts:431`,
  `e2e/realtime-parity.spec.ts:432`) stops working and must name the owner.
- Old application code on the new schema cannot issue edit sessions (its user-JWT insert is
  refused), so the deploy order is application first, then migration — the s56 order.

**Watch.**

- `staging_access` keeps admin-only INSERT/UPDATE policies for `authenticated`
  (`20251230000000:120-142`). An admin can therefore write a staging row directly, bypassing route
  validation — not an escalation (the writer is already `admin`), but the same "row is the
  authority" shape. `validateStagingAccess` does re-check the device binding; it does not re-check
  the issuer's live grant. Candidate for the same rule if staging invites stay.
- `server/auth.js` must apply rule 1 too; until s68c ships, a removed member's open socket keeps
  receiving staged copy until rule 3's deactivation reaches it on the next sweep.
