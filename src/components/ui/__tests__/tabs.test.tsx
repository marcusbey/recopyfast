/**
 * `Tabs` — underline style from s66a (design system, Controls).
 *
 * The segmented-pill list scrolled sideways behind a hidden scrollbar, so on
 * Settings at 375 px two of five tabs were simply invisible, with nothing to
 * say they existed (s66 research, fact 6). The list now wraps instead.
 */

import { render, screen } from "@testing-library/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function renderTabs() {
  return render(
    <Tabs defaultValue="profile">
      <TabsList aria-label="Settings sections">
        {["profile", "notifications", "security", "api", "appearance"].map(
          (value) => (
            <TabsTrigger key={value} value={value}>
              {value}
            </TabsTrigger>
          ),
        )}
      </TabsList>
      <TabsContent value="profile">Profile panel</TabsContent>
    </Tabs>,
  );
}

describe("Tabs", () => {
  it("draws the list as an underline that wraps rather than clips", () => {
    renderTabs();
    const list = screen.getByRole("tablist");

    expect(list).toHaveClass("border-b", "flex-wrap");
    expect(list.className).not.toContain("overflow-x-auto");
    expect(list.className).not.toContain("[scrollbar-width:none]");
    expect(list.className).not.toContain("[&::-webkit-scrollbar]:hidden");
    expect(list.className).not.toMatch(/rounded-(sm|md|lg|xl)/);
  });

  it("marks the active trigger with a 2px primary underline, square", () => {
    renderTabs();
    const active = screen.getByRole("tab", { name: "profile" });

    expect(active).toHaveAttribute("aria-selected", "true");
    expect(active).toHaveClass(
      "h-10",
      "border-b-2",
      "rounded-none",
      "data-[state=active]:border-primary",
      "data-[state=active]:text-foreground",
    );
    expect(active.className).not.toMatch(/rounded-(sm|md|lg|xl)/);
  });

  it("keeps roles and names, so suites that query tabs are unaffected", () => {
    renderTabs();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Profile panel");
  });
});
