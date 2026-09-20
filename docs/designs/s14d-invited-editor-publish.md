# Design — Story s14d-invited-editor-publish

## Screen

No new route. The story changes the existing injected `#rcf-editor-banner` and the inline edit
toolbar on the customer's site.

The banner keeps the s14a structure and literal widget palette derived from the design system:
cool hue-200 dark chrome, teal accent, system UI font, sentence-case labels. It adds one primary
action only when the verified grant contains `publish` or `admin`.

## Mockup

`docs/designs/s14d-invited-editor-publish.html` is a reference, not production code. It shows:

1. Publish-capable editor: identity, save status, Publish, Done.
2. Edit-only editor: identity, save status, Done — no empty Publish slot.
3. Terminal authentication failure while a draft is dirty: the draft remains visible and read-
   only; the banner states "Session ended — draft kept" and offers Re-authenticate.

## Reused elements

- `#rcf-editor-banner` — same fixed, translucent dark bar.
- Existing `#rcf-publish-btn` semantics and `showPublishConfirmation()` — explicit confirmation,
  pending-change count, then Publish.
- Existing teal primary button treatment from the staging banner, re-expressed inside the editor
  banner's own style block so the invited path never depends on staging CSS being injected.
- Existing inline Save/Cancel toolbar for an active edit.
- Existing editor hub and dashboard routes as recovery destinations; no new page or modal.

## States

| State | Visible result |
|---|---|
| View-only | No editing affordance and no Publish. Existing identity behaviour remains. |
| Edit-only | "You can edit this page", Save status, Done. No Publish. |
| Publish/admin | Edit-only content plus one teal `Publish` button before Done. |
| Save in flight | Existing `Saving…` text; controls retain their current disabled behaviour. |
| Draft saved | Existing `Saved` text. Published visitor content remains unchanged. |
| Publish confirmation | Existing confirmation overlay and pending-change count. |
| Terminal 401/403 with dirty draft | Draft stays in the DOM and session storage, editing becomes read-only, mutation controls disable, one inline status appears, and Re-authenticate opens in a new tab so the draft page remains intact. |
| Transient error | Existing retryable error path; controls remain usable. |

## Copy

- Button: `Publish`
- Terminal status: `Session ended — draft kept`
- Recovery action: `Re-authenticate`

No "Staging" label is added to the invited-editor banner. Save and Publish remain distinct user
actions without exposing the storage model.

## Accessibility

- Publish is a native `button`, has visible text and an `aria-label`, and is keyboard reachable.
- Its absence, not disabled styling, expresses insufficient permission.
- Terminal state uses the existing `role=status` banner region; the recovery action is a native
  button and the draft element is no longer `contenteditable`.
- No alert loop. One state transition produces one message.

## Design system gaps

None. The widget already uses literal token-derived colours because app CSS variables do not exist
on customer pages. The new control reuses that established exception and introduces no new hue,
font, spacing scale, modal or toast.

Design ready (`docs/designs/s14d-invited-editor-publish.md` + `.html`). Next step:
`/ks-plan s14d-invited-editor-publish`.
