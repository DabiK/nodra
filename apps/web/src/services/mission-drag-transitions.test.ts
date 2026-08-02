import { describe, expect, it } from "vitest";
import type { MissionState, MissionView } from "../types";
import { dragActionId, findDragTransition } from "./mission-drag-transitions";

function mission(executionKind: "human" | "agent", state: MissionState): MissionView {
  return { id: `m-${executionKind}-${state}`, projectId: null, title: "Task", executionKind, state, version: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
}

function route(mission: MissionView, target: MissionState) {
  return findDragTransition(mission, target)?.route ?? null;
}

describe("mission-drag-transitions", () => {
  it("forbids every drop on BACKLOG, DONE and ABANDONED cards", () => {
    for (const state of ["BACKLOG", "DONE", "ABANDONED"] as const) {
      for (const kind of ["human", "agent"] as const) {
        expect(route(mission(kind, state), "READY")).toBeNull();
        expect(route(mission(kind, state), "ABANDONED")).toBeNull();
      }
    }
  });

  it("forbids dropping a card on its own column", () => {
    expect(route(mission("human", "READY"), "READY")).toBeNull();
    expect(route(mission("agent", "VALIDATION"), "VALIDATION")).toBeNull();
  });

  it("lets human missions follow the full lifecycle", () => {
    const draft = mission("human", "DRAFT");
    expect(route(draft, "READY")).toBe("ready");
    expect(route(draft, "DONE")).toBe("complete");
    expect(route(draft, "ABANDONED")).toBe("abandon");
    expect(route(draft, "ACTIVE")).toBeNull();

    const ready = mission("human", "READY");
    expect(route(ready, "ACTIVE")).toBe("pickup");
    expect(route(ready, "DONE")).toBe("complete");
    expect(route(ready, "ABANDONED")).toBe("abandon");

    expect(route(mission("human", "ACTIVE"), "DONE")).toBe("complete");
    expect(route(mission("human", "ACTIVE"), "READY")).toBeNull();

    expect(route(mission("human", "BLOCKED"), "READY")).toBe("unblock");
    expect(route(mission("human", "BLOCKED"), "ABANDONED")).toBe("abandon");
    expect(route(mission("human", "VALIDATION"), "ABANDONED")).toBe("abandon");
  });

  it("never lets an agent mission be started or closed by drag & drop", () => {
    expect(route(mission("agent", "READY"), "ACTIVE")).toBeNull();
    expect(route(mission("agent", "ACTIVE"), "DONE")).toBeNull();
    expect(route(mission("agent", "ACTIVE"), "VALIDATION")).toBeNull();
    expect(route(mission("agent", "VALIDATION"), "READY")).toBeNull();
  });

  it("lets agent missions be prepared, unblocked, validated or abandoned", () => {
    const draft = mission("agent", "DRAFT");
    expect(route(draft, "READY")).toBe("ready");
    expect(route(draft, "DONE")).toBeNull();
    expect(route(draft, "ABANDONED")).toBe("abandon");

    const ready = mission("agent", "READY");
    expect(route(ready, "ABANDONED")).toBe("abandon");
    expect(route(ready, "DONE")).toBeNull();

    expect(route(mission("agent", "BLOCKED"), "READY")).toBe("unblock");
    expect(route(mission("agent", "BLOCKED"), "ABANDONED")).toBe("abandon");

    const validation = mission("agent", "VALIDATION");
    expect(route(validation, "DONE")).toBe("accept");
    expect(route(validation, "ABANDONED")).toBe("abandon");
  });

  it("maps every route to an existing UI action", () => {
    expect(dragActionId({ route: "ready", label: "" })).toBe("mark-ready");
    expect(dragActionId({ route: "pickup", label: "" })).toBe("pickup");
    expect(dragActionId({ route: "unblock", label: "" })).toBe("resume");
    expect(dragActionId({ route: "complete", label: "" })).toBe("complete-human");
    expect(dragActionId({ route: "accept", label: "" })).toBe("validate");
    expect(dragActionId({ route: "abandon", label: "" })).toBe("abandon");
  });
});
