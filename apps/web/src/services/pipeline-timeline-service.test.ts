// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import type { PipelineListItem, PipelineListNode } from "../types";
import {
  formatDuration,
  loadPipelineViewMode,
  nodeDurationMs,
  pipelineTotalDurationMs,
  runTimeRange,
  savePipelineViewMode,
  sortTimelineNodes
} from "./pipeline-timeline-service";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function node(overrides: Partial<PipelineListNode>): PipelineListNode {
  return {
    nodeKey: "01-first",
    missionId: "mission-a",
    missionTitle: "Première étape",
    missionKind: "agent",
    missionState: "DONE",
    nodeRunState: "completed",
    transitionMode: "auto",
    runStartedAt: null,
    runEndedAt: null,
    runAttempt: null,
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
    nodes: [],
    edges: [],
    ...overrides
  };
}

describe("nodeDurationMs", () => {
  it("returns null when the step never ran", () => {
    expect(nodeDurationMs(node({}))).toBeNull();
  });

  it("returns null when the run is still in progress", () => {
    expect(nodeDurationMs(node({ runStartedAt: "2026-07-26T08:00:00.000Z", runEndedAt: null }))).toBeNull();
  });

  it("computes the duration from run start and end", () => {
    const duration = nodeDurationMs(node({
      runStartedAt: "2026-07-26T08:00:00.000Z",
      runEndedAt: "2026-07-26T08:01:23.000Z"
    }));
    expect(duration).toBe(83_000);
  });
});

describe("pipelineTotalDurationMs", () => {
  it("uses the pipeline run bounds when available", () => {
    expect(pipelineTotalDurationMs(pipeline({ startedAt: "2026-07-26T08:00:00.000Z", endedAt: "2026-07-26T10:05:00.000Z" })))
      .toBe(7_500_000);
  });

  it("falls back to the sum of known node durations", () => {
    const p = pipeline({
      startedAt: null,
      endedAt: null,
      nodes: [
        node({ nodeKey: "a", runStartedAt: "2026-07-26T08:00:00.000Z", runEndedAt: "2026-07-26T08:01:00.000Z" }),
        node({ nodeKey: "b", runStartedAt: "2026-07-26T08:05:00.000Z", runEndedAt: "2026-07-26T08:06:30.000Z" }),
        node({ nodeKey: "c", runStartedAt: null, runEndedAt: null })
      ]
    });
    expect(pipelineTotalDurationMs(p)).toBe(150_000);
  });

  it("returns null when no duration can be derived", () => {
    expect(pipelineTotalDurationMs(pipeline({ startedAt: null, endedAt: null, nodes: [node({})] }))).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(45_000)).toBe("45 s");
    expect(formatDuration(65_000)).toBe("1 min 05 s");
    expect(formatDuration(7_920_000)).toBe("2 h 12 min");
  });

  it("renders an em dash for unknown durations", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("sortTimelineNodes", () => {
  it("orders by run start ascending", () => {
    const nodes = [
      node({ nodeKey: "b", runStartedAt: "2026-07-26T09:00:00.000Z" }),
      node({ nodeKey: "a", runStartedAt: "2026-07-26T08:00:00.000Z" })
    ];
    expect(sortTimelineNodes(nodes).map((item) => item.nodeKey)).toEqual(["a", "b"]);
  });

  it("keeps never-run steps at the end, ordered by nodeKey", () => {
    const nodes = [
      node({ nodeKey: "02-second", runStartedAt: null }),
      node({ nodeKey: "01-first", runStartedAt: "2026-07-26T08:00:00.000Z" }),
      node({ nodeKey: "03-third", runStartedAt: null })
    ];
    expect(sortTimelineNodes(nodes).map((item) => item.nodeKey)).toEqual(["01-first", "02-second", "03-third"]);
  });
});

describe("runTimeRange", () => {
  it("returns a formatted range when bounded", () => {
    const range = runTimeRange(node({
      runStartedAt: "2026-07-26T08:00:00.000Z",
      runEndedAt: "2026-07-26T08:01:23.000Z"
    }));
    expect(range).toContain("→");
  });

  it("marks an in-progress run", () => {
    expect(runTimeRange(node({ runStartedAt: "2026-07-26T08:00:00.000Z" }))).toContain("en cours");
  });

  it("returns null for a step that never ran", () => {
    expect(runTimeRange(node({}))).toBeNull();
  });
});

describe("pipeline view mode persistence", () => {
  it("defaults to graph", () => {
    expect(loadPipelineViewMode()).toBe("graph");
  });

  it("persists and restores the timeline choice", () => {
    savePipelineViewMode("timeline");
    expect(loadPipelineViewMode()).toBe("timeline");
  });
});
