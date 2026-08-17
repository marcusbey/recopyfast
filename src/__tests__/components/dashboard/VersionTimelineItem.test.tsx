import { render, screen } from "@testing-library/react";
import {
  VersionTimelineItem,
  type Version,
} from "@/components/dashboard/VersionTimelineItem";

/**
 * The pill on a version row is resolved out of `versionChangeTypes` by the raw
 * `change_type` string the database stored — `VersionHistoryPanel.tsx:61` casts
 * it and passes it straight through, and `resolveStatus` falls back to
 * `manual` for any key the registry does not carry.
 *
 * The registry carried `bulk`. `content_versions.change_type` has never been
 * able to hold that value: its CHECK constraint
 * (`20251230100000_edit_board.sql:69`) lists
 * ('manual','style_apply','language_switch','theme_apply','restore','bulk_edit').
 * So every bulk snapshot — the ones story s05's import now writes — rendered as
 * "Manual edit / Saved by hand from the edit board", which is the opposite of
 * what happened. Rendered here rather than asserted against the registry
 * object, because reading the registry is what missed it the first time.
 *
 * `style_apply` was the second miss, in the other direction: a value the
 * registry lacked, live on every AI style application, and asserted *as correct*
 * by the first version of this file. See below.
 */
const version: Version = {
  id: "version-1",
  versionNumber: 4,
  createdBy: "owner@example.com",
  description: "Bulk import — 3 created, 1 updated, 0 skipped, 0 failed",
  elementsChanged: 4,
  changeType: "bulk_edit",
  createdAt: "2026-08-16T10:00:00Z",
};

describe("VersionTimelineItem", () => {
  it("labels a bulk_edit version as a bulk edit, not a manual one", () => {
    render(
      <VersionTimelineItem
        version={version}
        isFirst={false}
        isLast={false}
        onView={jest.fn()}
      />,
    );

    expect(screen.getByText("Bulk edit")).toBeInTheDocument();
    expect(screen.queryByText("Manual edit")).not.toBeInTheDocument();
  });

  /**
   * `style_apply` was the fixture for the fallback case in the first version of
   * this file, described there as "a change type this build does not know". It
   * is not unknown: `edit-board/styles/apply/route.ts:176` writes it on every AI
   * style application, so the assertion certified the identical silent
   * mislabelling that `bulk` had just been fixed for — one registry miss
   * blessed by a test.
   */
  it("labels a style_apply version as a style application, not a manual one", () => {
    render(
      <VersionTimelineItem
        version={{ ...version, changeType: "style_apply" }}
        isFirst={false}
        isLast={false}
        onView={jest.fn()}
      />,
    );

    expect(screen.getByText("Style applied")).toBeInTheDocument();
    expect(screen.queryByText("Manual edit")).not.toBeInTheDocument();
  });

  /**
   * The fallback still needs proving, so it needs a value no writer can produce
   * and the column can never hold — not one of the six the CHECK admits.
   * `language_switch` and `theme_apply` are the other two the registry does not
   * carry, and they are deliberately not used here: `server/index.js:810`
   * and `:983` write both, so a fixture built on either would recreate exactly
   * the trap this file exists to close. That service is undeployed today, which
   * is the only reason those two are not live defects — `s07b` changes that.
   */
  it("still falls back to manual for a change type nothing can write", () => {
    render(
      <VersionTimelineItem
        version={{
          ...version,
          changeType: "not-a-change-type" as Version["changeType"],
        }}
        isFirst={false}
        isLast={false}
        onView={jest.fn()}
      />,
    );

    expect(screen.getByText("Manual edit")).toBeInTheDocument();
  });
});
