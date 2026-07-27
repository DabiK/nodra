import type { WorkspaceDraftKind } from "../types";

/**
 * Shared "Terrain de travail" (workspace mode) contract used by BOTH the
 * new-task intake form and the mission settings form. Keeping the types,
 * constants and validation rules in one module guarantees the two screens can
 * never diverge.
 */
export interface WorkspaceModeFields {
  workspaceKind: WorkspaceDraftKind;
  /** Repo folder (repo mode) OR optional explicit worktree target (worktree mode). */
  workspacePath: string;
  /** Scratch workspace name (scratch mode). */
  workspaceName: string;
  /** Existing source workspace id (worktree mode, optional). */
  sourceWorkspaceId: string;
  /** Source repository path (worktree mode, when no source workspace id). */
  sourceRepositoryPath: string;
  /** Base revision the worktree branch is created from (worktree mode). */
  baseRef: string;
  /** Task branch name (worktree mode). */
  branchName: string;
}

export interface WorkspaceModeDescriptor {
  kind: WorkspaceDraftKind;
  title: string;
  description: string;
  /** Optional warning surfaced under the option (e.g. side effects). */
  warning?: string;
}

export const WORKSPACE_MODES: readonly WorkspaceModeDescriptor[] = [
  {
    kind: "repo",
    title: "Dépôt existant",
    description: "Travaille directement dans un dossier ou dépôt Git déjà présent."
  },
  {
    kind: "scratch",
    title: "Workspace neuf",
    description: "Crée un dossier de travail managé et isolé."
  },
  {
    kind: "worktree",
    title: "Git worktree",
    description: "Crée une branche isolée depuis un dépôt source via git worktree.",
    warning: "Un worktree Git n'est créé que si ce mode est explicitement sélectionné."
  }
] as const;

export const DEFAULT_WORKSPACE_MODE: WorkspaceDraftKind = "scratch";

/** Turn an arbitrary task title/name into a safe git branch segment. */
export function branchNameFromTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `nodra/${slug || "task"}`;
}

/**
 * Validate the workspace-mode selection. Returns a human-readable error, or
 * null when valid. Shared so both forms enforce identical rules.
 */
export function validateWorkspaceMode(value: WorkspaceModeFields): string | null {
  if (value.workspaceKind === "repo") {
    if (!value.workspacePath.trim()) return "Indique le dossier du dépôt existant.";
    return null;
  }
  if (value.workspaceKind === "scratch") {
    // Scratch always resolves to a generated path; nothing required.
    return null;
  }
  // worktree
  if (!value.sourceWorkspaceId.trim() && !value.sourceRepositoryPath.trim()) {
    return "Choisis un dépôt Git source pour créer un worktree.";
  }
  const branch = value.branchName.trim();
  if (branch && !/^[\w./-]+$/.test(branch)) {
    return "Nom de branche invalide (lettres, chiffres, . _ / - uniquement).";
  }
  return null;
}

/** Default worktree branch/baseRef derived from a fallback title. */
export function defaultWorktreeFields(fallbackTitle: string): Pick<WorkspaceModeFields, "baseRef" | "branchName"> {
  return { baseRef: "HEAD", branchName: branchNameFromTitle(fallbackTitle) };
}
