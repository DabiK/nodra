import { Context } from "@temporalio/activity";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { RunWorkflowActivities } from "./contracts.js";
import {
  MISSION_CANCEL_SIGNAL,
  MISSION_RESUME_SIGNAL,
  MISSION_STEER_SIGNAL
} from "./temporal-settings.js";

describe("I7 deterministic Temporal controls", () => {
  let environment: TestWorkflowEnvironment;

  beforeEach(async () => {
    environment = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterEach(async () => {
    await environment.teardown();
  });

  it("routes steer, waits after an adapter failure, and resumes the same run workflow", async () => {
    let executions = 0;
    const steers: string[] = [];
    let failFirst: (() => void) | undefined;
    const firstAttempt = new Promise<void>((resolveAttempt) => {
      failFirst = resolveAttempt;
    });
    const activities: RunWorkflowActivities = {
      recordStarted: async () => ({ applied: true }),
      recordTerminal: async () => ({ applied: true }),
      executeProvider: async () => {
        executions += 1;
        if (executions === 1) {
          await firstAttempt;
          throw new Error("deterministic transient adapter failure");
        }
        return { state: "SUCCEEDED" };
      },
      steerProvider: async ({ text }) => {
        steers.push(text);
      }
    };
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      namespace: "default",
      taskQueue: "i7-controls",
      workflowsPath: resolve("packages/adapters/src/temporal/workflows/mission-workflow.ts"),
      activities
    });
    await worker.runUntil(async () => {
      const handle = await environment.client.workflow.start("MissionWorkflow", {
        workflowId: "mission/i7-steer-resume",
        taskQueue: "i7-controls",
        args: [{
          missionId: "i7-steer-resume",
          commandId: "i7-controls-command",
          runId: "i7-controls-run",
          schemaVersion: 1,
          executeProvider: true
        }]
      });
      await thisWaitFor(() => executions === 1);
      await handle.signal(MISSION_STEER_SIGNAL, "deterministic steer");
      await thisWaitFor(() => steers.length === 1);
      failFirst?.();
      await handle.signal(MISSION_RESUME_SIGNAL);
      await handle.result();
    });
    expect(steers).toEqual(["deterministic steer"]);
    expect(executions).toBe(2);
  }, 30_000);

  it("propagates cancellation through the parent and cancellation-aware provider Activity", async () => {
    let cancellations = 0;
    let providerStarted = false;
    const activities: RunWorkflowActivities = {
      recordStarted: async () => ({ applied: true }),
      recordTerminal: async ({ state }) => {
        if (state === "CANCELLED") cancellations += 1;
        return { applied: true };
      },
      executeProvider: async () => {
        providerStarted = true;
        await Context.current().cancelled;
        return { state: "CANCELLED" };
      },
      steerProvider: async () => undefined
    };
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      namespace: "default",
      taskQueue: "i7-cancel",
      workflowsPath: resolve("packages/adapters/src/temporal/workflows/mission-workflow.ts"),
      activities
    });
    await worker.runUntil(async () => {
      const handle = await environment.client.workflow.start("MissionWorkflow", {
        workflowId: "mission/i7-cancel",
        taskQueue: "i7-cancel",
        args: [{
          missionId: "i7-cancel",
          commandId: "i7-cancel-command",
          runId: "i7-cancel-run",
          schemaVersion: 1,
          executeProvider: true
        }]
      });
      await thisWaitFor(() => providerStarted);
      await handle.signal(MISSION_CANCEL_SIGNAL);
      await handle.result();
    });
    expect(cancellations).toBe(1);
  }, 30_000);
});

const thisWaitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error("Timed out waiting for deterministic Temporal control");
};
