import { describe, expect, it, vi } from "vitest";
import { asId as toId, DomainError } from "@nodra/domain";
import { CreateWorkspace } from "./create-workspace.js";
import type { WorkspacePort } from "./workspace-port.js";
import type { WorkspaceRepository } from "./workspace-repository.js";
import type { WorkspaceRecord } from "./workspace-model.js";
import type { CommandContext } from "./command-context.js";

const context: CommandContext = { commandId: toId("cmd-1"), actor: "user", occurredAt: new Date().toISOString() };

function record(over: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: toId("ws-1"),
    projectId: null,
    kind: "repo",
    path: "/src/repo",
    state: "ready",
    createdAt: new Date().toISOString(),
    tombstonedAt: null,
    repository: {
      id: toId("repo-1"),
      stableIdentity: "abc",
      canonicalRemote: null,
      baseRef: "main",
      headRef: "deadbeef",
      branchName: "main",
      integrationTargetRef: null
    },
    ...over
  };
}

function fakes(sourceRecord: WorkspaceRecord = record()) {
  const port = {
    canonicalizeExisting: vi.fn(async (path: string) => path),
    createScratch: vi.fn(async (path: string) => path),
    inspectRepository: vi.fn(async () => ({ stableIdentity: "id", canonicalRemote: null, canonicalPath: "/src/repo", head: "deadbeef", branchName: "main" })),
    createWorktree: vi.fn(async () => ({ path: "/managed/wt", repository: { stableIdentity: "id", canonicalRemote: null, canonicalPath: "/managed/wt", head: "deadbeef", branchName: "nodra/task" } })),
    snapshot: vi.fn(async () => ({ head: "deadbeef", treeDigest: "t", diffDigest: "d", branchName: "main", capturedAt: new Date().toISOString() })),
    commit: vi.fn(async () => undefined),
    integrate: vi.fn(async () => undefined),
    deleteActivity: vi.fn(async () => undefined)
  } satisfies WorkspacePort;
  const repository = {
    findCommand: vi.fn(async () => null),
    create: vi.fn(async (input: Parameters<WorkspaceRepository["create"]>[0]) => record({ id: input.id, kind: input.kind, path: input.path })),
    read: vi.fn(async () => sourceRecord)
  } as unknown as WorkspaceRepository;
  return { port, repository };
}

describe("CreateWorkspace — explicit git worktree activation", () => {
  it("never calls git worktree add for a scratch workspace", async () => {
    const { port, repository } = fakes();
    await new CreateWorkspace(repository, port).execute({
      id: toId("ws-new"), kind: "scratch", path: "/managed/ws", context
    });
    expect(port.createWorktree).not.toHaveBeenCalled();
    expect(port.createScratch).toHaveBeenCalledTimes(1);
  });

  it("never calls git worktree add for a repo workspace", async () => {
    const { port, repository } = fakes();
    await new CreateWorkspace(repository, port).execute({
      id: toId("ws-new"), kind: "repo", path: "/src/repo", context
    });
    expect(port.createWorktree).not.toHaveBeenCalled();
  });

  it("creates a worktree only when kind === 'worktree' with valid source/baseRef/branch", async () => {
    const { port, repository } = fakes();
    await new CreateWorkspace(repository, port).execute({
      id: toId("ws-new"), kind: "worktree", path: "/managed/wt",
      sourceWorkspaceId: toId("ws-1"), baseRef: "main", branchName: "nodra/task", context
    });
    expect(port.createWorktree).toHaveBeenCalledTimes(1);
    expect(port.createWorktree).toHaveBeenCalledWith(expect.objectContaining({
      sourcePath: "/src/repo", branchName: "nodra/task", baseRef: "main"
    }));
  });

  it("rejects a worktree request missing source/baseRef/branch without touching git", async () => {
    const { port, repository } = fakes();
    await expect(new CreateWorkspace(repository, port).execute({
      id: toId("ws-new"), kind: "worktree", path: "/managed/wt", context
    })).rejects.toBeInstanceOf(DomainError);
    expect(port.createWorktree).not.toHaveBeenCalled();
  });

  it("refuses a worktree from a deleted source repository", async () => {
    const { port, repository } = fakes(record({ state: "deleted" }));
    await expect(new CreateWorkspace(repository, port).execute({
      id: toId("ws-new"), kind: "worktree", path: "/managed/wt",
      sourceWorkspaceId: toId("ws-1"), baseRef: "main", branchName: "nodra/task", context
    })).rejects.toMatchObject({ code: "WORKSPACE_STATE_CONFLICT" });
    expect(port.createWorktree).not.toHaveBeenCalled();
  });
});
