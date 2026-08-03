// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MissionRunView } from "../types";
import { MissionRunComparator } from "./MissionRunComparator";

const run = (id: string, attempt: number, state: string): MissionRunView => ({
  id, attempt, state, providerId: "opencode", modelId: "model-test", startedAt: null, endedAt: null,
  durationMs: 60_000, inputTokens: 100, outputTokens: 20, cacheReadTokens: null, cacheWriteTokens: null,
  costMicros: 1234, usageKind: "reported", reasoningEffort: "high", promptEffective: `Prompt ${attempt}`,
  permissionPreset: "workspace", providerOptions: { temperature: attempt },
  gates: [{ name: "Tests", state: attempt === 1 ? "passed" : "failed", rationale: null, evaluatedAt: "2026-08-03T10:00:00Z" }],
  events: Array.from({ length: 3 }, (_, sequence) => ({ sequence, type: "message", payload: { attempt, sequence }, sourceAt: null, receivedAt: "2026-08-03T10:00:00Z" }))
});

describe("MissionRunComparator", () => {
  it("selects two runs and displays their metrics, snapshots, gates and provider events", () => {
    render(<MissionRunComparator runs={[run("r1", 1, "SUCCEEDED"), run("r2", 2, "FAILED"), run("r3", 3, "SUCCEEDED")]} />);
    const panel = screen.getByLabelText("Comparateur de runs");
    expect(panel.textContent).toContain("Prompt 2");
    expect(panel.textContent).toContain("Prompt 3");
    expect(panel.textContent).toContain("FAILED");
    expect(panel.textContent).toContain("Tests");
    fireEvent.change(screen.getByLabelText("Gauche"), { target: { value: "r1" } });
    expect(panel.textContent).toContain("Prompt 1");
  });

  it("synchronizes provider event scrolling between panes", () => {
    const { container } = render(<MissionRunComparator runs={[run("r1", 1, "SUCCEEDED"), run("r2", 2, "FAILED")]} />);
    const [left, right] = Array.from(container.querySelectorAll<HTMLDivElement>(".run-comparator-events"));
    left.scrollTop = 42;
    fireEvent.scroll(left);
    expect(right.scrollTop).toBe(42);
  });
});
