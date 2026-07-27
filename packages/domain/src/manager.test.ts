import { describe, expect, it } from "vitest";
import { asId } from "./id.js";
import { Manager } from "./manager.js";

const now = "2026-01-01T00:00:00.000Z";
const later = "2026-01-01T01:00:00.000Z";
const base = {
  id: asId("manager-1"),
  name: "Nova",
  instruction: "Orchestrate the team.",
  now
};

describe("Manager", () => {
  it("is draft until fully configured", () => {
    const manager = Manager.create(base);
    expect(manager.snapshot().state).toBe("draft");
  });

  it("is ready when created with a full configuration", () => {
    const manager = Manager.create({
      ...base,
      providerId: "opencode",
      modelId: "github-copilot/gpt-5-mini",
      workspaceId: asId("ws-1")
    });
    expect(manager.snapshot().state).toBe("ready");
  });

  it("promotes to ready when configuration completes", () => {
    const manager = Manager.create(base);
    manager.reconfigure({ providerId: "opencode", modelId: "m", workspaceId: asId("ws-1") }, later);
    expect(manager.snapshot().state).toBe("ready");
  });

  it("rejects empty name and instruction", () => {
    expect(() => Manager.create({ ...base, name: "  " })).toThrow(/name is required/);
    expect(() => Manager.create({ ...base, instruction: " " })).toThrow(/instruction is required/);
  });

  it("cycles through run states", () => {
    const manager = Manager.create({ ...base, providerId: "p", modelId: "m", workspaceId: asId("ws-1") });
    manager.startRun(later);
    expect(manager.snapshot().state).toBe("active");
    manager.completeRun(later);
    expect(manager.snapshot().state).toBe("ready");
    manager.startRun(later);
    manager.blockRun(later);
    expect(manager.snapshot().state).toBe("blocked");
    manager.startRun(later);
    expect(manager.snapshot().state).toBe("active");
  });

  it("forbids reconfiguration and archive while active", () => {
    const manager = Manager.create({ ...base, providerId: "p", modelId: "m", workspaceId: asId("ws-1") });
    manager.startRun(later);
    expect(() => manager.reconfigure({ modelId: "x" }, later)).toThrow(/while running/);
    expect(() => manager.archive(later)).toThrow(/cannot be archived/);
  });

  it("archives and then refuses further mutation", () => {
    const manager = Manager.create(base);
    manager.archive(later);
    expect(manager.snapshot().state).toBe("archived");
    expect(manager.snapshot().archivedAt).toBe(later);
    expect(() => manager.updateInstruction("x", later)).toThrow(/archived/);
  });
});
