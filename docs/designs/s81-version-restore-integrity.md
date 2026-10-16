# Design — Story s81-version-restore-integrity

Research: `docs/research/s81-version-restore-integrity.md`. Design system:
`docs/design-system.md`. Parent screen: `docs/designs/s70-content-changes.md`.

Scope: the existing Discard confirmation and expanded-row error state on `/dashboard/changes`.
There is no new screen, component, token, control or layout. No `.html` mockup is needed because
the state transition below uses the current dialog, spinner, destructive Alert and row refresh in
their existing slots.

## State matrix

| State                                                        | Confirmation dialog                                                                                          | Write                                                             | After the action                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Current row                                                  | Existing “Discard this draft?” dialog; destructive button spins and every row for the element stays disabled | One conditional PUT carries the exact version from the final read | Existing refresh lands, dialog closes, row shows the server state and the polite “Draft discarded.” announcement fires                |
| Row already changed before the final read returns            | Same spinner while the read finishes                                                                         | No PUT                                                            | Dialog closes onto the refreshed expanded row; existing destructive Alert says “This change was updated elsewhere — review it again.” |
| Row changes after the final read and before the PUT locks it | Same spinner until the 409 and refresh finish                                                                | One conditional PUT; no retry                                     | Same refreshed expanded-row Alert. The owner must review the new row and deliberately press Discard again                             |
| Version missing or malformed                                 | Same spinner while the final read is checked                                                                 | No PUT; never an unconditional fallback                           | Dialog closes onto the refreshed expanded row; existing destructive Alert says the draft could not be checked and to try again        |
| Refresh after a conflict fails                               | Existing dialog closes because the row may have changed                                                      | No retry                                                          | Existing expanded-row Alert appends the current “row may be out of date; reload” guidance                                             |
| Ordinary server refusal (402, 403, 429, 500)                 | Existing destructive Alert stays inside the dialog                                                           | No retry                                                          | Unchanged from s70: the owner can read the refusal and choose what to do                                                              |

## Interaction and accessibility

- The confirmation remains two-step. A 409 never becomes a force action and never submits again.
- Busy and focus behavior stay as designed in s70: the element remains locked through the refresh;
  a stale/uncertain outcome closes the dialog, expands the refreshed row and places the message
  under its actions where the changed copy can be reviewed.
- The fixed message is text in the existing `Alert variant="destructive"`; no colour alone carries
  the state and no new live region is introduced.
- The existing mobile sheet/dialog behavior is unchanged.

## Design system gaps

None. This story adds integrity to an existing transition and reuses every visual state already
defined by s70.
