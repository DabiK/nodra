// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentConfigView, MissionView, ProviderOptionsCatalog } from "../types";
import { MissionReplayDialog } from "./MissionReplayDialog";
import { duplicateMission } from "../services/mission-service";

vi.mock("../services/mission-service", () => ({
  duplicateMission: vi.fn()
}));

afterEach(cleanup);

const mission: MissionView = {
  id: "m1",
  projectId: "p1",
  title: "Mission replay",
  executionKind: "agent",
  state: "DONE",
  version: 3,
  createdAt: "2026-08-02T08:00:00Z",
  updatedAt: "2026-08-02T09:00:00Z",
  runState: null,
  runStartedAt: null,
  lastAssistantMessage: null, tagIds: []
};

const config: AgentConfigView = {
  missionId: "m1",
  version: 3,
  providerId: "opencode",
  modelId: "model-a",
  reasoningEffort: "high",
  providerOptions: { schemaVersion: 1, value: {} },
  missionPrompt: "Refactorise le module auth.",
  permissionPreset: "workspace",
  workspaceId: "ws-1",
  autoCommitAuthorized: true,
  integrationTargetRef: "refs/heads/main",
  updatedAt: "2026-08-02T09:00:00Z"
};

const catalog: ProviderOptionsCatalog = {
  providers: [
    {
      id: "opencode",
      label: "OpenCode",
      status: "ready",
      reason: null,
      models: [
        { id: "model-a", label: "Modèle A", description: "", hidden: false, isDefault: true, supportedReasoningEfforts: [], defaultReasoningEffort: "medium" },
        { id: "model-b", label: "Modèle B", description: "", hidden: false, isDefault: false, supportedReasoningEfforts: [], defaultReasoningEffort: "medium" },
        { id: "model-c", label: "Modèle C", description: "", hidden: false, isDefault: false, supportedReasoningEfforts: [], defaultReasoningEffort: "medium" }
      ]
    }
  ],
  reasoningEfforts: ["low", "medium", "high"],
  permissionPresets: ["read_only", "workspace", "full_access"],
  defaults: {
    providerId: "opencode",
    modelId: "model-a",
    reasoningEffort: "medium",
    permissionPreset: "workspace",
    providerOptions: { schemaVersion: 1, value: {} }
  }
};

const created: MissionView = {
  id: "m2",
  projectId: "p1",
  title: "Mission replay",
  executionKind: "agent",
  state: "READY",
  version: 1,
  createdAt: "2026-08-02T10:00:00Z",
  updatedAt: "2026-08-02T10:00:00Z",
  runState: null,
  runStartedAt: null,
  lastAssistantMessage: null, tagIds: []
};

function renderDialog({ onClose = vi.fn(), onReplayed = vi.fn() } = {}) {
  render(
    <MissionReplayDialog
      mission={mission}
      config={config}
      providerOptions={catalog}
      onClose={onClose}
      onReplayed={onReplayed}
    />
  );
  return { onClose, onReplayed };
}

describe("MissionReplayDialog", () => {
  it("pré-remplit le titre et affiche les réglages copiés", () => {
    renderDialog();
    expect((screen.getByRole("textbox", { name: /Titre de la copie/ }) as HTMLInputElement).value).toBe("Mission replay");
    expect(screen.getByText("REJOUER LE RUN")).toBeTruthy();
    expect(screen.getByText("OpenCode")).toBeTruthy();
    expect(screen.getByText("ws-1")).toBeTruthy();
    expect(screen.getByText("Refactorise le module auth.")).toBeTruthy();
    expect(screen.getByText(/Modèle A/)).toBeTruthy();
  });

  it("permet de varier le modèle du même provider avant de dupliquer", async () => {
    const { onReplayed } = renderDialog();
    vi.mocked(duplicateMission).mockResolvedValueOnce(created);

    const trigger = await screen.findByRole("button", { name: /Modèle \(même moteur\)/ });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: /Modèle C/ }));
    expect(screen.getByText(/Modèle C/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Dupliquer en READY/ }));
    await waitFor(() => expect(duplicateMission).toHaveBeenCalledWith(expect.objectContaining({ modelId: "model-c" })));
    await waitFor(() => expect(onReplayed).toHaveBeenCalledWith(created));
  });

  it("duplique avec le titre édité", async () => {
    const { onReplayed } = renderDialog();
    vi.mocked(duplicateMission).mockResolvedValueOnce(created);

    fireEvent.change(screen.getByRole("textbox", { name: /Titre de la copie/ }), { target: { value: "Replay auth v2" } });
    fireEvent.click(screen.getByRole("button", { name: /Dupliquer en READY/ }));

    await waitFor(() => expect(duplicateMission).toHaveBeenCalledWith(expect.objectContaining({
      title: "Replay auth v2",
      projectId: "p1",
      modelId: "model-a"
    })));
    expect(onReplayed).toHaveBeenCalledWith(created);
  });

  it("désactive le bouton et affiche l'état occupé pendant la duplication", async () => {
    let resolve!: (value: MissionView) => void;
    vi.mocked(duplicateMission).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /Dupliquer en READY/ }));
    const busyButton = screen.getByRole("button", { name: /Duplication/ });
    expect((busyButton as HTMLButtonElement).disabled).toBe(true);
    resolve(created);
  });

  it("affiche l'erreur quand la duplication échoue et réarme le bouton", async () => {
    vi.mocked(duplicateMission).mockRejectedValueOnce(new Error("Provider indisponible"));
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /Dupliquer en READY/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Provider indisponible");
    expect((screen.getByRole("button", { name: /Dupliquer en READY/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("ferme sur Annuler et sur Escape", () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ne soumet pas quand le titre est vide", () => {
    renderDialog();
    fireEvent.change(screen.getByRole("textbox", { name: /Titre de la copie/ }), { target: { value: "   " } });
    expect((screen.getByRole("button", { name: /Dupliquer en READY/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
