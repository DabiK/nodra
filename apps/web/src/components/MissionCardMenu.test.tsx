// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MissionView } from "../types";
import { MissionCardMenu } from "./MissionCardMenu";
import { getAgentConfig } from "../services/mission-service";
import { loadMissionProviderSession } from "../services/mission-provider-session-service";
import { loadMissionResult } from "../services/mission-result-service";
import { performMissionAction } from "../services/mission-action-service";

vi.mock("../services/mission-service", () => ({
  getAgentConfig: vi.fn()
}));
vi.mock("../services/mission-provider-session-service", () => ({
  loadMissionProviderSession: vi.fn()
}));
vi.mock("../services/mission-result-service", () => ({
  loadMissionResult: vi.fn()
}));
vi.mock("../services/mission-action-service", () => ({
  performMissionAction: vi.fn()
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mission(overrides: Partial<MissionView> & Pick<MissionView, "id" | "title" | "executionKind" | "state">): MissionView {
  return {
    projectId: null,
    version: 2,
    createdAt: "2026-01-01T10:00:00Z",
    updatedAt: "2026-01-01T10:00:00Z",
    runState: null,
    runStartedAt: null,
    lastAssistantMessage: null,
    ...overrides
  };
}

const emptyResult = {
  latestRunId: null,
  latestRunState: null,
  delivery: null,
  assistantMessage: null,
  hasStructuredDelivery: false,
  failure: null
};

function renderMenu(overrides: { mission?: MissionView; onClose?: () => void; onInspect?: () => void; onActionApplied?: (label: string) => void } = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const onInspect = overrides.onInspect ?? vi.fn();
  const onActionApplied = overrides.onActionApplied ?? vi.fn();
  render(
    <MissionCardMenu
      mission={overrides.mission ?? mission({ id: "m-agent", title: "Menu task", executionKind: "agent", state: "READY" })}
      anchor={{ x: 300, y: 100 }}
      onClose={onClose}
      onInspect={onInspect}
      onActionApplied={onActionApplied}
    />
  );
  return { onClose, onInspect, onActionApplied };
}

describe("MissionCardMenu", () => {
  it("shows a loading state then the policy actions of the mission", async () => {
    vi.mocked(getAgentConfig).mockResolvedValue({
      missionId: "m-agent", version: 1, providerId: "opencode", modelId: "x", reasoningEffort: "high",
      permissionPreset: "workspace", missionPrompt: "Fais le travail", workspaceId: "ws-1",
      autoCommitAuthorized: false, integrationTargetRef: null,
      providerOptions: { schemaVersion: 1, value: {} }, updatedAt: ""
    });
    vi.mocked(loadMissionProviderSession).mockResolvedValue(null as never);
    vi.mocked(loadMissionResult).mockResolvedValue(emptyResult);
    renderMenu();

    expect(screen.getByText("Chargement des actions…")).toBeTruthy();
    expect(await screen.findByRole("menuitem", { name: "Lancer →" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Abandonner" })).toBeTruthy();
    expect(screen.getByText("Menu task")).toBeTruthy();
    expect(screen.getByText(/Prête/)).toBeTruthy();
  });

  it("disables an action and exposes the reason when the agent has no config", async () => {
    vi.mocked(getAgentConfig).mockResolvedValue(null as never);
    vi.mocked(loadMissionProviderSession).mockResolvedValue(null as never);
    vi.mocked(loadMissionResult).mockResolvedValue(emptyResult);
    renderMenu();

    const launch = await screen.findByRole("menuitem", { name: "Lancer →" });
    expect((launch as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTitle("Configuration agent manquante")).toBeTruthy();
  });

  it("offers delivery actions only when a structured delivery exists", async () => {
    vi.mocked(getAgentConfig).mockResolvedValue(null as never);
    vi.mocked(loadMissionProviderSession).mockResolvedValue(null as never);
    vi.mocked(loadMissionResult).mockResolvedValue({
      ...emptyResult,
      latestRunId: "run-1",
      hasStructuredDelivery: true
    });
    renderMenu({ mission: mission({ id: "m-val", title: "Validation task", executionKind: "agent", state: "VALIDATION" }) });

    expect(await screen.findByRole("menuitem", { name: "Valider ✓" })).toBeTruthy();
    expect((screen.getByRole("menuitem", { name: "Accepter (delivery)" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("menuitem", { name: "Demander corrections" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("routes « Configurer » to the mission inspector instead of an endpoint", async () => {
    vi.mocked(getAgentConfig).mockResolvedValue({} as never);
    vi.mocked(loadMissionProviderSession).mockResolvedValue(null as never);
    vi.mocked(loadMissionResult).mockResolvedValue(emptyResult);
    const { onClose, onInspect } = renderMenu({
      mission: mission({ id: "m-draft", title: "Draft task", executionKind: "agent", state: "DRAFT" })
    });

    fireEvent.click(await screen.findByRole("menuitem", { name: "Configurer" }));
    expect(onInspect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(performMissionAction).not.toHaveBeenCalled();
  });

  it("executes an action with the run context, closes and reports the applied label", async () => {
    vi.mocked(getAgentConfig).mockResolvedValue(null as never);
    vi.mocked(loadMissionProviderSession).mockResolvedValue(null as never);
    vi.mocked(loadMissionResult).mockResolvedValue({
      ...emptyResult,
      latestRunId: "run-9",
      assistantMessage: "Résultat produit"
    });
    vi.mocked(performMissionAction).mockResolvedValue({} as never);
    const { onClose, onActionApplied } = renderMenu();

    fireEvent.click(await screen.findByRole("menuitem", { name: "Abandonner" }));
    expect(performMissionAction).toHaveBeenCalledWith({
      actionId: "abandon",
      mission: expect.objectContaining({ id: "m-agent", version: 2 }),
      latestRunId: "run-9",
      declaredResult: "Résultat produit"
    });
    await waitFor(() => expect(onActionApplied).toHaveBeenCalledWith("Abandonner"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the menu open with an inline error when an action fails", async () => {
    vi.mocked(getAgentConfig).mockResolvedValue(null as never);
    vi.mocked(loadMissionProviderSession).mockResolvedValue(null as never);
    vi.mocked(loadMissionResult).mockResolvedValue(emptyResult);
    vi.mocked(performMissionAction).mockRejectedValue(new Error("Conflit de version"));
    const { onClose, onActionApplied } = renderMenu();

    fireEvent.click(await screen.findByRole("menuitem", { name: "Abandonner" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Conflit de version");
    expect(onClose).not.toHaveBeenCalled();
    expect(onActionApplied).not.toHaveBeenCalled();
    // L'item redevient cliquable pour réessayer une autre action.
    expect((screen.getByRole("menuitem", { name: "Abandonner" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("closes on Escape", async () => {
    vi.mocked(getAgentConfig).mockResolvedValue(null as never);
    vi.mocked(loadMissionProviderSession).mockResolvedValue(null as never);
    vi.mocked(loadMissionResult).mockResolvedValue(emptyResult);
    const { onClose } = renderMenu();
    await screen.findByRole("menuitem", { name: "Abandonner" });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked", async () => {
    vi.mocked(getAgentConfig).mockResolvedValue(null as never);
    vi.mocked(loadMissionProviderSession).mockResolvedValue(null as never);
    vi.mocked(loadMissionResult).mockResolvedValue(emptyResult);
    const { onClose } = renderMenu();
    await screen.findByRole("menuitem", { name: "Abandonner" });

    fireEvent.click(document.querySelector(".card-menu-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("navigates between enabled items with ArrowDown and ArrowUp", async () => {
    renderMenu({ mission: mission({ id: "m-human", title: "Human task", executionKind: "human", state: "READY" }) });
    const menu = await screen.findByRole("menu");

    const pickup = screen.getByRole("menuitem", { name: "Prendre en charge" });
    const complete = screen.getByRole("menuitem", { name: "Terminer" });
    const abandon = screen.getByRole("menuitem", { name: "Abandonner" });
    // Le focus démarre sur le premier élément actif.
    await waitFor(() => expect(document.activeElement).toBe(pickup));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(complete);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(abandon);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(pickup);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(abandon);
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(pickup);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(abandon);
  });

  it("shows an empty-state message when the policy has no action for the state", async () => {
    renderMenu({ mission: mission({ id: "m-done", title: "Done task", executionKind: "human", state: "DONE" }) });
    expect(await screen.findByText("Aucune action disponible pour cet état.")).toBeTruthy();
    expect(getAgentConfig).not.toHaveBeenCalled();
  });
});
