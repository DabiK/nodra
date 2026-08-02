// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { buildPaletteCommands, type PaletteCommand } from "../services/palette-service";
import type { MissionView, PipelineListItem } from "../types";

afterEach(cleanup);

function commands(): PaletteCommand[] {
  return buildPaletteCommands({
    page: "tasks",
    missions: [
      { id: "m1", projectId: null, title: "Refonte API", executionKind: "agent", state: "VALIDATION", version: 1, createdAt: "2026-08-02T08:00:00Z", updatedAt: "2026-08-02T09:00:00Z" } as MissionView,
      { id: "m2", projectId: null, title: "Doc utilisateur", executionKind: "human", state: "READY", version: 1, createdAt: "2026-08-02T08:00:00Z", updatedAt: "2026-08-02T09:00:00Z" } as MissionView
    ],
    pipelines: [{ id: "p1", name: "Release", state: "active", createdAt: "", runId: null, runState: null, startedAt: null, endedAt: null, nodes: [], edges: [] } as PipelineListItem]
  });
}

function renderPalette(overrides: Partial<{ open: boolean; status: string; onClose: () => void; onSelect: (command: PaletteCommand) => void }> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const onSelect = overrides.onSelect ?? vi.fn();
  render(
    <CommandPalette
      open={overrides.open ?? true}
      commands={commands()}
      status={overrides.status ?? ""}
      onClose={onClose}
      onSelect={onSelect}
    />
  );
  return { onClose, onSelect };
}

describe("CommandPalette", () => {
  it("rend le dialog accessible avec listbox et options sélectionnables", () => {
    renderPalette();
    const dialog = screen.getByRole("dialog", { name: "Palette de commandes" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Rechercher une commande" })).toBeDefined();
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(5);
    expect(options.filter((option) => option.getAttribute("aria-selected") === "true").length).toBe(1);
  });

  it("ne rend rien quand fermée", () => {
    renderPalette({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("filtre les commandes pendant la saisie", () => {
    renderPalette();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "delivery" } });
    const options = screen.getAllByRole("option");
    expect(options.length).toBe(1);
    expect(options[0].textContent).toContain("Accepter la delivery");
  });

  it("sélectionne avec Entrée la commande active", () => {
    const { onSelect } = renderPalette();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pipelines" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    const selected = (onSelect as ReturnType<typeof vi.fn>).mock.calls[0][0] as PaletteCommand;
    expect(selected.action).toEqual({ kind: "navigate", page: "pipelines" });
  });

  it("navigue avec les flèches et rembobine en haut avec Home", () => {
    renderPalette();
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    const selected = screen.getAllByRole("option").filter((option) => option.getAttribute("aria-selected") === "true");
    expect(selected[0].textContent).toContain("Aller aux Managers");
    fireEvent.keyDown(dialog, { key: "Home" });
    const first = screen.getAllByRole("option").filter((option) => option.getAttribute("aria-selected") === "true");
    expect(first[0].textContent).toContain("Aller aux Tâches");
  });

  it("ferme avec Escape", () => {
    const { onClose } = renderPalette();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ferme en cliquant le fond", () => {
    const { onClose } = renderPalette();
    const backdrop = document.querySelector(".palette-backdrop")!;
    fireEvent.mouseDown(backdrop, { target: backdrop });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("exécute la commande au clic sur une option", () => {
    const { onSelect } = renderPalette();
    fireEvent.click(screen.getByRole("option", { name: /Aller aux Managers/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("affiche le statut en pied de palette", () => {
    renderPalette({ status: "✓ Run démarré · Release" });
    expect(screen.getByText("✓ Run démarré · Release")).toBeDefined();
  });

  it("affiche un état vide quand rien ne correspond", () => {
    renderPalette();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzzz-inexistant" } });
    expect(screen.getByText(/Aucune commande ne correspond/)).toBeDefined();
  });

  it("déplace le focus vers le champ de recherche à l'ouverture", () => {
    renderPalette();
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
  });
});
