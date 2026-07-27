import type { WorkspaceDraftKind } from "../types";
import { WORKSPACE_MODES, validateWorkspaceMode, type WorkspaceModeFields } from "../services/workspace-mode";

/**
 * Shared "Terrain de travail" selector used by both the new-task intake form
 * (`TaskIntakeCard`) and the mission settings form (`MissionInspector`).
 * Handles: mode display, selection, descriptions/warnings, validation,
 * defaults, disabled state, accessibility and parent-state synchronisation.
 */
export function WorkspaceModePicker({
  value,
  onChange,
  generatedScratchPath,
  onBrowseRepo,
  disabled = false,
  idPrefix = "workspace-mode"
}: {
  value: WorkspaceModeFields;
  onChange(patch: Partial<WorkspaceModeFields>): void;
  generatedScratchPath: string;
  onBrowseRepo?(): void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const validationError = validateWorkspaceMode(value);
  const activeDescriptor = WORKSPACE_MODES.find((mode) => mode.kind === value.workspaceKind);
  const select = (kind: WorkspaceDraftKind) => {
    if (disabled) return;
    onChange({ workspaceKind: kind });
  };

  return (
    <div className="workspace-mode-field" data-testid="workspace-mode-picker">
      <fieldset className="workspace-mode-picker" disabled={disabled}>
        <legend>Terrain de travail</legend>
        {WORKSPACE_MODES.map((mode) => (
          <button
            type="button"
            className={value.workspaceKind === mode.kind ? "active" : ""}
            aria-pressed={value.workspaceKind === mode.kind}
            onClick={() => select(mode.kind)}
            key={mode.kind}
          >
            <strong>{mode.title}</strong>
            <small>{mode.description}</small>
          </button>
        ))}
      </fieldset>

      {activeDescriptor?.warning && (
        <p className="workspace-mode-warning" role="note">{activeDescriptor.warning}</p>
      )}

      {value.workspaceKind === "repo" && (
        <label>
          Dossier du dépôt
          <span className="repository-picker mission-repository">
            <input
              id={`${idPrefix}-repo-path`}
              value={value.workspacePath}
              onChange={(event) => onChange({ workspacePath: event.target.value })}
              placeholder="/Users/.../repo-ou-dossier"
              disabled={disabled}
            />
            {onBrowseRepo && (
              <button type="button" onClick={onBrowseRepo} disabled={disabled}>Parcourir...</button>
            )}
          </span>
        </label>
      )}

      {value.workspaceKind === "scratch" && (
        <div className="mission-config-grid identity">
          <label>
            Nom du workspace
            <input
              id={`${idPrefix}-scratch-name`}
              value={value.workspaceName}
              onChange={(event) => onChange({ workspaceName: event.target.value })}
              placeholder="nom du dossier généré"
              disabled={disabled}
            />
          </label>
          <label>
            Dossier généré
            <input value={generatedScratchPath} readOnly placeholder="Généré depuis le nom" />
          </label>
        </div>
      )}

      {value.workspaceKind === "worktree" && (
        <div className="mission-config-grid identity">
          <label>
            Dépôt Git source
            <input
              id={`${idPrefix}-source-repo`}
              value={value.sourceRepositoryPath}
              onChange={(event) => onChange({ sourceRepositoryPath: event.target.value })}
              placeholder="/Users/.../repo-source"
              disabled={disabled || Boolean(value.sourceWorkspaceId)}
            />
          </label>
          <label>
            Révision de base
            <input
              id={`${idPrefix}-base-ref`}
              value={value.baseRef}
              onChange={(event) => onChange({ baseRef: event.target.value })}
              placeholder="HEAD, main ou SHA"
              disabled={disabled}
            />
          </label>
          <label>
            Branche de tâche
            <input
              id={`${idPrefix}-branch`}
              value={value.branchName}
              onChange={(event) => onChange({ branchName: event.target.value })}
              placeholder="nodra/ma-tache"
              disabled={disabled}
            />
          </label>
          <label>
            Chemin worktree (optionnel)
            <input
              id={`${idPrefix}-worktree-path`}
              value={value.workspacePath}
              onChange={(event) => onChange({ workspacePath: event.target.value })}
              placeholder="Généré automatiquement si vide"
              disabled={disabled}
            />
          </label>
        </div>
      )}

      {validationError && (
        <p className="workspace-mode-error" role="alert">{validationError}</p>
      )}
    </div>
  );
}
