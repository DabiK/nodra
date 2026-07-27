import { useCallback, useEffect, useState } from "react";
import {
  loadWorktreeStatus,
  resolveWorktree,
  type WorktreeResolutionResultView,
  type WorktreeStatusView
} from "../services/worktree-service";

type Action = "remove-all" | "keep-branch";
type Phase = "checking" | "idle" | "confirm" | "working" | "done" | "error";

interface DialogError {
  code: string;
  message: string;
}

function parseError(error: unknown): DialogError {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(message) as { code?: string; detail?: string; title?: string };
    if (parsed && (parsed.code || parsed.detail)) {
      return { code: parsed.code ?? "ERROR", message: parsed.detail ?? parsed.title ?? message };
    }
  } catch {
    /* not JSON */
  }
  return { code: "ERROR", message };
}

/**
 * End-of-task resolution for a Git worktree. Always asks the user what to do —
 * never deletes silently. Surfaces uncommitted changes and unmerged commits,
 * requires reinforced confirmation before any destructive action, disables
 * actions while an operation runs, and reflects the real backend result.
 */
export function WorktreeResolutionDialog({
  workspaceId,
  branchHint,
  onClose
}: {
  workspaceId: string;
  branchHint?: string | null;
  onClose(resolved: boolean): void;
}) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [status, setStatus] = useState<WorktreeStatusView | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<WorktreeResolutionResultView | null>(null);
  const [error, setError] = useState<DialogError | null>(null);

  const refreshStatus = useCallback(async () => {
    setPhase("checking");
    setError(null);
    try {
      const next = await loadWorktreeStatus(workspaceId);
      setStatus(next);
      setPhase("idle");
    } catch (reason) {
      setError(parseError(reason));
      setPhase("error");
    }
  }, [workspaceId]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const branchName = status?.branchName ?? branchHint ?? "(branche inconnue)";
  const needsReinforcedConfirm = (chosen: Action) =>
    Boolean(status?.hasUncommittedChanges) || (chosen === "remove-all" && Boolean(status?.hasUnmergedCommits));

  const choose = (chosen: Action) => {
    setAction(chosen);
    setConfirmed(false);
    if (needsReinforcedConfirm(chosen)) {
      setPhase("confirm");
    } else {
      void run(chosen, false);
    }
  };

  const run = async (chosen: Action, withConfirmation: boolean) => {
    if (!status) return;
    setPhase("working");
    setError(null);
    try {
      const body = {
        action: chosen,
        confirmDiscardChanges: withConfirmation && status.hasUncommittedChanges ? true : undefined,
        confirmDeleteUnmerged: withConfirmation && chosen === "remove-all" && status.hasUnmergedCommits ? true : undefined
      };
      const outcome = await resolveWorktree(workspaceId, body);
      setResult(outcome);
      setPhase("done");
    } catch (reason) {
      setError(parseError(reason));
      setPhase("error");
      // Re-read the real Git state so the user sees the actual situation.
      try { setStatus(await loadWorktreeStatus(workspaceId)); } catch { /* keep previous */ }
    }
  };

  const busy = phase === "working" || phase === "checking";

  return (
    <div className="inspector-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(false); }}>
      <section className="worktree-dialog" role="dialog" aria-modal="true" aria-labelledby="worktreeDialogTitle">
        <header>
          <span className="eyebrow">TERRAIN DE TRAVAIL · GIT WORKTREE</span>
          <h2 id="worktreeDialogTitle">Résoudre le worktree</h2>
          <code className="worktree-branch">{branchName}</code>
        </header>

        {phase === "checking" && <p className="worktree-state" role="status">Vérification de l'état Git…</p>}

        {status && phase !== "checking" && phase !== "done" && (
          <div className="worktree-status-summary">
            {!status.worktreeExists && <p className="worktree-note">Le dossier du worktree n'existe plus sur le disque (supprimé manuellement ?). Le nettoyage restant sera appliqué.</p>}
            {status.hasUncommittedChanges && <p className="worktree-warning">⚠ Modifications non commit présentes — elles seront perdues si tu supprimes le worktree.</p>}
            {status.hasUnmergedCommits && <p className="worktree-warning">⚠ La branche contient des commits non fusionnés.</p>}
            {!status.hasUncommittedChanges && !status.hasUnmergedCommits && status.worktreeExists && <p className="worktree-ok">Aucune modification en attente détectée.</p>}
          </div>
        )}

        {(phase === "idle" || phase === "confirm" || phase === "error") && (
          <div className="worktree-options">
            <button type="button" className="worktree-option danger" disabled={busy} onClick={() => choose("remove-all")}>
              <strong>Supprimer le worktree et la branche</strong>
              <small>Retire le worktree puis supprime la branche de tâche du dépôt principal.</small>
            </button>
            <button type="button" className="worktree-option" disabled={busy} onClick={() => choose("keep-branch")}>
              <strong>Conserver la branche, supprimer le worktree</strong>
              <small>Retire le worktree mais garde la branche « {branchName} » pour une PR ou un merge manuel.</small>
            </button>
          </div>
        )}

        {phase === "confirm" && action && (
          <div className="worktree-confirm" role="alertdialog" aria-label="Confirmation renforcée">
            <p className="worktree-warning">
              {action === "remove-all"
                ? "Cette action peut entraîner une perte de données (modifications non commit et/ou commits non fusionnés)."
                : "Des modifications non commit seront perdues lors de la suppression du worktree."}
            </p>
            <label className="worktree-confirm-check">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              Je comprends le risque et je confirme.
            </label>
            <div className="worktree-confirm-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={() => setPhase("idle")}>Annuler</button>
              <button type="button" className="primary-button danger-action" disabled={busy || !confirmed} onClick={() => void run(action, true)}>
                Confirmer et exécuter
              </button>
            </div>
          </div>
        )}

        {phase === "working" && (
          <p className="worktree-state" role="status">
            {action === "remove-all" ? "Suppression du worktree puis de la branche…" : "Suppression du worktree (branche conservée)…"}
          </p>
        )}

        {phase === "done" && result && (
          <div className="worktree-done" role="status">
            <p className="worktree-ok">✓ Nettoyage terminé.</p>
            <ul>
              <li>Worktree : {result.worktreeRemoved ? "supprimé" : "déjà absent"}</li>
              {result.branchDeleted && <li>Branche « {result.branchName} » : supprimée</li>}
              {result.branchKept && <li>Branche « {result.branchName} » : conservée dans le dépôt principal</li>}
            </ul>
          </div>
        )}

        {phase === "error" && error && (
          <div className="worktree-error" role="alert">
            <strong>Échec de l'opération {action ? `(${action === "remove-all" ? "suppression" : "conservation"})` : ""}</strong>
            <p>{error.message}</p>
            <code>{error.code}</code>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void refreshStatus()}>Réessayer</button>
          </div>
        )}

        <footer className="worktree-dialog-footer">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => onClose(phase === "done")}>
            {phase === "done" ? "Fermer" : "Annuler (résoudre plus tard)"}
          </button>
        </footer>
        {phase !== "done" && <p className="worktree-hint">Fermer sans résoudre garde le worktree et la branche intacts ; l'action « Résoudre le terrain de travail » restera disponible.</p>}
      </section>
    </div>
  );
}
