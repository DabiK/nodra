// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MissionState, MissionView } from "../types";
import { MissionRelay } from "./MissionRelay";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const noop = () => undefined;

function mission(overrides: Partial<MissionView> & Pick<MissionView, "id" | "title" | "executionKind" | "state">): MissionView {
  return { projectId: null, version: 2, createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-01T10:00:00Z", ...overrides };
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
