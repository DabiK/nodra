// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConversationSearchBar, type ConversationSearchBarProps } from "./ConversationSearchBar";

afterEach(() => { cleanup(); });

function renderBar(overrides: Partial<ConversationSearchBarProps> = {}) {
  const props: ConversationSearchBarProps = {
    query: "test",
    matchCount: 3,
    current: 0,
    onQueryChange: vi.fn(),
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };
  render(<ConversationSearchBar {...props} />);
  return props;
}

describe("ConversationSearchBar", () => {
  it("renders a searchbox with the current query and reports typing", () => {
    const props = renderBar();
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    expect(input.value).toBe("test");
    fireEvent.change(input, { target: { value: "plan" } });
    expect(props.onQueryChange).toHaveBeenCalledWith("plan");
  });

  it("shows the occurrence counter as current / total", () => {
    renderBar({ matchCount: 7, current: 2 });
    expect(screen.getByRole("status", { name: "Occurrences" }).textContent).toBe("3 / 7");
  });

  it("shows the absence of results without crashing the counter", () => {
    renderBar({ matchCount: 0 });
    expect(screen.getByRole("status", { name: "Occurrences" }).textContent).toBe("Aucun résultat");
  });

  it("hides the counter while the query is empty", () => {
    renderBar({ query: "", matchCount: 0 });
    expect(screen.getByRole("status", { name: "Occurrences" }).textContent).toBe("");
  });

  it("navigates with Enter (next) and Shift+Enter (previous)", () => {
    const props = renderBar();
    const input = screen.getByRole("searchbox");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onNext).toHaveBeenCalledTimes(1);
    expect(props.onPrev).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(props.onPrev).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const props = renderBar();
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("disables navigation buttons when there are no matches", () => {
    renderBar({ matchCount: 0 });
    expect((screen.getByRole("button", { name: /Occurrence précédente/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Occurrence suivante/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Fermer la recherche/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("navigates through the explicit buttons", () => {
    const props = renderBar();
    fireEvent.click(screen.getByRole("button", { name: /Occurrence suivante/ }));
    fireEvent.click(screen.getByRole("button", { name: /Occurrence précédente/ }));
    fireEvent.click(screen.getByRole("button", { name: /Fermer la recherche/ }));
    expect(props.onNext).toHaveBeenCalledTimes(1);
    expect(props.onPrev).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
