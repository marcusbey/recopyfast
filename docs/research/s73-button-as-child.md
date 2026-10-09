# Research — Story s73-button-as-child

Moved out of the plan at review (Devin Review flag, PR #78) so the story has the Research → Plan
trail AGENTS.md asks for. The plan now points here.

## Findings

Verified on `origin/main` `72f4cff`.

- **The defect.** `src/components/ui/button.tsx:95-118`: `const Comp = asChild ? Slot : "button"`,
  then `<Comp …props>` with a single child — a Fragment (`<>{leftIcon}{children}{rightIcon}</>`,
  or `<><Loader2/><span className="opacity-70">{children}</span></>` when loading). Radix
  `SlotClone` clones its one valid child with the merged props, so className, ref, `disabled`,
  `aria-busy` and the rest go onto `React.Fragment`. React drops them and logs "Invalid prop
  `className` supplied to `React.Fragment`" (seen in the baseline run of `button.test.tsx`). The
  ref is not even attached: `SlotClone` skips the ref when the child is a Fragment.
- **The API exists.** `@radix-ui/react-slot` is `^1.2.3`, installed `1.2.3`; its `index.d.ts`
  exports `Slottable` (and `createSlottable`). `Slot` runs `React.Children.toArray(children)`,
  finds the `Slottable` element, clones _its_ child (the call site's `<a>`/`<Link>`) with the
  merged props, and replaces the `Slottable` position with that child's own children — so
  siblings before and after it (the icons) land inside the child, in order.
- **Trap 1 — `Slottable` must be a direct child of `Slot`.** `toArray` does not flatten
  Fragments; wrapping the three slots in `<>…</>` again would hide the `Slottable` and reproduce
  the bug. The JSX must list `leftIcon`, `<Slottable>`, `rightIcon` as `Comp`'s own children.
- **Trap 2 — the `<button>` markup must not move.** `Slottable` renders `<>{children}</>`, so
  `<button>{leftIcon}<Slottable>{children}</Slottable>{rightIcon}</button>` produces the same DOM
  as today. The loading label's `<span className="opacity-70">` stays, inside `Slottable`, for
  the `<button>` path only.
- **Decision — `loading` with `asChild`.** `aria-busy="true"` and `disabled` reach the child as
  they do a `<button>` (unchanged props); the spinner replaces `leftIcon` and `rightIcon` is
  dropped, as on a `<button>`. The dimmed `<span>` is not applied: `Slottable` hands Radix the
  child element, whose content Button does not own and cannot wrap without changing the child's
  structure. No call site combines `loading` and `asChild` today; the behaviour is pinned by a
  test so it is a decision, not an accident.
- **Contract kept from Radix.** `asChild` needs exactly one element child; a text child renders
  nothing (Radix `Slottable` returns `null` for a non-element). Every call site passes one
  `<a>` or `<Link>`.
- **Existing tests encoding the bug.** `button.test.tsx:149` ("should apply button classes to
  child element when asChild is true") and `:250` ("should forward ref when using asChild") are
  `it.failing`, with a comment saying to convert them to `it` once `button.tsx` is fixed. They
  flip to plain `it` here — declared test change (AGENTS.md § Tests). No other test asserts the
  bare-link output or the Fragment warning (`grep` for `React.Fragment` / `Invalid prop` in
  `src/` and `e2e/`).
- **E2E.** No Playwright spec covers `/docs/install`. `e2e/site-pages.spec.ts` and
  `e2e/app-layout.spec.ts` measure dashboard overflow at narrow widths and click "Back to Sites",
  "Open site page" and "Continue setup" by role and name (unchanged: still links with the same
  names). They sign in through a local Supabase service-role client
  (`createLocalServiceRoleClient("RUN_RECOPYFAST_CORE_E2E")`), i.e. CI's Docker Supabase; they run
  in CI, not locally. Risk to their overflow checks is low: every affected control is `size="sm"`
  or default with a short label, and the narrow-width rows that hold them already wrap
  (`flex-wrap` in quick setup, `max-sm:w-full` in the dialog footer).

### Call sites — how each look changes

Found with `grep -rn asChild src --include='*.tsx'` on `Button` (DropdownMenu/Dialog/Select
`asChild` are other primitives and are untouched). Before the fix every one renders as a bare
`<a>`: surrounding text colour, no underline, no padding, lucide icons at their default 24px.
After, each gets the variant and size it already asks for. None is adjusted: nine pass an
explicit variant and "Open site page" takes the default (primary, its intent); none's intent was
a bare link. Review follow-ups (orchestrator): with asChild `disabled` is not forwarded (invalid
on an <a>) and development warns, as for a child that is not one element (minor 1); the
registration dialog's footer stacks primary-on-top below 640px (`flex-col-reverse`, minor 2).

| #   | Call site                                                | Control                                                  | After the fix                                                                                                        |
| --- | -------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/app/docs/install/page.tsx:98`                       | header "Sites" (`next/link`)                             | outline `sm` button: 32px, border, card fill, 12px label                                                             |
| 2   | `src/app/docs/install/page.tsx:445`                      | "Download Markdown" (`<a download>` + `Download` icon)   | outline default button, 40px, icon 16px — matches the copy button beside it                                          |
| 3   | `src/app/dashboard/page.tsx:292`                         | "Manage" / "All N" + `ArrowRight` in "Your sites" header | outline `sm` button, arrow 16px                                                                                      |
| 4   | `src/components/dashboard/DashboardNavigation.tsx:294`   | sidebar "Choose plan" / "Upgrade"                        | outline `sm` button                                                                                                  |
| 5   | `src/components/dashboard/SiteRow.tsx:145`               | "Continue setup" on an awaiting-install row              | outline `sm` button — same as the `EditWebsiteButton` the other rows show in that cell                               |
| 6   | `src/components/dashboard/QuickSetup.tsx:226`            | "Continue setup" in the quick-setup list                 | outline `sm` button                                                                                                  |
| 7   | `src/components/dashboard/SiteRegistrationModal.tsx:460` | "Open site page"                                         | default (primary) button, full width under `sm`, beside the outline "Close"                                          |
| 8   | `src/components/dashboard/AddEditorDialog.tsx:346`       | "View plans" in the seat-limit alert                     | outline `sm` button, `self-start`                                                                                    |
| 9   | `src/components/dashboard/site/SiteProvider.tsx:553`     | "Back to Sites" on a missing site                        | outline default button in the empty state                                                                            |
| 10  | `src/components/dashboard/SiteInstallationCard.tsx:199`  | "Installation guide"                                     | `link` variant, `sm`, `h-auto px-0`: primary colour, underline on hover, 12px medium — a link, as the call site asks |

## Follow-up found at PR review (Devin, PR #78)

A slotted native `<button>` honours `disabled`; the first fix withheld `disabled` from every
asChild child, so `<Button asChild loading><button type="submit">` stayed clickable. Button now
forwards `disabled`/`loading` to a native form control child (`button`, `input`, `select`,
`textarea`, `fieldset`) and never to a link or a component.
