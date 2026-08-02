// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppSidebar } from "./AppSidebar";

afterEach(cleanup);

function renderSidebar(collapsed: boolean, onToggle = vi.fn(), onNavigate = vi.fn(), onSelectMission = vi.fn(), onThemeToggle = vi.fn(), onQueryChange = vi.fn()) {
  render(
    <AppSidebar
      page="tasks"
      collapsed={collapsed}
      theme="light"
      activePipelineCount={0}
      hasActiveManager={false}
      missions={[]}
      query=""
      onQueryChange={onQueryChange}
      onToggle={onToggle}
      onNavigate={onNavigate}
      onSelectMission={onSelectMission}
      onThemeToggle={onThemeToggle}
    />
  );
  return { onToggle, onNavigate, onSelectMission, onThemeToggle, onQueryChange };
}

describe("AppSidebar", () => {
  it("exposes an accessible toggle button when expanded", () => {
    renderSidebar(false);
    const toggle = screen.getByRole("button", { name: "Replier la barre latérale" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe("sidebar-nav");
  });

  it("reflects the collapsed state in the toggle's aria attributes and label", () => {
    renderSidebar(true);
    const toggle = screen.getByRole("button", { name: "Déplier la barre latérale" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("calls onToggle when the collapse button is activated", () => {
    const { onToggle } = renderSidebar(false);
    fireEvent.click(screen.getByRole("button", { name: "Replier la barre latérale" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps navigation reachable (labels + icons) when collapsed", () => {
    const { onNavigate } = renderSidebar(true);
    // Labels remain in the DOM (hidden by CSS only) so nav stays keyboard-usable.
    fireEvent.click(screen.getByRole("link", { name: /Pipelines/ }));
    expect(onNavigate).toHaveBeenCalledWith("pipelines");
  });

  it("navigates to the provider sessions observatory", () => {
    const { onNavigate } = renderSidebar(false);
    fireEvent.click(screen.getByRole("link", { name: /Sessions provider/ }));
    expect(onNavigate).toHaveBeenCalledWith("provider-sessions");
  });

  it("exposes the theme toggle with the opposite action label", () => {
    renderSidebar(false);
    // In light mode the toggle offers the dark mode.
    expect(screen.getByRole("button", { name: "Passer en mode sombre" })).toBeTruthy();
  });

  it("calls onThemeToggle when activated", () => {
    const { onThemeToggle } = renderSidebar(false);
    fireEvent.click(screen.getByRole("button", { name: "Passer en mode sombre" }));
    expect(onThemeToggle).toHaveBeenCalledTimes(1);
  });

  it("renders the mission search input with the current query", () => {
    render(
      <AppSidebar
        page="tasks"
        collapsed={false}
        theme="light"
        activePipelineCount={0}
        hasActiveManager={false}
        missions={[]}
        query="paiement"
        onQueryChange={vi.fn()}
        onToggle={vi.fn()}
        onNavigate={vi.fn()}
        onSelectMission={vi.fn()}
        onThemeToggle={vi.fn()}
      />
    );
    const input = screen.getByRole("searchbox", { name: "Rechercher dans les missions" });
    expect((input as HTMLInputElement).value).toBe("paiement");
  });

  it("forwards typed queries through onQueryChange", () => {
    const { onQueryChange } = renderSidebar(false);
    const input = screen.getByRole("searchbox", { name: "Rechercher dans les missions" });
    fireEvent.change(input, { target: { value: "stripe" } });
    expect(onQueryChange).toHaveBeenCalledWith("stripe");
  });

  it("keeps the search input in the DOM when collapsed (hidden by CSS)", () => {
    renderSidebar(true);
    expect(screen.getByRole("searchbox", { name: "Rechercher dans les missions" })).toBeTruthy();
  });
});
