import { asId } from "@nodra/domain";
import { describe, expect, it } from "vitest";
import { UnavailableWorkflowAdapter } from "./unavailable-workflow-adapter.js";

describe("UnavailableWorkflowAdapter", () => {
  it("fails explicitly without attempting a Temporal runtime", async () => {
    const adapter = new UnavailableWorkflowAdapter();
    await expect(
      adapter.start({ missionId: asId("mission-1"), commandId: asId("command-1"), schemaVersion: 1 })
    ).rejects.toMatchObject({ code: "WORKFLOW_UNAVAILABLE" });
  });
});
