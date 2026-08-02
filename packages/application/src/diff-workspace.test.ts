import { describe, expect, it, vi } from "vitest";
import { asId as toId, DomainError } from "@nodra/domain";
import { DiffWorkspace } from "./diff-workspace.js";
import type { WorkspacePort } from "./workspace-port.js";
import type { WorkspaceRepository } from "./workspace-repository.js";
import type { WorkspaceDiff, WorkspaceRecord } from "./workspace-model.js";

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
      baseRef: "abc123",
      headRef: "def456",
      branchName: "main",
      integrationTargetRef: null
    },
    ...over
  };
}

function fakes(sourceRecord: WorkspaceRecord = record()) {
  const port = {
    diff: vi.fn(async (input: { path: string; base: string | null; head: string | null }): Promise<WorkspaceDiff> => ({
      base: input.base,
      head: input.head,
      files: []
    }))
  } as unknown as WorkspacePort;
  const repository = {
    read: vi.fn(async () => sourceRecord)
  } as unknown as WorkspaceRepository;
  return { port, repository };
}

describe("DiffWorkspace", () => {
  it("diffe la base par défaut (snapshot initial) vers l'arbre de travail", async () => {
    const { port, repository } = fakes();
    const diff = await new DiffWorkspace(repository, port).execute({ workspaceId: toId("ws-1") });
    expect(port.diff).toHaveBeenCalledWith({ path: "/src/repo", base: "abc123", head: null });
    expect(diff).toEqual({ base: "abc123", head: null, files: [] });
  });

  it("passe base et head explicites au port", async () => {
    const { port, repository } = fakes();
    await new DiffWorkspace(repository, port).execute({
      workspaceId: toId("ws-1"),
      base: "main~1",
      head: "main"
    });
    expect(port.diff).toHaveBeenCalledWith({ path: "/src/repo", base: "main~1", head: "main" });
  });

  it("refuse un workspace supprimé", async () => {
    const { port, repository } = fakes(record({ state: "deleted" }));
    await expect(new DiffWorkspace(repository, port).execute({ workspaceId: toId("ws-1") }))
      .rejects.toMatchObject({ code: "WORKSPACE_STATE_CONFLICT" });
    expect(port.diff).not.toHaveBeenCalled();
  });

  it("refuse un workspace sans dépôt Git (scratch)", async () => {
    const { port, repository } = fakes(record({ repository: null }));
    await expect(new DiffWorkspace(repository, port).execute({ workspaceId: toId("ws-1") }))
      .rejects.toBeInstanceOf(DomainError);
    expect(port.diff).not.toHaveBeenCalled();
  });

  it("propage une erreur du repository (workspace inconnu)", async () => {
    const { port, repository } = fakes();
    vi.mocked(repository.read).mockRejectedValueOnce(new DomainError("unknown", "WORKSPACE_NOT_FOUND"));
    await expect(new DiffWorkspace(repository, port).execute({ workspaceId: toId("ws-x") }))
      .rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    expect(port.diff).not.toHaveBeenCalled();
  });
});
