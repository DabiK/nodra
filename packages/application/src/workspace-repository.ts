import type { Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type {
  RepositoryIdentity,
  WorkspaceGitSnapshot,
  WorkspaceKind,
  WorkspaceMutationResult,
  WorkspaceRecord
} from "./workspace-model.js";

export interface WorkspaceRepository {
  findCommand(commandId: Id): Promise<WorkspaceRecord | null>;
  create(input: {
    id: Id;
    projectId: Id | null;
    kind: WorkspaceKind;
    path: string;
    repository: RepositoryIdentity | null;
    baseRef: string | null;
    branchName: string | null;
    integrationTargetRef: string | null;
    snapshot: WorkspaceGitSnapshot | null;
    context: CommandContext;
  }): Promise<WorkspaceRecord>;
  read(id: Id): Promise<WorkspaceRecord>;
  saveSnapshot(input: {
    id: Id;
    workspaceId: Id;
    reason: string;
    snapshot: WorkspaceGitSnapshot;
    context: CommandContext;
  }): Promise<WorkspaceGitSnapshot>;
  missionAllowsAutoCommit(missionId: Id, workspaceId: Id): Promise<boolean>;
  assertDeletable(workspaceId: Id): Promise<WorkspaceRecord>;
  recordGitMutation(input: {
    workspaceId: Id;
    reason: string;
    beforeId: Id;
    before: WorkspaceGitSnapshot;
    afterId: Id;
    after: WorkspaceGitSnapshot;
    context: CommandContext;
  }): Promise<WorkspaceMutationResult>;
  tombstone(input: {
    workspaceId: Id;
    context: CommandContext;
  }): Promise<WorkspaceRecord>;
  restore(input: {
    workspaceId: Id;
    context: CommandContext;
  }): Promise<WorkspaceRecord>;
}
