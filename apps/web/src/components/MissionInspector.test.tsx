// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MissionView } from "../types";
import { MissionInspector } from "./MissionInspector";

vi.mock("../services/mission-service", () => ({
  loadMissionInspector: vi.fn().mockRejectedValue(new Error("mock: pas de données")),
  updateAgentConfig: vi.fn()
}));
vi.mock("../services/mission-result-service", () => ({
  loadMissionResult: vi.fn().mockRejectedValue(new Error("mock: pas de run"))
}));
vi.mock("../services/mission-notes-service", () => ({
  loadMissionNotes: vi.fn().mockResolvedValue(""),
  saveMissionNotes: vi.fn()
}));
vi.mock("../services/worktree-service", () => ({
  showWorkspace: vi.fn()
}));
vi.mock("./WorktreeResolutionDialog", () => ({
  WorktreeResolutionDialog: () => null
}));
vi.mock("./ModelPicker", () => ({
  ModelPicker: () => null
}));

afterEach(cleanup);

const mission: MissionView = {
  id: "m1",
  projectId: null,
  title: "Mission test",
  executionKind: "agent",
  state: "READY",
  version: 1,
  createdAt: "2026-08-02T08:00:00Z",
  updatedAt: "2026-08-02T09:00:00Z"
};

function renderInspector(onClose = vi.fn()) {
  render(
    <MissionInspector
      missionId="m1"
      missions={[mission]}
      providerOptions={null}
      onClose={onClose}
      onSaved={() => undefined}
    />
  );
  return onClose;
}

describe("MissionInspector keyboard", () => {
  it("ferme la fiche avec Escape", () => {
    const onClose = renderInspector();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignore Escape pendant la saisie dans un champ", () => {
    const onClose = renderInspector();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    input.remove();
  });

  it("ignore Escape quand le model picker est ouvert", () => {
    const onClose = renderInspector();
    const picker = document.createElement("div");
    picker.className = "model-picker-backdrop";
    document.body.appendChild(picker);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    picker.remove();
  });
});
