import { describe, expect, it } from "vitest";
import { selectActiveSidebarMissions } from "./sidebar-missions";
import type { MissionView } from "../types";

function mission(partial: Partial<MissionView> & Pick<MissionView, "id" | "state" | "updatedAt">): MissionView {
  return { projectId: null, title: partial.id, executionKind: "agent", version: 1, createdAt: "2026-01-01", runState: null, runStartedAt: null, lastAssistantMessage: null, tagIds: [], ...partial };
}

describe("selectActiveSidebarMissions", () => {
  it("shows only missions that are running (ACTIVE)", () => {
    const active = mission({ id: "active-1", state: "ACTIVE", updatedAt: "2026-06-01" });
    const draft = mission({ id: "draft", state: "DRAFT", updatedAt: "2026-06-02" });
    const ready = mission({ id: "ready", state: "READY", updatedAt: "2026-06-03" });
    const result = selectActiveSidebarMissions([active, draft, ready]);
    expect(result.map((item) => item.id)).toEqual(["active-1"]);
  });

  it("excludes DONE and ABANDONED missions", () => {
    const active = mission({ id: "active-1", state: "ACTIVE", updatedAt: "2026-06-01" });
    const done = mission({ id: "done", state: "DONE", updatedAt: "2026-05-02" });
    const abandoned = mission({ id: "abandoned", state: "ABANDONED", updatedAt: "2026-05-01" });
    const result = selectActiveSidebarMissions([active, done, abandoned]);
    expect(result.map((item) => item.id)).toEqual(["active-1"]);
  });

  it("sorts by updatedAt descending", () => {
    const activeA = mission({ id: "active-a", state: "ACTIVE", updatedAt: "2026-06-01" });
    const activeB = mission({ id: "active-b", state: "ACTIVE", updatedAt: "2026-06-03" });
    const result = selectActiveSidebarMissions([activeA, activeB]);
    expect(result.map((item) => item.id)).toEqual(["active-b", "active-a"]);
  });

  it("keeps an old ACTIVE mission even when 10 more recent non-terminal missions exist", () => {
    const active = mission({ id: "active-old", state: "ACTIVE", updatedAt: "2026-01-01" });
    const recent = Array.from({ length: 10 }, (_, index) =>
      mission({ id: `draft-${index}`, state: "DRAFT", updatedAt: `2026-02-${String(index + 1).padStart(2, "0")}` })
    );
    const result = selectActiveSidebarMissions([active, ...recent]);
    expect(result.map((item) => item.id)).toEqual(["active-old"]);
  });

  it("searches across all states when a query is given", () => {
    const active = mission({ id: "stripe-payment", state: "ACTIVE", updatedAt: "2026-06-01" });
    const done = mission({ id: "stripe-refund", state: "DONE", updatedAt: "2026-06-02" });
    const ready = mission({ id: "auth-login", state: "READY", updatedAt: "2026-06-03" });
    const result = selectActiveSidebarMissions([active, done, ready], "stripe");
    expect(result.map((item) => item.id)).toEqual(["stripe-refund", "stripe-payment"]);
  });

  it("matches case-insensitively and trims the query", () => {
    const missionA = mission({ id: "Fix Dark Mode", state: "READY", updatedAt: "2026-06-01" });
    const result = selectActiveSidebarMissions([missionA], "  fix dark  ");
    expect(result.map((item) => item.id)).toEqual(["Fix Dark Mode"]);
  });

  it("returns nothing when the query matches no mission", () => {
    const active = mission({ id: "stripe-payment", state: "ACTIVE", updatedAt: "2026-06-01" });
    expect(selectActiveSidebarMissions([active], "zzz")).toEqual([]);
  });
});
