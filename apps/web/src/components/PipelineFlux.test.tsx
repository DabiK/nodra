// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PipelineListItem, PipelineListNode } from "../types";
import { PipelinesPage } from "./PipelineFlux";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const noop = () => undefined;

function node(overrides: Partial<PipelineListNode>): PipelineListNode {
  return {
    nodeKey: "01-first",
    missionId: "mission-a",
    missionTitle: "Première étape",
    missionKind: "agent",
    missionState: "DONE",
    nodeRunState: "completed",
    transitionMode: "auto",
    runStartedAt: "2026-07-26T08:00:00.000Z",
    runEndedAt: "2026-07-26T08:01:23.000Z",
    runAttempt: 1,
    ...overrides
  };
}

function pipeline(overrides: Partial<PipelineListItem> = {}): PipelineListItem {
  return {
    id: "pipeline-a",
    name: "Pipeline A",
    state: "active",
    createdAt: "2026-07-26T08:00:00.000Z",
    runId: "run-a",
    runState: "active",
    startedAt: "2026-07-26T08:00:00.000Z",
    endedAt: null,
    nodes: [
      node({
        nodeKey: "01-first",
        missionTitle: "Première étape",
        runStartedAt: "2026-07-26T08:00:00.000Z",
        runEndedAt: "2026-07-26T08:01:23.000Z"
      }),
      node({
        nodeKey: "02-second",
        missionId: "mission-b",
        missionTitle: "Deuxième étape",
        nodeRunState: "pending",
        missionState: "READY",
        runStartedAt: null,
        runEndedAt: null,
        runAttempt: null
      })
    ],
    edges: [{ fromNodeKey: "01-first", toNodeKey: "02-second" }],
    ...overrides
  };
}

function renderPage(overrides: Partial<Parameters<typeof PipelinesPage>[0]> = {}) {
  return render(
    <PipelinesPage
      pipelines={[pipeline()]}
      onInspect={noop}
      onChanged={noop}
      {...overrides}
    />
  );
}

describe("PipelinesPage timeline view", () => {
  it("switches from graph to timeline with the toggle and persists the choice", () => {
    renderPage();
    expect(document.querySelector(".workflow-graph")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));

    expect(document.querySelector(".pipeline-timeline")).toBeTruthy();
    expect(document.querySelector(".workflow-graph")).toBeNull();
    expect(localStorage.getItem("nodra.pipelines.view")).toBe("timeline");
  });

  it("restores the persisted timeline view on mount", () => {
    localStorage.setItem("nodra.pipelines.view", "timeline");
    renderPage();
    expect(document.querySelector(".pipeline-timeline")).toBeTruthy();
    expect(document.querySelector(".workflow-graph")).toBeNull();
  });

  it("lists steps in chronological order with duration, time range and summary", () => {
    localStorage.setItem("nodra.pipelines.view", "timeline");
    renderPage();

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Première étape");
    expect(rows[1].textContent).toContain("Deuxième étape");

    expect(screen.getAllByText("1 min 23 s").length).toBeGreaterThan(0);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText(/Durée totale :/)).toBeTruthy();
    expect(screen.getByText(/exécutée/)).toBeTruthy();
  });

  it("shows failed and blocked steps at a glance with distinct badges", () => {
    localStorage.setItem("nodra.pipelines.view", "timeline");
    renderPage({
      pipelines: [pipeline({
        nodes: [
          node({ nodeKey: "01-fail", missionTitle: "Étape en échec", nodeRunState: "failed", missionState: "BLOCKED" }),
          node({
            nodeKey: "02-block",
            missionId: "mission-c",
            missionTitle: "Étape bloquée",
            nodeRunState: "pending",
            missionState: "READY",
            transitionMode: "human",
            runStartedAt: null,
            runEndedAt: null,
            runAttempt: null
          }),
          node({ nodeKey: "03-ok", missionId: "mission-d", missionTitle: "Étape réussie", nodeRunState: "completed", missionState: "DONE" })
        ]
      })]
    });

    expect(screen.getByText("✕ ÉCHEC")).toBeTruthy();
    expect(screen.getByText("◇ FEU VERT")).toBeTruthy();
    expect(screen.getByText("✓ DONE")).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0].className).toContain("failed");
    expect(rows[2].className).toContain("gate-waiting");
  });

  it("marks a step with multiple attempts", () => {
    localStorage.setItem("nodra.pipelines.view", "timeline");
    renderPage({
      pipelines: [pipeline({
        nodes: [
          node({ nodeKey: "01-retry", missionTitle: "Étape retentée", runAttempt: 3 })
        ]
      })]
    });
    expect(screen.getByText("essai 3")).toBeTruthy();
  });

  it("opens the mission inspector when clicking a step title", () => {
    localStorage.setItem("nodra.pipelines.view", "timeline");
    const onInspect = vi.fn();
    renderPage({ onInspect });
    fireEvent.click(screen.getByRole("button", { name: "Première étape" }));
    expect(onInspect).toHaveBeenCalledWith("mission-a");
  });

  it("keeps the start and advance actions available in timeline view", () => {
    localStorage.setItem("nodra.pipelines.view", "timeline");
    renderPage();
    expect(screen.getByRole("button", { name: "↻ Avancer" })).toBeTruthy();
  });
});
