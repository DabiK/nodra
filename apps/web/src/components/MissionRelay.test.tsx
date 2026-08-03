// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MissionState, MissionView } from "../types";
import { MissionRelay } from "./MissionRelay";
import { performMissionAction } from "../services/mission-action-service";

// Services chargés paresseusement par le menu contextuel des cartes (issue #19).
vi.mock("../services/mission-service", () => ({
  getAgentConfig: vi.fn().mockResolvedValue(null)
}));
vi.mock("../services/mission-provider-session-service", () => ({
  loadMissionProviderSession: vi.fn().mockResolvedValue(null)
}));
vi.mock("../services/mission-result-service", () => ({
  loadMissionResult: vi.fn().mockResolvedValue({
    latestRunId: null,
    latestRunState: null,
    delivery: null,
    assistantMessage: null,
    hasStructuredDelivery: false,
    failure: null
  })
}));
vi.mock("../services/mission-action-service", () => ({
  performMissionAction: vi.fn().mockResolvedValue({})
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

const noop = () => undefined;

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

const agentMission = mission({ id: "m-agent", title: "Agent task", executionKind: "agent", state: "READY" });
const humanMission = mission({ id: "m-human", title: "Human task", executionKind: "human", state: "READY" });

function renderRelay(overrides: Partial<Parameters<typeof MissionRelay>[0]> = {}) {
  render(
    <MissionRelay
      missions={[agentMission, humanMission]}
      onInspect={noop}
      onOpenPipeline={noop}
      onNewTask={noop}
      {...overrides}
    />
  );
}

function renderWithLanes(columns: MissionState[], missions: MissionView[], onTransition = vi.fn()) {
  localStorage.setItem("nodra.board.columns", JSON.stringify(columns));
  render(
    <MissionRelay
      missions={missions}
      onInspect={noop}
      onOpenPipeline={noop}
      onNewTask={noop}
      onTransition={onTransition}
    />
  );
  return onTransition;
}

const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };

function dragCard(title: string, laneLabel: string) {
  fireEvent.dragStart(screen.getByRole("button", { name: `Ouvrir ${title}` }), { dataTransfer });
  const lane = screen.getByLabelText(laneLabel);
  fireEvent.dragOver(lane, { dataTransfer });
  fireEvent.drop(lane, { dataTransfer });
  return lane;
}

describe("MissionRelay filters", () => {
  it("shows agent and human missions when kindFilter is all", () => {
    renderRelay({ kindFilter: "all" });
    expect(screen.getByText("Agent task")).toBeTruthy();
    expect(screen.getByText("Human task")).toBeTruthy();
  });

  it("hides human missions when kindFilter is agent", () => {
    renderRelay({ kindFilter: "agent" });
    expect(screen.getByText("Agent task")).toBeTruthy();
    expect(screen.queryByText("Human task")).toBeNull();
  });

  it("hides agent missions when kindFilter is human", () => {
    renderRelay({ kindFilter: "human" });
    expect(screen.queryByText("Agent task")).toBeNull();
    expect(screen.getByText("Human task")).toBeTruthy();
  });

  it("only shows the lane matching stateFilter", () => {
    const activeMission = mission({ id: "m-active", title: "Active task", executionKind: "agent", state: "ACTIVE" });
    render(
      <MissionRelay
        missions={[agentMission, activeMission]}
        kindFilter="all"
        stateFilter="ACTIVE"
        onInspect={noop}
        onOpenPipeline={noop}
        onNewTask={noop}
      />
    );
    expect(screen.queryByText("Agent task")).toBeNull();
    expect(screen.getByText("Active task")).toBeTruthy();
  });
});

describe("MissionRelay drag & drop", () => {
  it("moves a human READY card to ACTIVE when dropped on the active lane", () => {
    const onTransition = renderWithLanes(["READY", "ACTIVE"], [humanMission]);
    dragCard("Human task", "Ça bosse");
    expect(onTransition).toHaveBeenCalledWith(humanMission, "ACTIVE");
  });

  it("closes a human mission when dropped on the DONE lane", () => {
    const onTransition = renderWithLanes(["READY", "DONE"], [humanMission]);
    dragCard("Human task", "Terminées");
    expect(onTransition).toHaveBeenCalledWith(humanMission, "DONE");
  });

  it("validates an agent mission when dropped on the DONE lane", () => {
    const validationMission = mission({ id: "m-validation", title: "Validation task", executionKind: "agent", state: "VALIDATION" });
    const onTransition = renderWithLanes(["VALIDATION", "DONE"], [validationMission]);
    dragCard("Validation task", "Terminées");
    expect(onTransition).toHaveBeenCalledWith(validationMission, "DONE");
  });

  it("rejects a drop that starts an agent mission (READY to ACTIVE)", () => {
    const onTransition = renderWithLanes(["READY", "ACTIVE"], [agentMission]);
    dragCard("Agent task", "Ça bosse");
    expect(onTransition).not.toHaveBeenCalled();
  });

  it("rejects a drop on the card's own lane", () => {
    const onTransition = renderWithLanes(["READY", "ACTIVE"], [humanMission]);
    dragCard("Human task", "Prêtes");
    expect(onTransition).not.toHaveBeenCalled();
  });

  it("highlights an allowed drop lane and forbids an invalid one", () => {
    renderWithLanes(["READY", "ACTIVE", "VALIDATION"], [humanMission]);
    fireEvent.dragStart(screen.getByRole("button", { name: "Ouvrir Human task" }), { dataTransfer });
    const activeLane = screen.getByLabelText("Ça bosse");
    fireEvent.dragOver(activeLane, { dataTransfer });
    expect(activeLane.classList.contains("drop-allowed")).toBe(true);
    const validationLane = screen.getByLabelText("À valider");
    fireEvent.dragOver(validationLane, { dataTransfer });
    expect(validationLane.classList.contains("drop-forbidden")).toBe(true);
  });
});

describe("MissionRelay keyboard navigation", () => {
  function focusFirstCard(title: string) {
    const card = screen.getByRole("button", { name: `Ouvrir ${title}` });
    card.focus();
    return card;
  }

  it("moves focus to the first card of the next lane with ArrowRight", () => {
    renderWithLanes(["READY", "ACTIVE"], [humanMission, mission({ id: "m-active", title: "Active task", executionKind: "agent", state: "ACTIVE" })]);
    focusFirstCard("Human task");
    fireEvent.keyDown(screen.getByLabelText("Prêtes"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ouvrir Active task" }));
  });

  it("moves focus to the previous lane with ArrowLeft", () => {
    renderWithLanes(["READY", "ACTIVE", "VALIDATION"], [
      humanMission,
      mission({ id: "m-active", title: "Active task", executionKind: "agent", state: "ACTIVE" }),
      mission({ id: "m-validation", title: "Validation task", executionKind: "agent", state: "VALIDATION" })
    ]);
    focusFirstCard("Validation task");
    fireEvent.keyDown(screen.getByLabelText("À valider"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ouvrir Active task" }));
  });

  it("wraps around to the first lane after the last one", () => {
    renderWithLanes(["READY", "ACTIVE"], [humanMission, mission({ id: "m-active", title: "Active task", executionKind: "agent", state: "ACTIVE" })]);
    focusFirstCard("Active task");
    fireEvent.keyDown(screen.getByLabelText("Ça bosse"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ouvrir Human task" }));
  });

  it("skips empty lanes when moving between columns", () => {
    renderWithLanes(["READY", "ACTIVE", "VALIDATION"], [humanMission, mission({ id: "m-validation", title: "Validation task", executionKind: "agent", state: "VALIDATION" })]);
    focusFirstCard("Human task");
    fireEvent.keyDown(screen.getByLabelText("Prêtes"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ouvrir Validation task" }));
  });

  it("does not hijack arrows typed inside inputs", () => {
    renderWithLanes(["READY", "ACTIVE"], [humanMission, mission({ id: "m-active", title: "Active task", executionKind: "agent", state: "ACTIVE" })]);
    const relay = document.querySelector(".task-relay")!;
    const input = document.createElement("input");
    relay.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(document.activeElement).toBe(input);
  });
});

describe("MissionRelay live run mini-cards", () => {
  it("shows thinking dots, run state and last assistant message on an ACTIVE running card", () => {
    renderWithLanes(["ACTIVE"], [
      mission({
        id: "m-live",
        title: "Live task",
        executionKind: "agent",
        state: "ACTIVE",
        runState: "RUNNING",
        runStartedAt: "2026-08-02T10:00:00Z",
        lastAssistantMessage: "J'analyse le code de la route /api/missions avant de proposer une refonte."
      })
    ]);
    const status = screen.getByRole("status", { name: "Activité du run en cours" });
    expect(status.querySelectorAll(".thinking-dots i").length).toBe(3);
    expect(status.textContent).toContain("réfléchit");
    expect(status.textContent).toContain("J'analyse le code");
    expect(screen.queryByText("Travaille maintenant")).toBeNull();
  });

  it("shows thinking dots without a message while the run has not produced output yet", () => {
    renderWithLanes(["ACTIVE"], [
      mission({ id: "m-live", title: "Live task", executionKind: "agent", state: "ACTIVE", runState: "STARTING", runStartedAt: "2026-08-02T10:00:00Z" })
    ]);
    const status = screen.getByRole("status", { name: "Activité du run en cours" });
    expect(status.textContent).toContain("démarre");
    expect(status.textContent).not.toContain("«");
  });

  it("labels a run waiting for human approval", () => {
    renderWithLanes(["ACTIVE"], [
      mission({ id: "m-live", title: "Live task", executionKind: "agent", state: "ACTIVE", runState: "WAITING_APPROVAL", lastAssistantMessage: "Voici le diff, merci de valider." })
    ]);
    const status = screen.getByRole("status", { name: "Activité du run en cours" });
    expect(status.textContent).toContain("attend une approbation");
    expect(status.textContent).toContain("Voici le diff");
  });

  it("exposes the full last message via title for long output", () => {
    const longMessage = "Un très long message de l'assistant qui dépasse la largeur de la carte et doit être tronqué visuellement par ellipsis tout en restant consultable au survol via l'attribut title.".repeat(1);
    renderWithLanes(["ACTIVE"], [
      mission({ id: "m-live", title: "Live task", executionKind: "agent", state: "ACTIVE", runState: "RUNNING", lastAssistantMessage: longMessage })
    ]);
    const message = screen.getByTitle(longMessage);
    expect(message.textContent).toBe(`« ${longMessage} »`);
  });

  it("keeps the static hint when the mission is ACTIVE but the run is finished", () => {
    renderWithLanes(["ACTIVE"], [
      mission({ id: "m-live", title: "Live task", executionKind: "agent", state: "ACTIVE", runState: "DONE", runStartedAt: "2026-08-02T10:00:00Z", lastAssistantMessage: null })
    ]);
    expect(screen.queryByRole("status", { name: "Activité du run en cours" })).toBeNull();
    expect(screen.getByText("Travaille maintenant")).toBeTruthy();
  });

  it("keeps the static hint when there is no run yet", () => {
    renderWithLanes(["ACTIVE"], [
      mission({ id: "m-live", title: "Live task", executionKind: "agent", state: "ACTIVE", runState: null, runStartedAt: null, lastAssistantMessage: null })
    ]);
    expect(screen.queryByRole("status", { name: "Activité du run en cours" })).toBeNull();
    expect(screen.getByText("Travaille maintenant")).toBeTruthy();
  });

  it("does not show the live block on non-ACTIVE cards even with an active run", () => {
    renderWithLanes(["VALIDATION"], [
      mission({ id: "m-val", title: "Validation task", executionKind: "agent", state: "VALIDATION", runState: "RUNNING", lastAssistantMessage: "En attente." })
    ]);
    expect(screen.queryByRole("status", { name: "Activité du run en cours" })).toBeNull();
    expect(screen.getByText("A rendu la main · attend ta décision")).toBeTruthy();
  });

  it("shows the live block on human ACTIVE missions too when a run is active", () => {
    renderWithLanes(["ACTIVE"], [
      mission({ id: "m-live", title: "Human live task", executionKind: "human", state: "ACTIVE", runState: "RUNNING", lastAssistantMessage: "Je travaille sur le livrable." })
    ]);
    const status = screen.getByRole("status", { name: "Activité du run en cours" });
    expect(status.textContent).toContain("réfléchit");
    expect(status.textContent).toContain("Je travaille sur le livrable");
  });
});

describe("MissionRelay quick actions (issue #19)", () => {
  it("renders an actions button on every card without affecting inspect", () => {
    renderWithLanes(["READY"], [agentMission, humanMission]);
    expect(screen.getAllByRole("button", { name: /^Actions pour / })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Ouvrir Agent task" })).toBeTruthy();
  });

  it("opens the context menu from the ⋯ button, executes an action and shows feedback", async () => {
    const onActionApplied = vi.fn();
    render(
      <MissionRelay
        missions={[mission({ id: "m-val", title: "Validation task", executionKind: "agent", state: "VALIDATION" })]}
        onInspect={noop}
        onOpenPipeline={noop}
        onNewTask={noop}
        onActionApplied={onActionApplied}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Actions pour Validation task" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Abandonner" }));

    expect(performMissionAction).toHaveBeenCalledWith(expect.objectContaining({ actionId: "abandon" }));
    await waitFor(() => expect(onActionApplied).toHaveBeenCalledWith("Abandonner"));
    expect(await screen.findByText("✓ Abandonner · action appliquée")).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the menu on right-click without triggering inspect", async () => {
    const onInspect = vi.fn();
    render(
      <MissionRelay
        missions={[mission({ id: "m-rc", title: "Right-click task", executionKind: "human", state: "READY" })]}
        onInspect={onInspect}
        onOpenPipeline={noop}
        onNewTask={noop}
      />
    );
    const card = screen.getByRole("button", { name: "Ouvrir Right-click task" });
    fireEvent.contextMenu(card, { clientX: 120, clientY: 80 });

    expect(await screen.findByRole("menuitem", { name: "Prendre en charge" })).toBeTruthy();
    expect(onInspect).not.toHaveBeenCalled();
  });

  it("closes the menu on Escape", async () => {
    render(
      <MissionRelay missions={[humanMission]} onInspect={noop} onOpenPipeline={noop} onNewTask={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Actions pour Human task" }));
    await screen.findByRole("menuitem", { name: "Prendre en charge" });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps drag & drop working with the menu button present", () => {
    const onTransition = renderWithLanes(["READY", "ACTIVE"], [humanMission]);
    dragCard("Human task", "Ça bosse");
    expect(onTransition).toHaveBeenCalledWith(humanMission, "ACTIVE");
  });
});

describe("MissionRelay day filter (ma journée)", () => {

  const todayKey = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };
  const yesterday = new Date(Date.now() - 86_400_000);
  const onDay = (date: Date, time = "10:00:00") => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}T${time}`;
  };

  function renderRelayDay(missions: MissionView[], dayFilter: string, schedule: Record<string, string>) {
    render(
      <MissionRelay
        missions={missions}
        kindFilter="all"
        dayFilter={dayFilter}
        schedule={schedule}
        onInspect={noop}
        onOpenPipeline={noop}
        onNewTask={noop}
      />
    );
  }

  it("hides missions neither planned nor touched today when dayFilter is today", () => {
    renderRelayDay(
      [
        mission({ id: "m-today", title: "Task today", executionKind: "agent", state: "READY", createdAt: onDay(new Date()), updatedAt: onDay(new Date()) }),
        mission({ id: "m-old", title: "Old task", executionKind: "agent", state: "READY", createdAt: onDay(yesterday), updatedAt: onDay(yesterday) })
      ],
      "today",
      {}
    );
    expect(screen.getByText("Task today")).toBeTruthy();
    expect(screen.queryByText("Old task")).toBeNull();
  });

  it("includes a mission planned today through the local schedule", () => {
    renderRelayDay(
      [mission({ id: "m-planned", title: "Planned task", executionKind: "agent", state: "READY", createdAt: onDay(yesterday), updatedAt: onDay(yesterday) })],
      "today",
      { "m-planned": todayKey() }
    );
    expect(screen.getByText("Planned task")).toBeTruthy();
  });

  it("keeps every mission when dayFilter is all", () => {
    renderRelayDay(
      [mission({ id: "m-old", title: "Old task", executionKind: "agent", state: "READY", createdAt: onDay(yesterday), updatedAt: onDay(yesterday) })],
      "all",
      {}
    );
    expect(screen.getByText("Old task")).toBeTruthy();
  });

  it("floats overdue missions to the top of their lane when the day filter is active", () => {
    renderRelayDay(
      [
        mission({ id: "m-new", title: "New today", executionKind: "agent", state: "ACTIVE", createdAt: onDay(new Date(), "09:00:00"), updatedAt: onDay(new Date(), "09:00:00") }),
        mission({ id: "m-overdue", title: "Overdue", executionKind: "agent", state: "ACTIVE", createdAt: onDay(yesterday, "09:00:00"), updatedAt: onDay(new Date(), "08:00:00") })
      ],
      "today",
      { "m-overdue": onDay(yesterday).slice(0, 10) }
    );
    const cards = screen.getAllByRole("button", { name: /^Ouvrir / });
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Overdue"),
      expect.stringContaining("New today")
    ]);
  });
});
