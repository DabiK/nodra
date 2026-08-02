// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppSidebar } from "./AppSidebar";

afterEach(cleanup);

function renderSidebar(collapsed: boolean, onToggle = vi.fn(), onNavigate = vi.fn(), onSelectMission = vi.fn()) {
  render(
    <AppSidebar
      page="tasks"
      collapsed={collapsed}
      activePipelineCount={0}
      hasActiveManager={false}
      missions={[]}
      onToggle={onToggle}
      onNavigate={onNavigate}
      onSelectMission={onSelectMission}
    />
  );
  return { onToggle, onNavigate, onSelectMission };
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
});
