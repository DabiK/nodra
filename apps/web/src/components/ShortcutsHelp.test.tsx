// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ShortcutsHelp } from "./ShortcutsHelp";

afterEach(cleanup);

describe("ShortcutsHelp", () => {
  it("ne rend rien quand fermée", () => {
    render(<ShortcutsHelp open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("rend un dialog accessible documentant les raccourcis", () => {
    render(<ShortcutsHelp open onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Raccourcis clavier" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("⌘ K / Ctrl K")).toBeDefined();
    expect(screen.getByText("← / →")).toBeDefined();
    expect(screen.getAllByText(/palette de commandes/i).length).toBeGreaterThan(0);
  });

  it("ferme avec Escape", () => {
    const onClose = vi.fn();
    render(<ShortcutsHelp open onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ferme au clic sur le bouton ×", () => {
    const onClose = vi.fn();
    render(<ShortcutsHelp open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Fermer l'aide" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ferme en cliquant le fond", () => {
    const onClose = vi.fn();
    render(<ShortcutsHelp open onClose={onClose} />);
    const backdrop = document.querySelector(".help-backdrop")!;
    fireEvent.mouseDown(backdrop, { target: backdrop });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
