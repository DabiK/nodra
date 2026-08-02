// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentConfigView, MissionRunsView, MissionView } from "../types";
import { MissionExportDialog, copyToClipboard, downloadMarkdown } from "./MissionExportDialog";
import { loadMissionAudit } from "../services/mission-audit-service";
import { loadRunEvidence } from "../services/evidence-service";
import { loadMissionNotes } from "../services/mission-notes-service";

vi.mock("../services/mission-audit-service", () => ({
  loadMissionAudit: vi.fn().mockResolvedValue([
    {
      id: "audit/1",
      commandId: "cmd-1",
      eventType: "MISSION_PREPARED",
      actor: "user",
      payload: { fromState: "BACKLOG", toState: "READY" },
      occurredAt: "2026-08-02T08:30:00Z"
    }
  ])
}));
vi.mock("../services/evidence-service", () => ({
  loadRunEvidence: vi.fn().mockResolvedValue([])
}));
vi.mock("../services/mission-notes-service", () => ({
  loadMissionNotes: vi.fn().mockReturnValue("Notes de test")
}));

afterEach(cleanup);

const mission: MissionView = {
  id: "m1",
  projectId: null,
  title: "Mission export",
  executionKind: "agent",
  state: "READY",
  version: 1,
  createdAt: "2026-08-02T08:00:00Z",
  updatedAt: "2026-08-02T09:00:00Z",
  runState: null,
  runStartedAt: null,
  lastAssistantMessage: null
};

const config: AgentConfigView = {
  missionId: "m1",
  version: 1,
  providerId: "opencode",
  modelId: "model-a",
  reasoningEffort: "high",
  providerOptions: { schemaVersion: 1, value: {} },
  missionPrompt: "Traite la mission.",
  permissionPreset: "workspace",
  workspaceId: "ws-1",
  autoCommitAuthorized: false,
  integrationTargetRef: null,
  updatedAt: "2026-08-02T08:30:00Z"
};

const runs: MissionRunsView = { totalCostMicros: null, runs: [] };

function renderDialog(onClose = vi.fn()) {
  render(
    <MissionExportDialog
      mission={mission}
      config={config}
      result={null}
      runs={runs}
      onClose={onClose}
    />
  );
  return onClose;
}

describe("MissionExportDialog", () => {
  it("charge l'audit et les notes puis prévisualise le Markdown rendu", async () => {
    renderDialog();
    const preview = await screen.findByText("Mission : Mission export", { selector: "h1" });
    expect(preview).toBeTruthy();
    expect(await screen.findByText("Notes de test")).toBeTruthy();
    expect(loadMissionAudit).toHaveBeenCalledWith("m1");
    expect(loadMissionNotes).toHaveBeenCalledWith("m1");
    // La timeline d'audit est rendue dans la prévisualisation.
    expect(await screen.findByText("Mise en file (BACKLOG → READY)")).toBeTruthy();
  });

  it("charge les preuves quand le dernier run existe", async () => {
    render(
      <MissionExportDialog
        mission={mission}
        config={config}
        result={{ latestRunId: "run-1", latestRunState: "SUCCEEDED", delivery: null, assistantMessage: "Résultat", hasStructuredDelivery: false, failure: null }}
        runs={runs}
        onClose={vi.fn()}
      />
    );
    await screen.findByRole("dialog");
    await vi.waitFor(() => expect(loadRunEvidence).toHaveBeenCalledWith("run-1"));
  });

  it("copie le Markdown dans le presse-papier", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderDialog();
    await screen.findByText("Notes de test");
    fireEvent.click(screen.getByRole("button", { name: "Copier" }));
    expect(await screen.findByText("Markdown copié dans le presse-papier.")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("# Mission : Mission export"));
  });

  it("télécharge un fichier .md", async () => {
    const click = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    renderDialog();
    await screen.findByText("Notes de test");
    fireEvent.click(screen.getByRole("button", { name: "Télécharger .md" }));
    await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(revoke).toHaveBeenCalledWith("blob:mock");
  });
});

describe("export helpers", () => {
  it("copyToClipboard utilise navigator.clipboard quand disponible", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    expect(await copyToClipboard("texte")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("texte");
  });

  it("downloadMarkdown crée un lien de téléchargement", () => {
    const click = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    downloadMarkdown("mission.md", "# titre");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalled();
  });
});
