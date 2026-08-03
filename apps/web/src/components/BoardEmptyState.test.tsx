// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MISSION_TEMPLATES } from "../services/mission-template-service";
import { BoardEmptyState } from "./BoardEmptyState";

afterEach(cleanup);

describe("BoardEmptyState", () => {
  it("affiche le titre, le CTA de création et les 3 modèles", () => {
    render(<BoardEmptyState templates={MISSION_TEMPLATES} busyTemplateId={null} onTemplate={vi.fn()} onCreateMission={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Aucune mission pour l'instant" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "＋ Confier une tâche" })).toBeTruthy();
    for (const template of MISSION_TEMPLATES) {
      expect(screen.getByText(template.label)).toBeTruthy();
      expect(screen.getByText(template.description)).toBeTruthy();
      expect(screen.getAllByText("Créer en 1 clic →")).toHaveLength(3);
    }
  });

  it("déclenche la création de mission sur le CTA principal", () => {
    const onCreateMission = vi.fn();
    render(<BoardEmptyState templates={MISSION_TEMPLATES} busyTemplateId={null} onTemplate={vi.fn()} onCreateMission={onCreateMission} />);
    fireEvent.click(screen.getByRole("button", { name: "＋ Confier une tâche" }));
    expect(onCreateMission).toHaveBeenCalledTimes(1);
  });

  it("crée une mission depuis un modèle en 1 clic", () => {
    const onTemplate = vi.fn();
    render(<BoardEmptyState templates={MISSION_TEMPLATES} busyTemplateId={null} onTemplate={onTemplate} onCreateMission={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Refactorer/ }));
    expect(onTemplate).toHaveBeenCalledWith(MISSION_TEMPLATES[0]);
  });

  it("désactive toutes les cartes pendant une création en cours et affiche l'état", () => {
    render(<BoardEmptyState templates={MISSION_TEMPLATES} busyTemplateId="test" onTemplate={vi.fn()} onCreateMission={vi.fn()} />);
    const cards = screen.getAllByRole("button", { name: /Création…|Créer en 1 clic/ });
    expect(cards).toHaveLength(3);
    for (const card of cards) expect((card as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Création…")).toBeTruthy();
  });
});
