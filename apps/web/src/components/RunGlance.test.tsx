// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RunGlance } from "./RunGlance";
import type { RunGlanceItem } from "../services/run-glance-service";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function item(overrides: Partial<RunGlanceItem> & Pick<RunGlanceItem, "kind" | "id" | "title">): RunGlanceItem {
  return {
    detail: "dernière action",
    startedAt: null,
    stateLabel: "réfléchit…",
    tone: "running",
    ...overrides
  };
}

const runningMission = item({ kind: "mission", id: "m1", title: "Refonte", detail: "J'analyse la base.", startedAt: "2026-08-03T10:00:00Z", stateLabel: "réfléchit…" });
const activePipeline = item({ kind: "pipeline", id: "p1", title: "Release", detail: "review · Revue de code", startedAt: "2026-08-03T09:00:00Z", stateLabel: "en cours", tone: "running" });
const activeManager = item({ kind: "manager", id: "mg1", title: "Nova", detail: "Pipeline relancé.", startedAt: "2026-08-03T08:00:00Z", stateLabel: "en orchestration", tone: "manager" });

describe("RunGlance", () => {
  it("n'affiche rien quand aucun run actif", () => {
    const { container } = render(<RunGlance items={[]} onOpen={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("affiche le compteur de runs actifs et chaque item (titre, détail, état)", () => {
    render(<RunGlance items={[runningMission, activePipeline]} onOpen={vi.fn()} />);
    expect(screen.getByText("2 runs actifs")).toBeTruthy();
    expect(screen.getByText("Refonte")).toBeTruthy();
    expect(screen.getByText("J'analyse la base.")).toBeTruthy();
    expect(screen.getByText("réfléchit…")).toBeTruthy();
    expect(screen.getByText("Release")).toBeTruthy();
    expect(screen.getByText("review · Revue de code")).toBeTruthy();
    expect(screen.getByText("en cours")).toBeTruthy();
  });

  it("singularise le compteur avec un seul run", () => {
    render(<RunGlance items={[runningMission]} onOpen={vi.fn()} />);
    expect(screen.getByText("1 run actif")).toBeTruthy();
  });

  it("affiche le temps écoulé depuis le début du run", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-08-03T10:05:00Z"));
    render(<RunGlance items={[runningMission]} onOpen={vi.fn()} />);
    expect(screen.getByText("il y a 5 min")).toBeTruthy();
  });

  it("rafraîchit le temps écoulé sur le tic (30 s)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-08-03T10:00:30Z"));
    render(<RunGlance items={[runningMission]} onOpen={vi.fn()} />);
    expect(screen.getByText("à l'instant")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4 * 60_000 + 30_000); });
    expect(screen.getByText("il y a 5 min")).toBeTruthy();
  });

  it("ne démarre pas de tic quand il n'y a aucun run", () => {
    vi.useFakeTimers();
    render(<RunGlance items={[]} onOpen={vi.fn()} />);
    expect(() => vi.advanceTimersByTime(30_000)).not.toThrow();
  });

  it("ouvre la conversation correspondante au clic", () => {
    const onOpen = vi.fn();
    render(<RunGlance items={[runningMission, activeManager]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir la conversation mission Refonte" }));
    expect(onOpen).toHaveBeenCalledWith(runningMission);
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir la conversation manager Nova" }));
    expect(onOpen).toHaveBeenLastCalledWith(activeManager);
  });

  it("expose le détail complet au survol (title) même tronqué", () => {
    render(<RunGlance items={[item({ kind: "mission", id: "m2", title: "Longue", detail: "un très long message qui déborde de la carte du glance horizontal" })]} onOpen={vi.fn()} />);
    expect(screen.getByTitle("un très long message qui déborde de la carte du glance horizontal")).toBeTruthy();
  });

  it("rend les items dans l'ordre fourni (le service trie, le composant rend)", () => {
    render(<RunGlance items={[activeManager, activePipeline, runningMission]} onOpen={vi.fn()} />);
    const titles = screen.getAllByRole("button").map((button) => button.querySelector(".run-glance-title")?.textContent);
    expect(titles).toEqual(["Nova", "Release", "Refonte"]);
  });
});
