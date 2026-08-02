// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MissionRunsView, MissionView } from "../types";
import { MissionInspector } from "./MissionInspector";
import { loadMissionRuns } from "../services/mission-service";

vi.mock("../services/mission-service", () => ({
  loadMissionInspector: vi.fn().mockResolvedValue({
    mission: {
      id: "m1",
      projectId: null,
      title: "Mission test",
      executionKind: "agent",
      state: "READY",
      version: 1,
      createdAt: "2026-08-02T08:00:00Z",
      updatedAt: "2026-08-02T09:00:00Z"
    },
    config: null,
    providerSession: null
  }),
  loadMissionRuns: vi.fn().mockRejectedValue(new Error("mock: pas de runs")),
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

describe("MissionInspector budget panel", () => {
  it("masque le panneau tant que l'historique des runs n'est pas chargé", () => {
    renderInspector();
    expect(screen.queryByLabelText("Budget et usage de la mission")).toBeNull();
  });

  it("affiche le coût total et le détail par run quand l'historique est chargé", async () => {
    const history: MissionRunsView = {
      totalCostMicros: 18_888,
      runs: [
        {
          id: "run-1",
          attempt: 1,
          state: "SUCCEEDED",
          providerId: "opencode",
          modelId: "model-a",
          startedAt: "2026-08-02T08:00:00Z",
          endedAt: "2026-08-02T08:30:00Z",
          durationMs: 1_800_000,
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          costMicros: 12_345,
          usageKind: "reported"
        },
        {
          id: "run-2",
          attempt: 2,
          state: "FAILED",
          providerId: "opencode",
          modelId: "model-a",
          startedAt: "2026-08-02T09:00:00Z",
          endedAt: "2026-08-02T09:01:00Z",
          durationMs: 60_000,
          inputTokens: 200,
          outputTokens: 100,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          costMicros: 6_543,
          usageKind: "reported"
        }
      ]
    };
    vi.mocked(loadMissionRuns).mockResolvedValueOnce(history);
    renderInspector();

    const panel = await screen.findByLabelText("Budget et usage de la mission");
    expect(panel.textContent).toContain("Total : $0.0189");
    const rows = panel.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("$0.0123");
    expect(rows[0].textContent).toContain("1,5 k tokens");
    expect(rows[0].textContent).toContain("essai 1");
    expect(rows[1].textContent).toContain("essai 2");
  });

  it("affiche l'état vide quand la mission n'a aucun run", async () => {
    vi.mocked(loadMissionRuns).mockResolvedValueOnce({ totalCostMicros: null, runs: [] });
    renderInspector();

    const panel = await screen.findByLabelText("Budget et usage de la mission");
    expect(panel.textContent).toContain("Aucun run à ce jour");
  });
});
