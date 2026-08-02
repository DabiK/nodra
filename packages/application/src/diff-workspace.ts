import { DomainError, type Id } from "@nodra/domain";
import type { WorkspaceDiff } from "./workspace-model.js";
import type { WorkspacePort } from "./workspace-port.js";
import type { WorkspaceRepository } from "./workspace-repository.js";

/**
 * Diff Git d'un workspace : compare une ref de base (par défaut le snapshot
 * initial du workspace, `repository.baseRef`) à une ref explicite ou à
 * l'arbre de travail courant (head null).
 */
export class DiffWorkspace {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly workspace: WorkspacePort
  ) {}

  async execute(input: {
    workspaceId: Id;
    base?: string | null;
    head?: string | null;
  }): Promise<WorkspaceDiff> {
    const record = await this.repository.read(input.workspaceId);
    if (record.state === "deleted") {
      throw new DomainError("Workspace has already been deleted", "WORKSPACE_STATE_CONFLICT");
    }
    if (!record.repository) {
      throw new DomainError("Workspace has no Git repository", "GIT_OPERATION_FAILED");
    }
    const base = input.base ?? record.repository.baseRef;
    const head = input.head ?? null;
    return this.workspace.diff({ path: record.path, base, head });
  }
}
