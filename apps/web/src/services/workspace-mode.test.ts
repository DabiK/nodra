import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_MODE,
  WORKSPACE_MODES,
  branchNameFromTitle,
  defaultWorktreeFields,
  validateWorkspaceMode,
  type WorkspaceModeFields
} from "./workspace-mode";

const base: WorkspaceModeFields = {
  workspaceKind: "scratch",
  workspacePath: "",
  workspaceName: "",
  sourceWorkspaceId: "",
  sourceRepositoryPath: "",
  baseRef: "HEAD",
  branchName: "nodra/task"
};

describe("workspace-mode shared contract", () => {
  it("exposes the three modes with worktree flagged by a warning", () => {
    expect(WORKSPACE_MODES.map((mode) => mode.kind)).toEqual(["repo", "scratch", "worktree"]);
    expect(WORKSPACE_MODES.find((mode) => mode.kind === "worktree")?.warning).toBeTruthy();
    expect(DEFAULT_WORKSPACE_MODE).toBe("scratch");
  });

  it("builds a safe branch name from an arbitrary title", () => {
    expect(branchNameFromTitle("Corrige le Bug #42 !")).toBe("nodra/corrige-le-bug-42");
    expect(branchNameFromTitle("")).toBe("nodra/task");
    expect(branchNameFromTitle("Éléphant")).toBe("nodra/elephant");
  });

  it("defaults worktree fields to HEAD + generated branch", () => {
    expect(defaultWorktreeFields("My Task")).toEqual({ baseRef: "HEAD", branchName: "nodra/my-task" });
  });

  it("requires a repo path in repo mode", () => {
    expect(validateWorkspaceMode({ ...base, workspaceKind: "repo", workspacePath: "" })).toMatch(/dépôt existant/i);
    expect(validateWorkspaceMode({ ...base, workspaceKind: "repo", workspacePath: "/tmp/repo" })).toBeNull();
  });

  it("never requires anything in scratch mode", () => {
    expect(validateWorkspaceMode({ ...base, workspaceKind: "scratch" })).toBeNull();
  });

  it("requires a git source in worktree mode", () => {
    expect(validateWorkspaceMode({ ...base, workspaceKind: "worktree" })).toMatch(/dépôt git source/i);
    expect(validateWorkspaceMode({ ...base, workspaceKind: "worktree", sourceRepositoryPath: "/tmp/repo" })).toBeNull();
    expect(validateWorkspaceMode({ ...base, workspaceKind: "worktree", sourceWorkspaceId: "ws-1" })).toBeNull();
  });

  it("rejects an invalid branch name in worktree mode", () => {
    expect(
      validateWorkspaceMode({
        ...base,
        workspaceKind: "worktree",
        sourceRepositoryPath: "/tmp/repo",
        branchName: "bad branch~name"
      })
    ).toMatch(/branche invalide/i);
  });
});
