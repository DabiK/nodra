// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { MissionView } from "../types";
import { countTodayMissions, isMissionToday, sortByUrgency, urgencyRank } from "./mission-day-service";
import { dayKey, todayKey, type MissionSchedule } from "./mission-schedule-service";

function mission(overrides: Partial<MissionView>): MissionView {
  return {
    id: "mission-a",
    projectId: null,
    title: "Tâche du jour",
    executionKind: "agent",
    state: "READY",
    version: 1,
    createdAt: "2026-08-01T09:00:00",
    updatedAt: "2026-08-01T10:00:00",
    runState: null,
    runStartedAt: null,
    lastAssistantMessage: null, tagIds: [],
    ...overrides
  };
}

const today = todayKey();
const yesterday = dayKey(new Date(Date.now() - 86_400_000));
const tomorrow = dayKey(new Date(Date.now() + 86_400_000));

function onDay(day: string, time = "10:00:00"): string {
  return `${day}T${time}`;
}

afterEach(() => localStorage.clear());

describe("isMissionToday", () => {
  it("includes a mission planned today via the local schedule", () => {
    const schedule: MissionSchedule = { "mission-a": today };
    const item = mission({ createdAt: onDay(yesterday) });
    expect(isMissionToday(item, schedule)).toBe(true);
  });

  it("includes a mission created today (schedule defaults to the creation day)", () => {
    const item = mission({ createdAt: onDay(today) });
    expect(isMissionToday(item, {})).toBe(true);
  });

  it("includes a mission touched today even when planned earlier (updatedAt = transition proxy)", () => {
    const schedule: MissionSchedule = { "mission-a": yesterday };
    const item = mission({ createdAt: onDay(yesterday), updatedAt: onDay(today) });
    expect(isMissionToday(item, schedule)).toBe(true);
  });

  it("excludes a mission planned and touched on previous days", () => {
    const schedule: MissionSchedule = { "mission-a": yesterday };
    const item = mission({ createdAt: onDay(yesterday), updatedAt: onDay(yesterday, "11:00:00") });
    expect(isMissionToday(item, schedule)).toBe(false);
  });

  it("excludes a mission planned for tomorrow", () => {
    const schedule: MissionSchedule = { "mission-a": tomorrow };
    const item = mission({ createdAt: onDay(yesterday), updatedAt: onDay(yesterday, "11:00:00") });
    expect(isMissionToday(item, schedule)).toBe(false);
  });

  it("includes a finished mission planned today", () => {
    const schedule: MissionSchedule = { "mission-a": today };
    const item = mission({ state: "DONE", createdAt: onDay(yesterday), updatedAt: onDay(today, "09:00:00") });
    expect(isMissionToday(item, schedule)).toBe(true);
  });
});

describe("urgencyRank", () => {
  it("ranks an overdue mission first whatever its state", () => {
    const schedule: MissionSchedule = { "mission-a": yesterday };
    const item = mission({ state: "ACTIVE" });
    expect(urgencyRank(item, schedule)).toBe(0);
  });

  it("does not rank a finished overdue mission as urgent", () => {
    const schedule: MissionSchedule = { "mission-a": yesterday };
    const done = mission({ state: "DONE" });
    const abandoned = mission({ state: "ABANDONED" });
    expect(urgencyRank(done, schedule)).toBe(3);
    expect(urgencyRank(abandoned, schedule)).toBe(3);
  });

  it("ranks validation pending second and active third", () => {
    const scheduledToday: MissionSchedule = { "mission-a": today };
    expect(urgencyRank(mission({ state: "VALIDATION" }), scheduledToday)).toBe(1);
    expect(urgencyRank(mission({ state: "ACTIVE" }), scheduledToday)).toBe(2);
    expect(urgencyRank(mission({ state: "READY" }), scheduledToday)).toBe(3);
  });
});

describe("sortByUrgency", () => {
  it("sorts by urgency: overdue > validation > active > new", () => {
    const schedule: MissionSchedule = {
      "m-overdue": yesterday,
      "m-validation": today,
      "m-active": today
    };
    const missions = [
      mission({ id: "m-new", title: "Nouveau", state: "READY", createdAt: onDay(today), updatedAt: onDay(today) }),
      mission({ id: "m-validation", title: "Validation", state: "VALIDATION", createdAt: onDay(yesterday), updatedAt: onDay(yesterday, "11:00:00") }),
      mission({ id: "m-overdue", title: "Retard", state: "ACTIVE", createdAt: onDay(yesterday), updatedAt: onDay(yesterday, "12:00:00") }),
      mission({ id: "m-active", title: "Active", state: "ACTIVE", createdAt: onDay(yesterday), updatedAt: onDay(yesterday, "13:00:00") })
    ];
    expect(sortByUrgency(missions, schedule).map((item) => item.id)).toEqual([
      "m-overdue", "m-validation", "m-active", "m-new"
    ]);
  });

  it("keeps the most recently updated first within the same rank", () => {
    const missions = [
      mission({ id: "a", title: "A", state: "READY", createdAt: onDay(today), updatedAt: onDay(today, "08:00:00") }),
      mission({ id: "b", title: "B", state: "READY", createdAt: onDay(today), updatedAt: onDay(today, "18:00:00") })
    ];
    expect(sortByUrgency(missions, {}).map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("does not mutate the input list", () => {
    const missions = [
      mission({ id: "a", title: "A", state: "VALIDATION" }),
      mission({ id: "b", title: "B", state: "ACTIVE" })
    ];
    sortByUrgency(missions, {});
    expect(missions.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("countTodayMissions", () => {
  it("counts only the missions of the day", () => {
    const schedule: MissionSchedule = { "m-planned": today };
    const missions = [
      mission({ id: "m-planned", title: "Planifiée", createdAt: onDay(yesterday) }),
      mission({ id: "m-touched", title: "Touchée", createdAt: onDay(yesterday), updatedAt: onDay(today) }),
      mission({ id: "m-old", title: "Ancienne", createdAt: onDay(yesterday), updatedAt: onDay(yesterday, "11:00:00") })
    ];
    expect(countTodayMissions(missions, schedule)).toBe(2);
  });
});
