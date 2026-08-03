import { api } from "../api";

/** Statut d'un fichier dans le diff (miroir de WorkspaceDiffFileStatus côté API). */
export type WorkspaceDiffFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface WorkspaceDiffFileView {
  path: string;
  oldPath: string | null;
  status: WorkspaceDiffFileStatus;
  /** Lignes ajoutées/supprimées (null pour les fichiers binaires). */
  additions: number | null;
  deletions: number | null;
  /** Diff unifié texte pour ce fichier. */
  content: string;
}

export interface WorkspaceDiffView {
  /** Ref comparée comme base (snapshot initial du workspace par défaut). */
  base: string | null;
  /** Ref comparée comme tête — null signifie l'arbre de travail. */
  head: string | null;
  files: WorkspaceDiffFileView[];
}

/** Diff Git d'un workspace (GET /api/workspaces/:id/diff?base=&head=). */
export async function loadWorkspaceDiff(workspaceId: string, base?: string, head?: string) {
  const params = new URLSearchParams();
  if (base) params.set("base", base);
  if (head) params.set("head", head);
  return api<WorkspaceDiffView>(`/api/workspaces/${workspaceId}/diff${params.size ? `?${params}` : ""}`);
}

export const DIFF_FILE_STATUS_LABELS: Record<WorkspaceDiffFileStatus, { code: string; label: string }> = {
  added: { code: "A", label: "Ajouté" },
  modified: { code: "M", label: "Modifié" },
  deleted: { code: "D", label: "Supprimé" },
  renamed: { code: "R", label: "Renommé" }
};
