import { asId, DomainError } from "@nodra/domain";
import { describe, expect, it, vi } from "vitest";
import { ReconcileWorkflows } from "./reconcile-workflows.js";
import type { WorkflowPort } from "./workflow-port.js";

const active = { missionId: asId("mission-1"), runId: asId("run-1"), workflowId: "mission/mission-1" };

const port = (query: WorkflowPort["query"]): WorkflowPort => ({
  start: vi.fn(),
  signal: vi.fn(),
  update: vi.fn(),
  query
});

describe("ReconcileWorkflows", () => {
  it("reports reachable and missing workflows without mutating SQLite", async () => {
    const store = { listActiveWorkflows: vi.fn(async () => [active]) };
    await expect(new ReconcileWorkflows(store, port(async <T>() => ({ phase: "started" }) as T)).execute())
      .resolves.toEqual({ items: [{ ...active, status: "reachable" }] });
    await expect(new ReconcileWorkflows(
      store,
      port(async <T>(): Promise<T> => { throw new DomainError("missing", "WORKFLOW_NOT_FOUND"); })
    ).execute()).resolves.toEqual({ items: [{ ...active, status: "missing" }] });
  });

  it("keeps Temporal unavailability explicit instead of reporting a false missing workflow", async () => {
    const reconcile = new ReconcileWorkflows(
      { listActiveWorkflows: async () => [active] },
      port(async <T>(): Promise<T> => { throw new DomainError("unavailable", "RUNTIME_UNHEALTHY"); })
    );
    await expect(reconcile.execute()).rejects.toMatchObject({ code: "RUNTIME_UNHEALTHY" });
  });
});
