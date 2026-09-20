# Review — Story s14d-invited-editor-publish

Fresh-context code review against `main`, followed by a bounded re-review of the final fixes.

## Resolved findings

1. Publish POST now checks terminal HTTP status before JSON parsing, including empty or malformed
   401/403 bodies.
2. Overlapping requests cannot clear or overwrite the terminal-session status.
3. Draft recovery preserves text typed after the pending request began; the earlier submitted
   value cannot overwrite the newer DOM value in storage.
4. A terminal owner session disables the Edit Board trigger, closes/inerts any open board and
   refuses reopening.

## Verified behavior

- Only a publish/admin grant exposes Publish. View/edit permissions remain narrower.
- Save is a draft write; Publish preview GET and confirmed POST use the grant header, with no
  credential in URL or request body.
- Terminal failures preserve drafts, stop further edits/retries and offer recovery. Transient
  failures remain retryable.
- Invited-editor chrome is ignored by content discovery.
- Owner staging/edit-session behavior remains covered.

## Verification

The reviewer independently ran the full suite: 205 passed suites, 2,693 passed tests, 36 skipped.
Tests used explicit dummy credentials and a localhost app origin, not production secrets.

On the final source, neutralizing terminal handling caused 10 regression failures. The reviewer
restored the isolated copy, confirmed it matched the author's files using `git diff --no-index
--exit-code`, and reran all 12 terminal cases successfully. The author's source was untouched.

The final Node 24.14.0 artifact check reports 46,525 bytes bundle / 33,757 bytes widget, gzip
level 9, inside the unchanged ceilings. Two inert CSS comments were moved outside their template
after the review to account for Node 24 compressor differences; no CSS declaration changed.
Author separately passed both typechecks, lint (39 inherited warnings, zero
errors), formatting and production build.

## Evidence boundary

The reviewer did not operate production, deliver email or prove cross-device browser behavior.
The primary agent separately verified delivered editor email, handoff, Save remaining private,
Publish reaching a fresh visitor and baseline restoration on a real external fixture using this
candidate bundle against production APIs. Candidate interception is not deployed-widget proof.
Production release and the user's physical second-laptop test remain separate gates.

Existing expected-failure tests and skipped database cases are not a commercial-readiness pass.

Max severity: none
Ship allowed: yes
